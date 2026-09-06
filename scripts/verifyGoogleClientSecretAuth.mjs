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
			export { handleGoogleLogin, refreshAccessToken } from './src/auth.ts';
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
globalThis.window = { localStorage, open() {} };

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
	const { handleGoogleLogin, refreshAccessToken, googleTokenStorageService } = require(outputPath);
	googleTokenStorageService.initialize(new FakeSecretStorage(secrets));
	let loginSuccessCount = 0;
	const handleLoginSuccess = () => {
		loginSuccessCount += 1;
	};
	await handleGoogleLogin({ googleClientId: 'client-id', googleClientSecret: 'settings-secret' }, handleLoginSuccess);
	assert.equal(typeof oauthCallback, 'function');
	const firstCallbackResponse = createCallbackResponse();
	await oauthCallback({ url: '/callback?code=auth-code' }, firstCallbackResponse);
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
	await oauthCallback({ url: '/callback?code=second-auth-code' }, createCallbackResponse());
	assert.equal(loginSuccessCount, 2);

	await refreshAccessToken('client-id');
	const parsedBody = JSON.parse(refreshRequestBody);
	assert.equal(parsedBody.client_secret, 'secret-from-storage');
	assert.notEqual(parsedBody.client_secret, 'settings-secret');

	loginResponse = {
		status: 400,
		json: { error: 'invalid_grant' },
	};
	await handleGoogleLogin({ googleClientId: 'client-id', googleClientSecret: 'settings-secret' }, handleLoginSuccess);
	const failedCallbackResponse = createCallbackResponse();
	await oauthCallback({ url: '/callback?code=expired-auth-code' }, failedCallbackResponse);
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
