/* eslint-disable @typescript-eslint/no-var-requires */
import { IncomingMessage, Server, ServerResponse } from 'http';
import { localStorageService, setAccessToken, setAccessTokenExpirationTime, setLikedVideos, setRefreshToken } from 'src/storage';
import { Platform, Notice } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings } from './types';

let serverSession: Server;

const PORT = 42813;
const AUTH_REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

export async function handleGoogleLogin(
    pluginSettings: ObsidianGoogleLikedVideoSettings,
    onSuccess: () => void,
) {
    if (!Platform.isDesktop) {
        new Notice("Can't use this OAuth method on this device");
        return;
    }

    setRefreshToken("");
    setAccessToken("");
    setAccessTokenExpirationTime(0);

    const userClientID = pluginSettings.googleClientId;
    const userClientSecret = pluginSettings.googleClientSecret;

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

    const http = require("http");
    const url = require("url");


    serverSession = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
        try {
            if (!req.url || req.url.indexOf("/callback") < 0) return;

            const queryString = new url.URL(req.url, `http://127.0.0.1:${PORT}`).searchParams;
            const code = queryString.get("code");
            const tokenUrl = `https://oauth2.googleapis.com/token`
                + `?grant_type=authorization_code`
                + `&client_id=${userClientID?.trim()}`
                + `&client_secret=${userClientSecret?.trim()}`
                + `&access_type=offline`
                + `&code=${code}`
                + `&redirect_uri=${AUTH_REDIRECT_URI}`;

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
            });

            const token = await response.json();

            if (token?.refresh_token) {
                setRefreshToken(token.refresh_token);
                setAccessToken(token.access_token);
                setAccessTokenExpirationTime(+new Date() + token.expires_in * 1000);
            }

            new Notice("Tokens acquired.");
            onSuccess();

            res.end("Authentication successful! Please return to Obsidian.");

            serverSession.close(() => { });

        } catch (e) {
            new Notice("Auth failed");

            serverSession.close(() => { });
        }
    }).listen(PORT, async () => {
        window.open(requestAuthUrl);
    });
}

export async function handleGoogleLogout(
    pluginSettings: ObsidianGoogleLikedVideoSettings,
    onSuccess: () => void,
    onError: () => void,
) {
    if (!Platform.isDesktop) {
        new Notice("Can't use this OAuth method on this device");
        return;
    }

    const accessToken = localStorageService.getAccessToken();
    if (accessToken) {
        const success = await revokeGoogleToken(accessToken);
        setRefreshToken("");
        setAccessToken("");
        setAccessTokenExpirationTime(0);
        setLikedVideos([]);
        if (success) {
            onSuccess();
        } else {
            onError();
        }
    }
}

export async function revokeGoogleToken(token: string) {
    const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${token}`;
    const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    if (response.ok) {
        new Notice("Token revoked successfully.");
        return true;
    } else {
        new Notice("Failed to revoke token.");
        return false;
    }
}


export async function refreshAccessToken(userClientId: string, userClientSecret: string)
    : Promise<{ access_token: string, expires_in: number }> {
    const refreshToken = localStorageService.getRefreshToken();
    if (!refreshToken || refreshToken == "") {
        new Notice("Refresh token for Google API is missing or expired");
        throw new Error("Refresh token for Google API is missing or expired");
    }

    const refreshTokenRequestBody = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: userClientId,
        client_secret: userClientSecret,
    }

    const response: Response = await fetch(
        'https://oauth2.googleapis.com/token',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(refreshTokenRequestBody),
        }
    )

    const token: { access_token: string, expires_in: number } = await response.json();

    return token;
}


export function getGoogleAccessTokenFromLocal(): string {
    const accessToken = localStorageService.getAccessToken();
    /// Check if the access token is set
    if (!accessToken || accessToken == "") {
        new Notice(
            "Access token for Google API is missing or expired"
        );
        return "";
    }

    return accessToken;
}
