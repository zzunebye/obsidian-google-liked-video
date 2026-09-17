/* global globalThis */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-client-secret-auth-'));
const outputPath = path.join(outputDirectory, 'auth-verification.cjs');

await build({
	stdin: {
		contents: `
			export { handleGoogleLogin, handleGoogleLogout, refreshAccessToken, getValidAccessToken } from './src/auth.ts';
			export { googleTokenStorageService } from './src/services/googleTokenStorageService.ts';
			export { LikedVideoStorageService } from './src/services/likedVideoStorageService.ts';
			export { localStorageService } from './src/storage.ts';
		`,
		resolveDir: process.cwd(),
		sourcefile: 'auth-verification-entry.ts',
	},
	bundle: true,
	format: 'cjs',
	platform: 'node',
	outfile: outputPath,
		plugins: [{
			name: 'obsidian-verification-stub',
			setup(builder) {
				builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'verification' }));
				builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'verification' }));
				builder.onResolve({ filter: /^http$/ }, () => ({ path: 'http', namespace: 'verification' }));
				builder.onLoad({ filter: /.*/, namespace: 'verification' }, (args) => ({
					contents: args.path === 'obsidian' ? `
						export const Platform = { isDesktop: true };
						export const normalizePath = value => value;
						export class Notice { constructor() {} }
						export const requestUrl = (request) => globalThis.requestUrl(request);
					` : args.path === 'electron' ? `
						export const shell = { openExternal: url => globalThis.openExternal(url) };
					` : `export const createServer = (...args) => globalThis.createVerificationHttpServer(...args);`,
					loader: 'js',
				}));
		},
	}],
});

class FakeSecretStorage {
	constructor(values) {
		this.values = values;
	}

	getSecret(id) {
		return this.values.has(id) ? this.values.get(id) : null;
	}

	setSecret(id, value) {
		this.values.set(id, value);
	}
}

class FakeLocalStorage {
	constructor() {
		this.values = new Map();
	}

	getItem(key) {
		return this.values.has(key) ? this.values.get(key) : null;
	}

	setItem(key, value) {
		this.values.set(key, value);
	}

	removeItem(key) {
		this.values.delete(key);
	}
}

const secrets = new Map([
	['geulo-google-client-secret', 'secret-from-storage'],
	['geulo-google-refresh-token', 'refresh-from-storage'],
]);
const localStorage = new FakeLocalStorage();
const openedExternalUrls = [];
let windowOpenCount = 0;
globalThis.openExternal = async (url) => {
	openedExternalUrls.push(url);
};
globalThis.window = {
	localStorage,
	open() { windowOpenCount += 1; },
	setTimeout: globalThis.setTimeout.bind(globalThis),
	clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

let oauthCallback;
let createServerCount = 0;
let loginRequestUrl = '';
let loginRequestBody = '';
let refreshRequestBody = '';
let loginResponse = {
	status: 200,
	json: { refresh_token: 'new-refresh', access_token: 'new-access', expires_in: 3600 },
};

function createCallbackResponse() {
	return {
		statusCode: 200,
		ended: false,
		headers: new Map(),
		setHeader(name, value) {
			this.headers.set(name, value);
		},
		end() {
			this.ended = true;
		},
	};
}

async function waitFor(predicate) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.fail('OAuth callback did not finish');
}

const httpVerification = {
	createServer(callback) {
		createServerCount += 1;
		oauthCallback = callback;
		return {
			listen(_port, onListen) {
				onListen();
				return this;
			},
			close(onClose) {
				onClose?.();
			},
		};
	},
};

globalThis.createVerificationHttpServer = httpVerification.createServer.bind(httpVerification);

const originalRequestUrl = globalThis.requestUrl;
globalThis.requestUrl = async (request) => {
	const requestBody = String(request.body);
	if (requestBody.includes('grant_type=authorization_code')) {
		loginRequestUrl = String(request.url);
		loginRequestBody = requestBody;
		return loginResponse;
	}
	refreshRequestBody = requestBody;
	return { status: 200, json: { access_token: 'refreshed-access', expires_in: 3600 } };
};

