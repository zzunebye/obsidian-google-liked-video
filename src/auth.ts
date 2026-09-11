import { Platform, Notice, requestUrl } from 'obsidian';
import { createServer } from 'http';
import { localStorageService } from 'src/storage';
import { googleTokenStorageService } from 'src/services/googleTokenStorageService';
import { ObsidianGoogleLikedVideoSettings } from './types';

interface ServerSession {
	close(callback: () => void): void;
}

let serverSession: ServerSession | undefined;
let serverSessionClose = Promise.resolve();
let googleAuthVersion = 0;
let latestRefreshId = 0;
let activeRefresh: {
	clientId: string;
	refreshToken: string;
	clientSecret: string;
	promise: Promise<GoogleRefreshTokenResponse>;
} | null = null;

const PORT = 42813;
const AUTH_REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const REFRESH_TIMEOUT_MS = 90000;

type GoogleOAuthTokenResponse = {
	readonly access_token: string;
	readonly refresh_token: string;
	readonly expires_in: number;
};

type GoogleRefreshTokenResponse = {
	readonly access_token: string;
	readonly expires_in: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isGoogleOAuthTokenResponse(value: unknown): value is GoogleOAuthTokenResponse {
	return isRecord(value)
		&& typeof value.access_token === 'string'
		&& typeof value.refresh_token === 'string'
		&& typeof value.expires_in === 'number';
}

function isGoogleRefreshTokenResponse(value: unknown): value is GoogleRefreshTokenResponse {
	return isRecord(value)
		&& typeof value.access_token === 'string'
		&& value.access_token.length > 0
		&& typeof value.expires_in === 'number'
		&& Number.isFinite(value.expires_in)
		&& value.expires_in > 0;
}

function invalidateGoogleAuth(): void {
	googleAuthVersion += 1;
	latestRefreshId += 1;
	googleTokenStorageService.setRefreshToken("");
	googleTokenStorageService.setAccessToken("");
	localStorageService.setAccessTokenExpirationTime(0);
}

function closeServerSession(): Promise<void> {
	const currentServerSession = serverSession;
	serverSession = undefined;
	if (!currentServerSession) {
		return serverSessionClose;
	}

	serverSessionClose = new Promise<void>((resolve) => {
		currentServerSession.close(() => resolve());
	});
	return serverSessionClose;
}

async function finishGoogleLoginFailure(response: { statusCode: number; setHeader(name: string, value: string): void; end(content: string): void }): Promise<void> {
	new Notice("Auth failed");
	response.statusCode = 400;
	response.setHeader('Connection', 'close');
	response.end("Authentication failed. Please return to Obsidian.");
	await closeServerSession();
}

export async function handleGoogleLogin(
    pluginSettings: ObsidianGoogleLikedVideoSettings,
    onSuccess: () => void,
): Promise<void> {
    if (!Platform.isDesktop) {
        new Notice("Can't use this OAuth method on this device");
        return;
    }

	await serverSessionClose;

	invalidateGoogleAuth();

    const userClientID = pluginSettings.googleClientId;
    const userClientSecret = googleTokenStorageService.getClientSecret();

    const baseAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const authQuery = `?client_id=${userClientID.trim()}`
        + `&response_type=code`
        + `&redirect_uri=${AUTH_REDIRECT_URI}`
        + `&prompt=consent`
        + `&access_type=offline`
        + '&scope=https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl';
    const requestAuthUrl = baseAuthUrl + authQuery;


    if (serverSession) {
        window.open(requestAuthUrl);
        return;
	}

	if (Platform.isDesktop) {
		serverSession = createServer((req, res) => {
			void (async () => {
				try {
					if (!req.url || req.url.indexOf("/callback") < 0) return;

					const queryString = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams;
					const code = queryString.get("code");
					const tokenUrl = 'https://oauth2.googleapis.com/token';
					const tokenRequestBody = new URLSearchParams({
						grant_type: 'authorization_code',
						client_id: userClientID.trim(),
						client_secret: userClientSecret.trim(),
						access_type: 'offline',
						code: code ?? '',
						redirect_uri: AUTH_REDIRECT_URI,
					});

					const response = await requestUrl({
						url: tokenUrl,
						method: 'POST',
						headers: { 'content-type': 'application/x-www-form-urlencoded' },
						body: tokenRequestBody.toString(),
						throw: false,
					});

					if (response.status >= 400) {
						await finishGoogleLoginFailure(res);
						return;
					}

					const token: unknown = response.json;
					if (!isGoogleOAuthTokenResponse(token)) {
						await finishGoogleLoginFailure(res);
						return;
					}

					googleTokenStorageService.setRefreshToken(token.refresh_token);
					googleTokenStorageService.setAccessToken(token.access_token);
					localStorageService.setAccessTokenExpirationTime(+new Date() + token.expires_in * 1000);

					res.setHeader('Connection', 'close');
					res.end("Authentication successful! Please return to Obsidian.");
					await closeServerSession();

					new Notice("Tokens acquired.");
					onSuccess();
				} catch {
					await finishGoogleLoginFailure(res);
				}
			})();
		}).listen(PORT, () => {
			window.open(requestAuthUrl);
		});
	}
}

export async function handleGoogleLogout(
    pluginSettings: ObsidianGoogleLikedVideoSettings,
    onSuccess: () => void,
    onError: () => void,
): Promise<void> {
    if (!Platform.isDesktop) {
        new Notice("Can't use this OAuth method on this device");
        return;
    }

    const accessToken = googleTokenStorageService.getAccessToken();
    const success = accessToken ? await revokeGoogleToken(accessToken) : true;
    invalidateGoogleAuth();
    localStorageService.setLikedVideos([]);
    if (success) {
        onSuccess();
    } else {
        onError();
    }
}

export async function revokeGoogleToken(token: string): Promise<boolean> {
    const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${token}`;
    const response = await requestUrl({
        url: revokeUrl,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        throw: false,
    });

    if (response.status < 400) {
        new Notice("Token revoked successfully.");
        return true;
    } else {
        new Notice("Failed to revoke token.");
        return false;
    }
}


export async function refreshAccessToken(userClientId: string)
    : Promise<{ access_token: string, expires_in: number }> {
    const refreshToken = googleTokenStorageService.getRefreshToken();
    const userClientSecret = googleTokenStorageService.getClientSecret();

    if (!refreshToken || refreshToken == "") {
        throw new Error("Refresh token for Google API is missing or expired");
    }
	const clientId = userClientId.trim();
	if (activeRefresh
		&& activeRefresh.clientId === clientId
		&& activeRefresh.refreshToken === refreshToken
		&& activeRefresh.clientSecret === userClientSecret) {
		return activeRefresh.promise;
	}

	const authVersion = googleAuthVersion;
	const refreshId = ++latestRefreshId;

    const refreshTokenRequestBody = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: userClientSecret,
    }

	let timeoutId: number | undefined;
	const request = requestUrl({
		url: 'https://oauth2.googleapis.com/token',
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(refreshTokenRequestBody),
		throw: false,
	});
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = window.setTimeout(() => reject(new Error('Google token refresh timed out')), REFRESH_TIMEOUT_MS);
	});
	const refresh = (async (): Promise<GoogleRefreshTokenResponse> => {
		try {
			const response = await Promise.race([request, timeout]);
			if (response.status >= 400) throw new Error(`Google token refresh failed (${response.status})`);
			const token: unknown = response.json;
			if (!isGoogleRefreshTokenResponse(token)) throw new Error('Google returned an invalid token response');
			if (googleAuthVersion !== authVersion
				|| latestRefreshId !== refreshId
				|| googleTokenStorageService.getRefreshToken() !== refreshToken
				|| googleTokenStorageService.getClientSecret() !== userClientSecret) {
				throw new Error('Google authentication changed during token refresh');
			}
			googleTokenStorageService.setAccessToken(token.access_token);
			localStorageService.setAccessTokenExpirationTime(Date.now() + token.expires_in * 1000);
			return token;
		} finally {
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
		}
	})();
	const trackedRefresh = refresh.finally(() => {
		if (activeRefresh?.promise === trackedRefresh) activeRefresh = null;
	});
	activeRefresh = { clientId, refreshToken, clientSecret: userClientSecret, promise: trackedRefresh };
	return trackedRefresh;
}

export async function getValidAccessToken(userClientId: string): Promise<string> {
    const currentTime = new Date().getTime();
    const expirationTime = localStorageService.getAccessTokenExpirationTime();

    if (currentTime >= expirationTime) {
        const token = await refreshAccessToken(userClientId);
        return token.access_token;
    }

    const accessToken = googleTokenStorageService.getAccessToken();
    if (!accessToken) {
        const token = await refreshAccessToken(userClientId);
        return token.access_token;
    }

    return accessToken;
}
