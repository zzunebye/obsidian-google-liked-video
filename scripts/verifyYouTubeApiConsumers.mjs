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
				export { fetchAndMergeLikedVideos } from './src/services/likedVideoFetchService.ts';
				export { localStorageService } from './src/storage.ts';
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
	const { PlaylistApi, LikedVideoApi, YouTubeApiClient, YouTubeRequestError, fetchAndMergeLikedVideos, localStorageService } = require(outputPath);
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

	const requestCountBeforeBlockedMutation = requests.length;
	const guardedLikedVideoApi = new LikedVideoApi(client, async () => {
		throw new Error('cache owner mismatch');
	});
	await assert.rejects(guardedLikedVideoApi.likeVideo('video-id'), /cache owner mismatch/);
	await assert.rejects(guardedLikedVideoApi.unlikeVideo('video-id'), /cache owner mismatch/);
	assert.equal(requests.length, requestCountBeforeBlockedMutation);
	console.log('PASS: liked-video mutations verify cache ownership before changing YouTube');

	responses = [{ status: 200, json: { items: [
		{ videoId: 'liked', rating: 'like' }, { videoId: 'none', rating: 'none' },
		{ videoId: 'disliked', rating: 'dislike' }, { videoId: 'unknown', rating: 'unspecified' },
	] } }];
	assert.deepEqual([...await likedVideoApi.getVideoRatings(['liked', 'none', 'disliked', 'unknown', 'missing'])],
		[['liked', true], ['none', false], ['disliked', false]]);
	for (const items of [null, [{ videoId: 'liked', rating: ['like'] }], [{ videoId: 'liked', rating: 'invalid' }], [{ videoId: 'other', rating: 'like' }]]) {
		responses = [{ status: 200, json: { items } }];
		await assert.rejects(likedVideoApi.getVideoRatings(['liked']), /invalid video/);
	}
	const ratingIds = Array.from({ length: 51 }, (_, index) => `rating-${index}`);
	responses = [
		{ status: 200, json: { items: ratingIds.slice(0, 50).map(videoId => ({ videoId, rating: 'like' })) } },
		{ status: 200, json: { items: [{ videoId: ratingIds[50], rating: 'none' }] } },
	];
	const batchedRatings = await likedVideoApi.getVideoRatings([...ratingIds, ratingIds[0]]);
	assert.equal(batchedRatings.size, 51); assert.equal(batchedRatings.get(ratingIds[50]), false);
	assert.equal(new URL(requests.at(-2).url).searchParams.get('id').split(',').length, 50);
	assert.equal(new URL(requests.at(-1).url).searchParams.get('id'), ratingIds[50]);
	console.log('PASS: rating booleans, unknown/missing responses, validation, batching and duplicate IDs');

	const savedVideo = {
		id: 'saved-video', pulled_at: '2026-01-01T00:00:00Z',
		snippet: { title: 'Saved video', channelTitle: 'Channel', channelId: 'channel', publishedAt: '2026-01-01', description: '', thumbnails: { medium: { url: 'https://example.com/image.jpg' } } },
		contentDetails: { duration: 'PT1M' }, statistics: { viewCount: '10' },
	};
	let savedVideos = [savedVideo];
	localStorageService.initializeLikedVideos({
		getVideos: () => savedVideos,
		setVideos: () => assert.fail('Fetching must not persist before validation'),
	}, () => {});
	const fullSync = () => fetchAndMergeLikedVideos(likedVideoApi, { mode: 'full', keepUnfetched: false });
	for (const json of [null, {}, { error: { message: 'Unexpected success body' } },
		{ items: null }, { items: {} }, { items: [null] }, { items: [{}] },
		{ items: [{ id: 'incomplete-video', snippet: {}, contentDetails: {}, statistics: {} }] },
		{ items: [{ ...savedVideo, id: '' }] },
		{ items: [savedVideo], nextPageToken: 42 }]) {
		responses = [{ status: 200, json }];
		await assert.rejects(fullSync(), /invalid liked-video response/);
		assert.deepEqual(savedVideos, [savedVideo]);
	}
	responses = [{ status: 200, json: { items: [] } }];
	await assert.rejects(fullSync(), /saved list was kept.*Clear saved videos/);
	assert.deepEqual(savedVideos, [savedVideo]);
	responses = [{ status: 200, json: { items: [] } }];
	assert.deepEqual((await fetchAndMergeLikedVideos(likedVideoApi, {
		mode: 'full',
		keepUnfetched: false,
		allowEmptyFullReplacement: true,
	})).mergedVideos, []);
	console.log('PASS: malformed success responses and empty full sync cannot replace a non-empty saved list');

	for (const lastPage of [{ status: 200, json: {} }, forbidden]) {
		responses = [
			{ status: 200, json: { items: [{ ...savedVideo, id: 'first-page' }], nextPageToken: 'second-page' } },
			lastPage,
		];
		await assert.rejects(fullSync());
		assert.deepEqual(savedVideos, [savedVideo]);
		assert.match(requests.at(-1).url, /pageToken=second-page/);
	}
	console.log('PASS: malformed or failed later pages reject the whole sync without a partial replacement');

	responses = [{ status: 200, json: { items: [] } }];
	const partial = await fetchAndMergeLikedVideos(likedVideoApi, { mode: 'partial', keepUnfetched: true });
	assert.deepEqual(partial.mergedVideos, savedVideos);
	assert.equal(partial.fetchedCount, 0);
	assert.deepEqual(partial.newVideos, []);
	assert.equal(partial.updatedCount, 0);

	savedVideos = [savedVideo, { ...savedVideo, id: 'removed-video' }];
	responses = [
		{ status: 200, json: { items: [{ ...savedVideo, snippet: { ...savedVideo.snippet, title: 'Updated video' } }], nextPageToken: 'next' } },
		{ status: 200, json: { items: [{ ...savedVideo, id: 'new-video' }] } },
	];
	const full = await fullSync();
	assert.deepEqual(full.mergedVideos.map(video => video.id), ['saved-video', 'new-video']);
	assert.equal(full.mergedVideos[0].pulled_at, savedVideo.pulled_at);
	assert.equal(full.mergedVideos[0].snippet.title, 'Updated video');
	assert.deepEqual(full.newVideos.map(video => video.id), ['new-video']);
	assert.equal(full.updatedCount, 1);
	assert.equal(full.fetchedCount, 2);

	savedVideos = [];
	responses = [{ status: 200, json: { items: [] } }];
	assert.deepEqual((await fullSync()).mergedVideos, []);
	console.log('PASS: partial empty fetch, valid paginated replacement and an initially empty account retain their existing behavior');

	let ownerChannelId = 'old-owner';
	let failOwnedSave = true;
	savedVideos = [savedVideo];
	localStorageService.initializeLikedVideos({
		getVideos: () => savedVideos,
		getOwnerChannelId: () => ownerChannelId,
		setVideos: (videos) => { savedVideos = videos; },
		flush: async () => {},
		setVideosForOwner: async (videos, owner) => {
			if (failOwnedSave && owner === 'new-owner') throw new Error('disk full');
			savedVideos = videos;
			ownerChannelId = owner;
		},
	}, () => {});
	localStorageService.removeLikedVideo(savedVideo.id);
	await assert.rejects(
		localStorageService.setLikedVideosForOwner([savedVideo], 'new-owner'),
		/disk full/,
	);
	await localStorageService.setLikedVideosForOwner([savedVideo], 'old-owner');
	assert.deepEqual(savedVideos, []);
	failOwnedSave = false;
	await localStorageService.setLikedVideosForOwner([savedVideo], 'new-owner');
	assert.deepEqual(savedVideos, [savedVideo]);
	assert.equal(ownerChannelId, 'new-owner');
	console.log('PASS: failed account replacement keeps old unlike guards; successful replacement clears them');

	console.log('youtube-api-consumers verification passed');
} finally {
	delete globalThis.requestUrl;
	await rm(outputDirectory, { recursive: true, force: true });
}
