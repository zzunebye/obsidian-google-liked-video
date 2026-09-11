/* global globalThis */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-subscriptions-'));
let failures = 0;
try {
	const output = path.join(root, 'services.mjs');
	await build({
		stdin: {
			contents: `export { SubscriptionStorageService } from './src/services/subscriptionStorageService';
export { SubscriptionService } from './src/services/subscriptionService';
export { YouTubeApiClient } from './src/services/youtubeApiClient';
export { LikedVideoStorageService } from './src/services/likedVideoStorageService';
export { setResponses, getRequestCount } from 'obsidian';`,
			resolveDir: process.cwd(),
		},
		bundle: true, format: 'esm', platform: 'node', outfile: output,
		plugins: [{
			name: 'host-and-api-fixtures',
			setup(context) {
				context.onResolve({ filter: /^(obsidian|src\/debug)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
				context.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
					contents: name === 'obsidian' ? `
export const normalizePath = value => value.replace(/[\\\\/]+/g, '/');
let responses = []; let count = 0;
export function setResponses(next) { responses = [...next]; count = 0; }
export function getRequestCount() { return count; }
export async function requestUrl(options) {
 const next = responses.shift(); count++;
 if (!next || !options.url.includes(next.path)) throw new Error('Unexpected API request');
 if (next.response) return next.response;
 return { status: next.status ?? 200, json: next.body };
}` : 'export const debugLogger = { api() {}, warn() {} };',
				}));
			},
		}],
	});
	const { SubscriptionStorageService, SubscriptionService, YouTubeApiClient, LikedVideoStorageService, setResponses, getRequestCount } = await import(pathToFileURL(output).href);
	globalThis.window = {
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
	};
	const youtubeApiClient = new YouTubeApiClient(async () => 'fixture-token');
	const adapter = {
		exists: async p => { try { await access(p); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } },
		read: p => readFile(p, 'utf8'),
		write: (p, data) => writeFile(p, data),
	};
	const video = {
		id: 'upcoming',
		snippet: { title: 'Upcoming broadcast', channelTitle: 'Channel', channelId: 'channel', publishedAt: '2026-09-06T00:00:00Z', description: '', thumbnails: { medium: { url: 'https://example.com/image.jpg' } }, liveBroadcastContent: 'upcoming' },
		contentDetails: {}, statistics: { viewCount: '0' },
	};
	const channel = { id: 'channel', title: 'Channel', uploadsPlaylistId: 'uploads' };
	const snapshot = { channels: [channel], videos: [video], failedChannels: [], failureDetails: {}, updatedAt: 1 };
	const storage = new SubscriptionStorageService(adapter, root);
	const check = async (name, run) => {
		try { await run(); console.log(`PASS: ${name}`); }
		catch (error) { failures++; console.error(`FAIL: ${name}: ${error.message}`); }
	};
	await check('load and save an upcoming broadcast without inventing a duration', async () => {
		await writeFile(storage.filePath, JSON.stringify({ schemaVersion: 1, snapshot }));
		assert.deepEqual(await storage.load(), snapshot);
		await storage.save(snapshot);
		assert.deepEqual(await storage.load(), snapshot);
	});
	await check('invalid candidate leaves primary and backup byte-for-byte intact', async () => {
		const valid = { ...snapshot, videos: [{ ...video, contentDetails: { duration: 'PT1M' } }] };
		await storage.save(valid);
		const primary = await readFile(storage.filePath, 'utf8');
		const backup = await readFile(storage.filePath + '.bak', 'utf8');
		for (const duration of [null, 123, {}]) {
			await assert.rejects(storage.save({ ...snapshot, videos: [{ ...video, contentDetails: { duration } }] }));
			assert.equal(await readFile(storage.filePath, 'utf8'), primary);
			assert.equal(await readFile(storage.filePath + '.bak', 'utf8'), backup);
		}
	});
	await check('fetch subscriptions through every API stage, save, and restart', async () => {
		setResponses([
			{ path: '/subscriptions?', body: { items: [{ id: 'subscription', snippet: { title: 'Channel', resourceId: { channelId: 'channel' } } }] } },
			{ path: '/channels?', body: { items: [{ id: 'channel', contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] } },
			{ path: '/playlistItems?', body: { items: [{ contentDetails: { videoId: 'upcoming' } }] } },
			{ path: '/videos?', body: { items: [structuredClone(video)] } },
		]);
		const service = new SubscriptionService(youtubeApiClient, storage);
		const result = await service.fetch();
		assert.equal(result.videos.length, 1);
		assert.equal(result.videos[0].contentDetails.duration, undefined);
		assert.equal(getRequestCount(), 4);
		const restarted = new SubscriptionService(youtubeApiClient, storage);
		await restarted.initialize();
		assert.deepEqual(restarted.getSnapshot(), JSON.parse(JSON.stringify(result)));
	});
	await check('restart immediately after cancellation without reusing or committing the old request', async () => {
		let resolveOldRequest;
		const oldResponse = new Promise((resolve) => { resolveOldRequest = resolve; });
		setResponses([
			{ path: '/subscriptions?', response: oldResponse },
			{ path: '/subscriptions?', body: { items: [{ id: 'new-subscription', snippet: { title: 'New channel', resourceId: { channelId: 'new-channel' } } }] } },
			{ path: '/channels?', body: { items: [{ id: 'new-channel', contentDetails: { relatedPlaylists: { uploads: 'new-uploads' } } }] } },
			{ path: '/playlistItems?', body: { items: [] } },
		]);
		const service = new SubscriptionService(youtubeApiClient, storage);
		const oldController = new AbortController();
		const oldProgress = [];
		const oldFetch = service.fetch({
			signal: oldController.signal,
			onProgress: (progress) => oldProgress.push(progress),
		});
		await new Promise((resolve) => setImmediate(resolve));
		oldController.abort();
		const newFetch = service.fetch({ signal: new AbortController().signal });
		assert.notEqual(oldFetch, newFetch);
		await assert.rejects(oldFetch, (error) => error instanceof DOMException && error.name === 'AbortError');
		const next = await newFetch;
		assert.equal(next.channels[0].id, 'new-channel');
		assert.equal(service.getSnapshot().channels[0].id, 'new-channel');
		const progressCountAfterAbort = oldProgress.length;
		resolveOldRequest({ status: 200, json: { items: [] } });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(oldProgress.length, progressCountAfterAbort);
		assert.equal(service.getSnapshot().channels[0].id, 'new-channel');
	});
	await check('keep memory and later operations aligned when cancellation happens during persistence', async () => {
		let releaseFirstSave;
		let markFirstSaveStarted;
		let resolveNextSubscriptions;
		let persisted = structuredClone(snapshot);
		let saveCount = 0;
		const firstSaveStarted = new Promise((resolve) => { markFirstSaveStarted = resolve; });
		const firstSaveGate = new Promise((resolve) => { releaseFirstSave = resolve; });
		const nextSubscriptions = new Promise((resolve) => { resolveNextSubscriptions = resolve; });
		const controlledStorage = {
			load: async () => structuredClone(persisted),
			save: async (next) => {
				saveCount += 1;
				if (saveCount === 1) {
					markFirstSaveStarted();
					await firstSaveGate;
				}
				persisted = structuredClone(next);
			},
		};
		const service = new SubscriptionService(youtubeApiClient, controlledStorage);
		await service.initialize();
		setResponses([
			{ path: '/subscriptions?', body: { items: [{ id: 'persisted-subscription', snippet: { title: 'Persisted channel', resourceId: { channelId: 'persisted-channel' } } }] } },
			{ path: '/channels?', body: { items: [{ id: 'persisted-channel', contentDetails: { relatedPlaylists: { uploads: 'persisted-uploads' } } }] } },
			{ path: '/playlistItems?', body: { items: [] } },
		]);
		const stoppedController = new AbortController();
		const stoppedFetch = service.fetch({ signal: stoppedController.signal });
		await firstSaveStarted;
		stoppedController.abort();

		setResponses([
			{ path: '/subscriptions?', response: nextSubscriptions },
			{ path: '/channels?', body: { items: [{ id: 'next-channel', contentDetails: { relatedPlaylists: { uploads: 'next-uploads' } } }] } },
			{ path: '/playlistItems?', body: { items: [] } },
		]);
		const nextFetch = service.fetch({ signal: new AbortController().signal });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(getRequestCount(), 0);

		releaseFirstSave();
		await stoppedFetch;
		assert.equal(service.getSnapshot().channels[0].id, 'persisted-channel');
		assert.deepEqual(service.getSnapshot(), persisted);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(getRequestCount(), 1);

		resolveNextSubscriptions({
			status: 200,
			json: { items: [{ id: 'next-subscription', snippet: { title: 'Next channel', resourceId: { channelId: 'next-channel' } } }] },
		});
		const next = await nextFetch;
		assert.equal(next.channels[0].id, 'next-channel');
		assert.deepEqual(service.getSnapshot(), persisted);
	});
	await check('preserve subscription failure policy from structured YouTube reasons', async () => {
		setResponses([
			{ path: '/subscriptions?', body: { items: [{ id: 'subscription', snippet: { title: 'Channel', resourceId: { channelId: 'channel' } } }] } },
			{ path: '/channels?', body: { items: [{ id: 'channel', contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] } },
			{
				path: '/playlistItems?',
				status: 403,
				body: { error: { errors: [{ reason: 'forbidden' }] } },
			},
		]);
		const service = new SubscriptionService(youtubeApiClient, storage);
		const result = await service.fetch();
		assert.equal(result.failedChannels[0].id, 'channel');
		assert.equal(result.failureDetails.channel.retryable, false);
		assert.match(result.failureDetails.channel.message, /denied access/);
	});
	await check('accept a 204 unsubscribe response and commit only the successful removal', async () => {
		const subscribedSnapshot = {
			...snapshot,
			channels: [{ ...channel, subscriptionId: 'subscription' }],
		};
		await storage.save(subscribedSnapshot);
		const service = new SubscriptionService(youtubeApiClient, storage);
		await service.initialize();
		setResponses([{
			path: '/subscriptions?',
			response: Promise.resolve({
				status: 204,
				get json() { throw new Error('No JSON body'); },
			}),
		}]);
		const result = await service.unsubscribeChannels(subscribedSnapshot.channels);
		assert.equal(result.succeededChannels.length, 1);
		assert.equal(result.failedChannels.length, 0);
		assert.equal(result.snapshot.channels.length, 0);
	});
	await check('liked-video persistence accepts the same upcoming broadcast', async () => {
		const liked = new LikedVideoStorageService(adapter, root);
		await liked.initialize({ getItem: () => null, removeItem() {} });
		liked.setVideos([video]);
		await liked.flush();
		const restarted = new LikedVideoStorageService(adapter, root);
		await restarted.initialize({ getItem: () => null, removeItem() {} });
		assert.deepEqual(restarted.getVideos(), [video]);
		await restarted.close();
	});
	if (process.argv[2]) await check('actual saved snapshot loads and round-trips without changing any records', async () => {
		const original = await readFile(process.argv[2], 'utf8');
		await writeFile(storage.filePath, original);
		const loaded = await storage.load();
		assert.deepEqual(loaded, JSON.parse(original).snapshot);
		await storage.save(loaded);
		assert.deepEqual(await storage.load(), loaded);
		console.log(`Verified ${loaded.channels.length} channels and ${loaded.videos.length} videos`);
	});
} finally {
	await rm(root, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;