try {
	const require = createRequire(import.meta.url);
	const { handleGoogleLogin, handleGoogleLogout, refreshAccessToken, getValidAccessToken, googleTokenStorageService, LikedVideoStorageService, localStorageService } = require(outputPath);
	googleTokenStorageService.initialize(new FakeSecretStorage(secrets));
	const savedVideos = [{
		id: 'saved-video', pulled_at: '2026-01-01T00:00:00Z',
		snippet: { title: 'Saved video', channelTitle: 'Channel', channelId: 'channel', publishedAt: '2026-01-01', description: '', thumbnails: { medium: { url: 'https://example.com/image.jpg' } } },
		contentDetails: { duration: 'PT1M' }, statistics: { viewCount: '10' },
	}];
	const savedJSON = JSON.stringify({ schemaVersion: 1, videos: savedVideos });
	const savedPath = path.join(outputDirectory, 'liked-videos.json');
	await writeFile(savedPath, savedJSON);
	await writeFile(savedPath + '.bak', savedJSON);
	let videoWrites = 0;
	let videoNotifications = 0;
	const storage = new LikedVideoStorageService({
		exists: async file => { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } },
		read: file => readFile(file, 'utf8'),
		write: async (file, data) => { videoWrites++; await writeFile(file, data); },
	}, outputDirectory);
	await storage.initialize(localStorage);
	localStorageService.initializeLikedVideos(storage, error => { throw error; });
	localStorageService.subscribeLikedVideos(() => videoNotifications++);
	const assertSavedVideosPreserved = async () => {
		await storage.flush();
		assert.deepEqual(localStorageService.getLikedVideos(), savedVideos);
		assert.equal(await readFile(savedPath, 'utf8'), savedJSON);
		assert.equal(await readFile(savedPath + '.bak', 'utf8'), savedJSON);
		assert.equal(videoWrites, 0);
		assert.equal(videoNotifications, 0);
	};
	let loginSuccessCount = 0;
	const handleLoginSuccess = () => {
		loginSuccessCount += 1;
	};
	await handleGoogleLogin({
		googleClientId: 'client-id',
		googleClientSecret: 'settings-secret',
		openInObsidianWebViewer: true,
	}, handleLoginSuccess);
	assert.equal(typeof oauthCallback, 'function');
	assert.equal(openedExternalUrls.length, 1);
	assert.match(openedExternalUrls[0], /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
	assert.equal(windowOpenCount, 0);
	const firstCallbackResponse = createCallbackResponse();
	oauthCallback({ url: '/callback?code=auth-code' }, firstCallbackResponse);
	await waitFor(() => loginSuccessCount === 1);
	assert.equal(loginSuccessCount, 1);
	assert.equal(firstCallbackResponse.headers.get('Connection'), 'close');
	assert.equal(loginRequestUrl, 'https://oauth2.googleapis.com/token');
	assert.doesNotMatch(loginRequestUrl, /client_secret/);
	const parsedLoginBody = new URLSearchParams(loginRequestBody);
	assert.equal(parsedLoginBody.get('grant_type'), 'authorization_code');
	assert.equal(parsedLoginBody.get('client_id'), 'client-id');
	assert.equal(parsedLoginBody.get('client_secret'), 'secret-from-storage');
	assert.equal(parsedLoginBody.get('code'), 'auth-code');

	await handleGoogleLogin({ googleClientId: 'client-id', googleClientSecret: 'settings-secret' }, handleLoginSuccess);
	assert.equal(createServerCount, 2);
	oauthCallback({ url: '/callback?code=second-auth-code' }, createCallbackResponse());
	await waitFor(() => loginSuccessCount === 2);
	assert.equal(loginSuccessCount, 2);

	await refreshAccessToken('client-id');
	const parsedBody = JSON.parse(refreshRequestBody);
	assert.equal(parsedBody.client_secret, 'secret-from-storage');
	assert.notEqual(parsedBody.client_secret, 'settings-secret');

	secrets.set('geulo-google-access-token', '');
	localStorage.setItem('googleYtbLikedVideoExpirationTime', '0');
	let concurrentRefreshCount = 0;
	let resolveConcurrentRefresh;
	globalThis.requestUrl = () => {
		concurrentRefreshCount += 1;
		return new Promise((resolve) => { resolveConcurrentRefresh = resolve; });
	};
	const concurrentTokens = Array.from({ length: 6 }, () => getValidAccessToken('client-id'));
	assert.equal(concurrentRefreshCount, 1);
	resolveConcurrentRefresh({ status: 200, json: { access_token: 'shared-access', expires_in: 3600 } });
	assert.deepEqual(await Promise.all(concurrentTokens), Array(6).fill('shared-access'));
	assert.equal(googleTokenStorageService.getAccessToken(), 'shared-access');

	secrets.set('geulo-google-access-token', '');
	localStorage.setItem('googleYtbLikedVideoExpirationTime', '0');
	globalThis.requestUrl = async () => ({ status: 503, json: { error: 'unavailable' } });
	await assert.rejects(getValidAccessToken('client-id'), /503/);
	globalThis.requestUrl = async () => ({ status: 200, json: { access_token: 'retry-access', expires_in: 3600 } });
	assert.equal(await getValidAccessToken('client-id'), 'retry-access');

	secrets.set('geulo-google-access-token', '');
	localStorage.setItem('googleYtbLikedVideoExpirationTime', '0');
	let resolveTimedOutRefresh;
	globalThis.requestUrl = () => new Promise((resolve) => { resolveTimedOutRefresh = resolve; });
	const originalSetTimeout = globalThis.window.setTimeout;
	const originalClearTimeout = globalThis.window.clearTimeout;
	globalThis.window.setTimeout = (callback) => {
		queueMicrotask(callback);
		return 1;
	};
	globalThis.window.clearTimeout = () => {};
	await assert.rejects(getValidAccessToken('client-id'), /timed out/);
	globalThis.window.setTimeout = originalSetTimeout;
	globalThis.window.clearTimeout = originalClearTimeout;
	resolveTimedOutRefresh({ status: 200, json: { access_token: 'late-access', expires_in: 3600 } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(googleTokenStorageService.getAccessToken(), '');

	let resolveStaleRefresh;
	globalThis.requestUrl = () => new Promise((resolve) => { resolveStaleRefresh = resolve; });
	const staleRefresh = getValidAccessToken('client-id');
	secrets.set('geulo-google-refresh-token', 'replacement-refresh');
	resolveStaleRefresh({ status: 200, json: { access_token: 'stale-access', expires_in: 3600 } });
	await assert.rejects(staleRefresh, /changed during token refresh/);
	assert.equal(googleTokenStorageService.getAccessToken(), '');
	secrets.set('geulo-google-refresh-token', 'refresh-from-storage');
	globalThis.requestUrl = async (request) => {
		const requestBody = String(request.body);
		if (requestBody.includes('grant_type=authorization_code')) {
			loginRequestUrl = String(request.url);
			loginRequestBody = requestBody;
			return loginResponse;
		}
		refreshRequestBody = requestBody;
		return { status: 200, json: { access_token: 'refreshed-access', expires_in: 3600 } };
	};

	loginResponse = {
		status: 400,
		json: { error: 'invalid_grant' },
	};
	await handleGoogleLogin({ googleClientId: 'client-id', googleClientSecret: 'settings-secret' }, handleLoginSuccess);
	const failedCallbackResponse = createCallbackResponse();
	oauthCallback({ url: '/callback?code=expired-auth-code' }, failedCallbackResponse);
	await waitFor(() => failedCallbackResponse.ended);
	assert.equal(loginSuccessCount, 2);
	assert.equal(googleTokenStorageService.getRefreshToken(), '');
	assert.equal(googleTokenStorageService.getAccessToken(), '');
	assert.equal(failedCallbackResponse.statusCode, 400);
	assert.equal(failedCallbackResponse.ended, true);
	assert.equal(failedCallbackResponse.headers.get('Connection'), 'close');
	await assertSavedVideosPreserved();

	for (const revokeStatus of [200, 400]) {
		secrets.set('geulo-google-refresh-token', 'expired-refresh');
		secrets.set('geulo-google-access-token', 'expired-access');
		localStorageService.setAccessTokenExpirationTime(0);
		globalThis.requestUrl = async () => ({ status: 400, json: { error: 'invalid_grant' } });
		await assert.rejects(getValidAccessToken('client-id'), /400/);
		await assertSavedVideosPreserved();
		let logoutResult;
		globalThis.requestUrl = async () => ({ status: revokeStatus, json: {} });
		await handleGoogleLogout({ googleClientId: 'client-id' },
			() => { logoutResult = 'success'; }, () => { logoutResult = 'error'; });
		assert.equal(logoutResult, revokeStatus === 200 ? 'success' : 'error');
		assert.equal(googleTokenStorageService.getRefreshToken(), '');
		assert.equal(googleTokenStorageService.getAccessToken(), '');
		assert.equal(localStorageService.getAccessTokenExpirationTime(), 0);
		await assertSavedVideosPreserved();

		globalThis.requestUrl = async () => ({ status: 200, json: {
			refresh_token: 'reconnected-refresh', access_token: 'reconnected-access', expires_in: 3600,
		} });
		let reconnected = false;
		await handleGoogleLogin({ googleClientId: 'client-id' }, () => { reconnected = true; });
		oauthCallback({ url: '/callback?code=reconnect' }, createCallbackResponse());
		await waitFor(() => reconnected);
		assert.equal(googleTokenStorageService.getRefreshToken(), 'reconnected-refresh');
		await assertSavedVideosPreserved();
	}
	secrets.set('geulo-google-access-token', '');
	globalThis.requestUrl = async () => { throw new Error('Revocation should be skipped without an access token'); };
	await handleGoogleLogout({ googleClientId: 'client-id' }, () => {}, () => assert.fail('Unexpected logout error'));
	await assertSavedVideosPreserved();
	assert.equal(openedExternalUrls.length, createServerCount);
	assert.equal(windowOpenCount, 0);
	console.log('PASS: expired refresh, successful/failed revocation, reconnect and tokenless logout preserve memory, JSON, backup and subscribers');
} finally {
	globalThis.requestUrl = originalRequestUrl;
	delete globalThis.openExternal;
	delete globalThis.createVerificationHttpServer;
	await rm(outputDirectory, { recursive: true, force: true });
}

console.log('google-client-secret auth verification passed');
