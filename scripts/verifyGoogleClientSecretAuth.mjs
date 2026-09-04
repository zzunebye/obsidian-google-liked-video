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
			builder.onLoad({ filter: /.*/, namespace: 'verification' }, () => ({
				contents: `
					export const Platform = { isDesktop: true };
					export class Notice { constructor() {} }
				`,
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
let loginRequestUrl = '';
let loginRequestBody = '';
let refreshRequestBody = '';

const httpVerification = {
	createServer(callback) {
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

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
	const requestBody = String(init.body);
	if (requestBody.includes('grant_type=authorization_code')) {
		loginRequestUrl = String(url);
		loginRequestBody = requestBody;
		return { json: async () => ({ refresh_token: 'new-refresh', access_token: 'new-access', expires_in: 3600 }) };
	}
	refreshRequestBody = requestBody;
	return { json: async () => ({ access_token: 'refreshed-access', expires_in: 3600 }) };
};

const require = createRequire(import.meta.url);
const nodeModule = require('node:module');
const originalLoad = nodeModule._load;
nodeModule._load = function(request, parent, isMain) {
	if (request === 'http') {
		return httpVerification;
	}
	return originalLoad.call(this, request, parent, isMain);
};

try {
	const { handleGoogleLogin, refreshAccessToken, googleTokenStorageService } = require(outputPath);
	googleTokenStorageService.initialize(new FakeSecretStorage(secrets));
	await handleGoogleLogin({ googleClientId: 'client-id', googleClientSecret: 'settings-secret' }, () => {});
	assert.equal(typeof oauthCallback, 'function');
	await oauthCallback({ url: '/callback?code=auth-code' }, { end() {} });
	assert.equal(loginRequestUrl, 'https://oauth2.googleapis.com/token');
	assert.doesNotMatch(loginRequestUrl, /client_secret/);
	const parsedLoginBody = new URLSearchParams(loginRequestBody);
	assert.equal(parsedLoginBody.get('grant_type'), 'authorization_code');
	assert.equal(parsedLoginBody.get('client_id'), 'client-id');
	assert.equal(parsedLoginBody.get('client_secret'), 'secret-from-storage');
	assert.equal(parsedLoginBody.get('code'), 'auth-code');

	await refreshAccessToken('client-id');
	const parsedBody = JSON.parse(refreshRequestBody);
	assert.equal(parsedBody.client_secret, 'secret-from-storage');
	assert.notEqual(parsedBody.client_secret, 'settings-secret');
} finally {
	nodeModule._load = originalLoad;
	globalThis.fetch = originalFetch;
}

console.log('google-client-secret auth verification passed');
