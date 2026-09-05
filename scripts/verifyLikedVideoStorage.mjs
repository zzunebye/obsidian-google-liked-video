import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-liked-videos-'));
try {
	const output = path.join(root, 'storage.mjs');
	await build({ entryPoints: ['src/services/likedVideoStorageService.ts'], bundle: true, format: 'esm', platform: 'node', outfile: output });
	const { LikedVideoStorageService } = await import(pathToFileURL(output).href);
	const key = 'googleYtbLikedVideoLikedVideos';
	const video = { id: 'sample', snippet: { title: 'Sample', channelTitle: 'Channel', channelId: 'channel', publishedAt: '2026-01-01', description: '', thumbnails: { medium: { url: 'https://example.com/image.jpg' } }, tags: ['sample'] }, contentDetails: { duration: 'PT1M' }, statistics: { viewCount: 10 } };
	let failWrite = false;
	let failPrimaryWrite = false;
	let writes = 0;
	let reads = 0;
	let duringWrite;
	const adapter = {
		exists: async p => { try { await access(p); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } },
		read: async p => { reads++; return readFile(p, 'utf8'); },
		write: async (p, data) => { if (failWrite || (failPrimaryWrite && p.endsWith('/liked-videos.json'))) throw new Error('disk full'); writes++; await writeFile(p, data); if (duringWrite) { const action = duringWrite; duringWrite = undefined; action(); } },
	};
	const values = new Map([[key, JSON.stringify([video])]]);
	const legacy = { getItem: k => values.get(k) ?? null, removeItem: k => values.delete(k) };
	let store = new LikedVideoStorageService(adapter, root);
	assert.throws(() => store.getVideos(), /not been initialized/);
	failWrite = true;
	await assert.rejects(store.initialize(legacy), /disk full/);
	assert.ok(values.has(key));
	failWrite = false;
	await store.initialize(legacy);
	assert.equal(values.has(key), false);
	assert.deepEqual(JSON.parse(await readFile(store.filePath, 'utf8')).videos, [video]);
	console.log('PASS: migration writes/read-verifies before removing legacy; failed migration preserves it');

	values.set(key, JSON.stringify([{ ...video, id: 'stale' }]));
	store = new LikedVideoStorageService(adapter, root);
	await store.initialize(legacy);
	assert.equal(store.getVideos()[0].id, 'sample');
	const beforeReads = reads;
	for (let i = 0; i < 100; i++) store.getVideos();
	assert.equal(reads, beforeReads);
	const beforeWrites = writes;
	store.setVideos([]);
	const pending = store.flush();
	store.setVideos([video, { ...video, id: 'latest' }]);
	await store.flush();
	await pending;
	assert.equal(writes - beforeWrites, 2);
	console.log('PASS: file wins over legacy; reads use memory; synchronous updates share one backup/save cycle');

	duringWrite = () => store.setVideos([video]);
	store.setVideos([]);
	await store.flush();
	assert.deepEqual(JSON.parse(await readFile(store.filePath, 'utf8')).videos, [video]);
	failPrimaryWrite = true;
	store.setVideos([]);
	await assert.rejects(store.flush(), /disk full/);
	assert.deepEqual(JSON.parse(await readFile(store.filePath, 'utf8')).videos, [video]);
	assert.deepEqual(JSON.parse(await readFile(store.filePath + '.bak', 'utf8')).videos, [video]);
	failPrimaryWrite = false;
	await store.flush();
	const restart = new LikedVideoStorageService(adapter, root);
	await restart.initialize(legacy);
	assert.deepEqual(restart.getVideos(), []);
	console.log('PASS: changes during writes persist; failed replacement preserves file; retry and empty-list restart work');

	for (const invalid of ['{broken', JSON.stringify({ schemaVersion: 2, videos: [] }), JSON.stringify({ schemaVersion: 1, videos: [{}] })]) {
		await writeFile(store.filePath, invalid);
		values.set(key, JSON.stringify([video]));
		const broken = new LikedVideoStorageService(adapter, root);
		await assert.rejects(broken.initialize(legacy));
		assert.equal(await readFile(store.filePath, 'utf8'), invalid);
		assert.ok(values.has(key));
		assert.throws(() => broken.setVideos([]), /not been initialized/);
	}
	console.log('PASS: corrupt/unsupported files remain untouched and cannot be overwritten through the store');
} finally {
	await rm(root, { recursive: true, force: true });
}
