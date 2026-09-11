/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-client-secret-auth-'));
const outputPath = path.join(outputDirectory, 'auth-verification.cjs');

await build({
	stdin: {
		contents: `
			export { handleGoogleLogin, refreshAccessToken, getValidAccessToken } from './src/auth.ts';
			export { googleTokenStorageService } from './src/services/googleTokenStorageService.ts';
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
				builder.onResolve({ filter: /^http$/ }, () => ({ path: 'http', namespace: 'verification' }));
				builder.onLoad({ filter: /.*/, namespace: 'verification' }, (args) => ({
					contents: args.path === 'obsidian' ? `
						export const Platform = { isDesktop: true };
						export class Notice { constructor() {} }
						export const requestUrl = (request) => globalThis.requestUrl(request);
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
globalThis.window = {
	localStorage,
	open() {},
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
	const { handleGoogleLogin, refreshAccessToken, getValidAccessToken, googleTokenStorageService } = require(outputPath);
	googleTokenStorageService.initialize(new FakeSecretStorage(secrets));
	let loginSuccessCount = 0;
	const handleLoginSuccess = () => {
		loginSuccessCount += 1;
	};
	await handleGoogleLogin({ googleClientId: 'client-id', googleClientSecret: 'settings-secret' }, handleLoginSuccess);
	assert.equal(typeof oauthCallback, 'function');
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
} finally {
	globalThis.requestUrl = originalRequestUrl;
	delete globalThis.createVerificationHttpServer;
}

console.log('google-client-secret auth verification passed');
