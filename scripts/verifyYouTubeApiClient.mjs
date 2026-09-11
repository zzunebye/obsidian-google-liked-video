/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-youtube-api-client-'));
const outputPath = path.join(outputDirectory, 'youtube-api-client-verification.cjs');

try {
	await build({
		stdin: {
			contents: `export { YouTubeApiClient, YouTubeRequestError } from './src/services/youtubeApiClient.ts';`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'cjs',
		platform: 'node',
		outfile: outputPath,
		plugins: [{
			name: 'youtube-api-client-fixtures',
			setup(builder) {
				builder.onResolve({ filter: /^(obsidian|src\/debug)$/ }, (args) => ({
					path: args.path,
					namespace: 'fixture',
				}));
				builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
					contents: name === 'obsidian'
						? `export const requestUrl = (request) => globalThis.requestUrl(request);`
						: `export const debugLogger = { api() {} };`,
					loader: 'js',
				}));
			},
		}],
	});

	globalThis.window = {
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
	};
	const require = createRequire(import.meta.url);
	const { YouTubeApiClient, YouTubeRequestError } = require(outputPath);
	let tokenRequests = 0;
	let requests = [];
	let response = { status: 200, json: { items: [] } };
	globalThis.requestUrl = async (request) => {
		requests.push(request);
		return response;
	};
	const client = new YouTubeApiClient(async () => {
		tokenRequests += 1;
		return 'access-token';
	});

	const ok = await client.request('GET', 'videos?part=id');
	assert.equal(ok.status, 200);
	assert.equal(tokenRequests, 1);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, 'https://youtube.googleapis.com/youtube/v3/videos?part=id');
	assert.equal(requests[0].headers.Authorization, 'Bearer access-token');

	response = {
		status: 204,
		get json() {
			throw new Error('No JSON body');
		},
	};
	assert.equal((await client.request('DELETE', 'playlists?id=playlist')).status, 204);

	response = {
		status: 403,
		json: { error: { message: 'Quota exhausted', errors: [{ reason: 'quotaExceeded' }] } },
	};
	await assert.rejects(
		client.request('GET', 'playlists?mine=true'),
		(error) => error instanceof YouTubeRequestError
			&& error.kind === 'http'
			&& error.status === 403
			&& error.reasons.includes('quotaExceeded')
			&& error.message === 'Quota exhausted',
	);
	response = {
		status: 500,
		get json() {
			throw new Error('Invalid JSON');
		},
	};
	await assert.rejects(
		client.request('GET', 'videos'),
		(error) => error instanceof YouTubeRequestError
			&& error.status === 500
			&& error.message === 'YouTube API request failed (500).',
	);
	response = { status: 401, json: { error: { message: 'Expired token' } } };
	const requestsBeforeUnauthorized = requests.length;
	await assert.rejects(
		client.request('GET', 'videos'),
		(error) => error instanceof YouTubeRequestError && error.kind === 'auth' && error.status === 401,
	);
	assert.equal(requests.length, requestsBeforeUnauthorized + 1);

	const preAborted = new AbortController();
	preAborted.abort();
	const countsBeforeAbort = [tokenRequests, requests.length];
	await assert.rejects(
		client.request('GET', 'videos', { signal: preAborted.signal }),
		(error) => error instanceof DOMException && error.name === 'AbortError',
	);
	assert.deepEqual([tokenRequests, requests.length], countsBeforeAbort);

	let releaseToken;
	const tokenWaitClient = new YouTubeApiClient(() => new Promise((resolve) => { releaseToken = resolve; }));
	const tokenAbort = new AbortController();
	const waitingForToken = tokenWaitClient.request('GET', 'videos', { signal: tokenAbort.signal });
	tokenAbort.abort();
	await assert.rejects(waitingForToken, (error) => error instanceof DOMException && error.name === 'AbortError');
	const requestsBeforeRelease = requests.length;
	releaseToken('late-token');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(requests.length, requestsBeforeRelease);

	let releaseTimedToken;
	const originalSetTimeout = globalThis.window.setTimeout;
	const originalClearTimeout = globalThis.window.clearTimeout;
	globalThis.window.setTimeout = (callback) => {
		queueMicrotask(callback);
		return 1;
	};
	globalThis.window.clearTimeout = () => {};
	const timeoutClient = new YouTubeApiClient(() => new Promise((resolve) => { releaseTimedToken = resolve; }));
	await assert.rejects(
		timeoutClient.request('GET', 'videos'),
		(error) => error instanceof YouTubeRequestError && error.kind === 'timeout',
	);
	globalThis.window.setTimeout = originalSetTimeout;
	globalThis.window.clearTimeout = originalClearTimeout;
	const requestsBeforeTimedRelease = requests.length;
	releaseTimedToken('late-token');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(requests.length, requestsBeforeTimedRelease);

	let releaseRequest;
	globalThis.requestUrl = (request) => {
		requests.push(request);
		return new Promise((resolve) => { releaseRequest = resolve; });
	};
	const requestAbort = new AbortController();
	const waitingForResponse = client.request('GET', 'videos', { signal: requestAbort.signal });
	await new Promise((resolve) => setImmediate(resolve));
	requestAbort.abort();
	await assert.rejects(waitingForResponse, (error) => error instanceof DOMException && error.name === 'AbortError');
	releaseRequest({ status: 200, json: { items: [] } });
	await new Promise((resolve) => setImmediate(resolve));

	globalThis.requestUrl = async () => { throw new Error('offline'); };
	await assert.rejects(
		client.request('GET', 'videos'),
		(error) => error instanceof YouTubeRequestError && error.kind === 'network',
	);
	await assert.rejects(client.request('GET', 'https://example.com'), /relative path/);

	console.log('youtube-api-client verification passed');
} finally {
	delete globalThis.requestUrl;
	await rm(outputDirectory, { recursive: true, force: true });
}
