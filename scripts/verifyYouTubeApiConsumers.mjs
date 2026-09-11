/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-youtube-api-consumers-'));
const outputPath = path.join(outputDirectory, 'youtube-api-consumers-verification.cjs');

try {
	await build({
		stdin: {
			contents: `
				export { PlaylistApi, LikedVideoApi } from './src/api.ts';
				export { YouTubeApiClient, YouTubeRequestError } from './src/services/youtubeApiClient.ts';
			`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'cjs',
		platform: 'node',
		outfile: outputPath,
		plugins: [{
			name: 'youtube-api-consumer-fixtures',
			setup(builder) {
				builder.onResolve({ filter: /^(obsidian|\.\/debug|src\/debug)$/ }, (args) => ({
					path: args.path,
					namespace: 'fixture',
				}));
				builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
					contents: name === 'obsidian'
						? `export const requestUrl = (request) => globalThis.requestUrl(request);`
						: `export const debugLogger = { api() {}, error() {}, warn() {}, verbose() {} };`,
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
	const { PlaylistApi, LikedVideoApi, YouTubeApiClient, YouTubeRequestError } = require(outputPath);
	const requests = [];
	let responses = [];
	globalThis.requestUrl = async (request) => {
		requests.push(request);
		const response = responses.shift();
		if (!response) throw new Error('Unexpected request');
		return response;
	};
	const client = new YouTubeApiClient(async () => 'shared-token');
	const playlistApi = new PlaylistApi(client);
	const likedVideoApi = new LikedVideoApi(client);

	const forbidden = {
		status: 403,
		json: { error: { message: 'Denied', errors: [{ reason: 'forbidden' }] } },
	};
	responses = [forbidden, forbidden];
	for (const request of [
		playlistApi.fetchUserPlaylists(),
		likedVideoApi.fetchLikedVideos(),
	]) {
		await assert.rejects(
			request,
			(error) => error instanceof YouTubeRequestError
				&& error.status === 403
				&& error.message === 'Denied'
				&& error.reasons.includes('forbidden'),
		);
	}

	responses = [
		{ status: 200, json: { items: [] } },
		{ status: 204, get json() { throw new Error('No JSON body'); } },
		{ status: 204, get json() { throw new Error('No JSON body'); } },
		{ status: 204, get json() { throw new Error('No JSON body'); } },
		{ status: 204, get json() { throw new Error('No JSON body'); } },
	];
	assert.equal(await playlistApi.addVideoToPlaylist('playlist-id', 'video-id'), 'added');
	await playlistApi.deletePlaylist('playlist-id');
	await likedVideoApi.likeVideo('video-id');
	await likedVideoApi.unlikeVideo('video-id');
	assert.deepEqual(
		requests.slice(-5).map((request) => request.method),
		['GET', 'POST', 'DELETE', 'POST', 'POST'],
	);
	assert.ok(requests.slice(-5).every((request) => request.headers.Authorization === 'Bearer shared-token'));

	console.log('youtube-api-consumers verification passed');
} finally {
	delete globalThis.requestUrl;
	await rm(outputDirectory, { recursive: true, force: true });
}
