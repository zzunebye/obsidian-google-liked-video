/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-summary-storage-'));

class MemoryAdapter {
	constructor(initialFiles = new Map()) {
		this.files = new Map(initialFiles);
		this.writeCount = 0;
		this.activeWrites = 0;
		this.maxConcurrentWrites = 0;
		this.failNextWrite = false;
	}

	async exists(filePath) {
		return this.files.has(filePath);
	}

	async read(filePath) {
		const content = this.files.get(filePath);
		if (content === undefined) throw new Error(`Missing file: ${filePath}`);
		return content;
	}

	async write(filePath, content) {
		this.activeWrites++;
		this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.activeWrites);
		try {
			await new Promise(resolve => setImmediate(resolve));
			if (this.failNextWrite) {
				this.failNextWrite = false;
				throw new Error('disk full');
			}
			this.files.set(filePath, content);
			this.writeCount++;
		} finally {
			this.activeWrites--;
		}
	}
}

const metadata = videoId => ({
	title: `Title ${videoId}`,
	channelTitle: 'Channel',
	channelId: 'channel',
	videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
});

const summary = (videoId, source) => ({
	summary: `Summary ${videoId}`,
	generatedAt: `2026-09-16T00:00:0${videoId.length}.000Z`,
	model: 'test-model',
	...(source === undefined ? {} : { source }),
});

const storedSummaries = (adapter, filePath) => JSON.parse(adapter.files.get(filePath)).summaries;

try {
	const output = path.join(root, 'summary-storage.mjs');
	await build({
		entryPoints: ['src/services/summaryStorageService.ts'],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: output,
		plugins: [{
			name: 'obsidian-mock',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
				buildContext.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
					contents: `export const normalizePath = value => value.replace(/[\\\\/]+/g, '/').replace(/^\\/+|\\/+$/g, '');`,
				}));
			},
		}],
	});

	globalThis.window = {};
	const { SummaryStorageService } = await import(pathToFileURL(output).href);
	const pluginDir = '.obsidian\\plugins//geulo';
	const filePath = '.obsidian/plugins/geulo/summaries.json';
	const legacyEntry = {
		schemaVersion: 1,
		videoId: 'legacy',
		title: 'Legacy title',
		channelTitle: 'Legacy channel',
		channelId: 'legacy-channel',
		videoUrl: 'https://www.youtube.com/watch?v=legacy',
		summary: 'Legacy summary',
		generatedAt: '2026-09-15T00:00:00.000Z',
		model: 'legacy-model',
	};
	const adapter = new MemoryAdapter(new Map([[
		filePath,
		JSON.stringify({ schemaVersion: 1, summaries: { legacy: legacyEntry } }),
	]]));
	const storage = new SummaryStorageService(adapter, pluginDir, 2);
	await storage.initialize();
	assert.deepEqual(await storage.getVideoSummaryData('legacy'), legacyEntry);

	let notifications = 0;
	const unsubscribe = storage.subscribe(() => { notifications++; });
	await storage.setVideoSummary('a', summary('a'), metadata('a'));
	await storage.setVideoSummary('b', summary('b', 'transcript'), metadata('b'));
	assert.equal(storage.hasVideoSummary('legacy'), false, 'Oldest initialized entry should be evicted');
	await storage.setVideoSummary('a', summary('a', 'transcript'), metadata('a'));
	await storage.setVideoSummary('c', summary('c'), metadata('c'));
	assert.equal(storage.hasVideoSummary('b'), false, 'Updating an entry should make it newest before eviction');
	assert.deepEqual(Object.keys(storedSummaries(adapter, filePath)), ['a', 'c']);
	assert.equal((await storage.getVideoSummaryData('a')).source, 'transcript');
	assert.equal((await storage.getVideoSummaryData('c')).source, 'video');
	assert.equal(notifications, 4);

	await storage.setOneLinerSummary('a', 'One line');
	assert.equal(storage.getOneLineSummary('a'), 'One line');
	assert.equal(storedSummaries(adapter, filePath).a.oneLinerSummary, 'One line');
	await storage.deleteVideoSummary('c');
	assert.equal(storage.hasVideoSummary('c'), false);
	assert.deepEqual(Object.keys(storedSummaries(adapter, filePath)), ['a']);
	assert.equal(notifications, 6);
	unsubscribe();
	await storage.setOneLinerSummary('a', 'Updated');
	assert.equal(notifications, 6, 'Unsubscribed listeners should not receive successful writes');
	console.log('PASS: load, update-order eviction, source metadata, one-liner, delete, and subscriptions persist');

	const recoveryAdapter = new MemoryAdapter();
	const recoveryStorage = new SummaryStorageService(recoveryAdapter, pluginDir, 10);
	await recoveryStorage.initialize();
	await recoveryStorage.setVideoSummary('stable', summary('stable'), metadata('stable'));
	const beforeFailure = recoveryAdapter.files.get(filePath);
	let recoveryNotifications = 0;
	recoveryStorage.subscribe(() => { recoveryNotifications++; });
	recoveryAdapter.failNextWrite = true;
	await assert.rejects(
		recoveryStorage.setVideoSummary('failed', summary('failed'), metadata('failed')),
		/disk full/,
	);
	assert.equal(recoveryStorage.hasVideoSummary('failed'), false);
	assert.equal(recoveryAdapter.files.get(filePath), beforeFailure);
	assert.equal(recoveryNotifications, 0, 'Failed writes should not notify subscribers');

	await recoveryStorage.setVideoSummary('recovered', summary('recovered'), metadata('recovered'));
	const firstQueued = recoveryStorage.setVideoSummary('queued-1', summary('queued-1'), metadata('queued-1'));
	const secondQueued = recoveryStorage.setVideoSummary('queued-2', summary('queued-2'), metadata('queued-2'));
	await Promise.all([firstQueued, secondQueued]);
	assert.deepEqual(Object.keys(storedSummaries(recoveryAdapter, filePath)), [
		'stable',
		'recovered',
		'queued-1',
		'queued-2',
	]);
	assert.equal(recoveryAdapter.maxConcurrentWrites, 1, 'Queued writes must never overlap');
	assert.equal(recoveryNotifications, 3);
	console.log('PASS: failed writes roll back, later writes recover, and concurrent requests serialize without lost updates');

	storage.cleanup();
	recoveryStorage.cleanup();
	assert.equal(storage.hasVideoSummary('a'), false);
	assert.equal(recoveryStorage.hasVideoSummary('stable'), false);
	console.log('PASS: cleanup clears summary caches');
} finally {
	await rm(root, { recursive: true, force: true });
}
