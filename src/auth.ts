/* eslint-disable @typescript-eslint/no-var-requires */
import { IncomingMessage, Server, ServerResponse } from 'http';
import { localStorageService, setAccessToken, setAccessTokenExpirationTime, setRefreshToken } from 'src/storage';
import { Platform, Notice } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings } from './types';

let serverSession: Server;

const PORT = 42813;
const AUTH_REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

export async function handleGoogleLogin(pluginSettings: ObsidianGoogleLikedVideoSettings) {
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
        + '&scope=https://www.googleapis.com/auth/youtube.readonly';
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

            console.info("Tokens acquired.");

            res.end("Authentication successful! Please return to obsidian.");

            serverSession.close(() => {
                console.log("Server closed");
            });

        } catch (e) {
            console.log("Auth failed");

            serverSession.close(() => {
                console.log("Server closed");
            });
        }
    }).listen(PORT, async () => {
        window.open(requestAuthUrl);
    });
}

export async function refreshAccessToken(): Promise<string> {

    const refreshTokenRequestBody = {
        grant_type: 'refresh_token',
        refresh_token: localStorageService.getRefreshToken(),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
    }

    const response = await fetch(
        'https://oauth2.googleapis.com/token',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(refreshTokenRequestBody),
        }
    )

    const token = await response.json();

    setAccessToken(token.access_token);
    setAccessTokenExpirationTime(+new Date() + token.expires_in * 1000);

    return token.access_token;
}


export function getGoogleAccessToken(): string {
    /// Check if the refresh token is set
    if (!localStorageService.getRefreshToken() || localStorageService.getRefreshToken() == "") {
        new Notice(
            "Google  missing settings or not logged in"
        );
        return "";
    }

    /// Check if the access token is set
    if (localStorageService.getAccessToken() == "") {
        new Notice(
            "Google access token is expired"
        );
        return "";
    }

    /// Check if the access token expiration time is not set, or past
    if (localStorageService.getAccessTokenExpirationTime() == null || localStorageService.getAccessTokenExpirationTime() < Date.now()) {
        new Notice(
            "Google access token is expired"
        );
        return "";
    }

    return localStorageService.getAccessToken();
}
