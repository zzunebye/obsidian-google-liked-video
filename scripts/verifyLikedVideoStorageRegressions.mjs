import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-storage-regressions-'));
try {
	const output = path.join(root, 'storage.mjs');
	await build({ entryPoints: ['src/services/likedVideoStorageService.ts'], bundle: true, format: 'esm', platform: 'node', outfile: output });
	const { LikedVideoStorageService } = await import(pathToFileURL(output).href);
	const { LikedVideoStorageService: ReloadedService } = await import(pathToFileURL(output).href + '?reload');
	const video = { id: 'old', snippet: { title: 'Fixture', channelTitle: 'Fixture', channelId: 'fixture', publishedAt: '2026-01-01', description: '', thumbnails: { medium: { url: 'https://example.com/image.png' } } }, contentDetails: { duration: 'PT1M' }, statistics: { viewCount: 10 } };
	let legacyRemoved = false;
	const legacy = { getItem: () => JSON.stringify([video]), removeItem: () => { legacyRemoved = true; } };
	let block = false;
	let release;
	let entered;
	const gate = new Promise(resolve => { release = resolve; });
	const started = new Promise(resolve => { entered = resolve; });
	const adapter = {
		exists: async p => existsSync(p),
		read: async p => {
			if (block && p.endsWith('/liked-videos.json')) throw new Error('read before previous save completed');
			return readFile(p, 'utf8');
		},
		write: async (p, data) => {
			if (p.endsWith('/liked-videos.json') && data.includes('new')) {
				block = true;
				entered();
				await gate;
				await writeFile(p, data);
				block = false;
				return;
			}
			await writeFile(p, data);
		},
	};
	const first = new LikedVideoStorageService(adapter, root);
	await first.initialize(legacy);
	first.setVideos([{ ...video, id: 'new' }]);
	const pending = first.flush();
	await started;
	const reloaded = new ReloadedService(adapter, root);
	const initialization = reloaded.initialize(legacy);
	const checked = assert.doesNotReject(initialization);
	setImmediate(release);
	await checked;
	await pending;
	assert.equal(reloaded.getVideos()[0].id, 'new');
	assert.throws(() => first.setVideos([video]), /closed/);
	reloaded.setVideos([...reloaded.getVideos(), { ...video, id: 'next' }]);
	await reloaded.flush();
	assert.deepEqual(JSON.parse(await readFile(first.filePath, 'utf8')).videos.map(v => v.id), ['new', 'next']);
	console.log('PASS: separate module reload waits for pending save, retains latest list, rejects old-instance updates');

	for (const field of ['viewCount', 'likeCount', 'commentCount']) {
		for (const value of [null, {}, [], true, -1, 'bad', '1oops']) {
			const content = JSON.stringify({ schemaVersion: 1, videos: [{ ...video, statistics: { ...video.statistics, [field]: value } }] });
			await writeFile(first.filePath, content);
			legacyRemoved = false;
			const invalid = new ReloadedService(adapter, root);
			await assert.rejects(invalid.initialize(legacy), /Invalid liked video/);
			assert.equal(legacyRemoved, false);
			assert.equal(await readFile(first.filePath, 'utf8'), content);
		}
	}
	console.log('PASS: malformed displayed counters rejected without altering JSON or removing legacy');

	for (const statistics of [{ viewCount: '123', likeCount: '0', commentCount: '4' }, { viewCount: 123, likeCount: 0, commentCount: 4 }, { viewCount: 123 }]) {
		await writeFile(first.filePath, JSON.stringify({ schemaVersion: 1, videos: [{ ...video, statistics }] }));
		const valid = new ReloadedService(adapter, root);
		await valid.initialize(legacy);
		assert.deepEqual(valid.getVideos()[0].statistics, statistics);
	}
	console.log('PASS: numeric counts, YouTube digit strings and omitted optional counts remain compatible');
} finally {
	await rm(root, { recursive: true, force: true });
}
