import assert from 'node:assert/strict';
import { load as parseYaml } from 'js-yaml';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-video-note-id-'));
try {
	const entry = path.join(root, 'entry.ts');
	const output = path.join(root, 'entry.mjs');
	await writeFile(entry, `
		import { TFile } from 'obsidian';
		export { TFile, notices } from 'obsidian';
		export { VideoNoteIndexService } from ${JSON.stringify(path.resolve('src/services/videoNoteIndexService.ts'))};
		export { ensureVideoNoteId, findVideoNote, updateVideoNoteLiked } from ${JSON.stringify(path.resolve('src/utils/videoNoteUtils.ts'))};
		export { VideoNoteService } from ${JSON.stringify(path.resolve('src/services/videoNoteService.ts'))};
		export { generateVideoNoteContent, buildTemplateVariables } from ${JSON.stringify(path.resolve('src/utils/noteUtils.ts'))};
		export { likeVideoAndPersist, unlikeVideoAndPersist } from ${JSON.stringify(path.resolve('src/services/likedVideoMutationService.ts'))};
		export { localStorageService } from ${JSON.stringify(path.resolve('src/storage.ts'))};
	`);
	await build({
		entryPoints: [entry],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: output,
		plugins: [{
			name: 'obsidian-mock',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
				buildContext.onResolve({ filter: /^obsidian-daily-notes-interface$/ }, () => ({ path: 'daily', namespace: 'mock' }));
				buildContext.onResolve({ filter: /^(src\/debug|\.\.\/debug)$/ }, () => ({ path: 'debug', namespace: 'mock' }));
				buildContext.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
					contents: name === 'daily'
						? 'export const getAllDailyNotes = () => []; export const getDailyNote = () => null; export const createDailyNote = async () => null;'
						: name === 'debug' ? 'export const debugLogger = { error() {} };' : `
							export class TFile { constructor(path, frontmatter = {}) { this.path = path; this.frontmatter = frontmatter; } }
							export class MarkdownView {}
							export const notices = [];
							export class Notice { constructor(text) { notices.push(text); } }
							export const normalizePath = path => path;
							export const moment = () => ({ format: () => '2026-09-16' });
						`,
				}));
			},
		}],
	});

	const { TFile, notices, ensureVideoNoteId, findVideoNote, VideoNoteIndexService, VideoNoteService, generateVideoNoteContent, buildTemplateVariables, likeVideoAndPersist, unlikeVideoAndPersist, localStorageService } = await import(pathToFileURL(output).href);
	const legacy = new TFile('Youtube/Legacy title.md');
	const moved = new TFile('Archive/Renamed note.md', { video_id: 'moved-id' });
	const conflicting = new TFile('Youtube/Conflict.md', { video_id: 'other-id' });
	const files = [legacy, moved, conflicting];
	let writes = 0, scans = 0, notifications = 0;
	const vaultListeners = new Map(), metadataListeners = new Map(), missingCache = new Set();
	const events = listeners => ({
		on(name, callback) { listeners.set(name, callback); return name; },
		offref(name) { listeners.delete(name); },
	});
	const app = {
		vault: {
			...events(vaultListeners),
			getMarkdownFiles: () => { scans++; assert.equal(scans, 1, 'only index initialization may scan the vault'); return files; },
			getAbstractFileByPath: candidate => files.find(file => file.path === candidate) ?? null,
		},
		metadataCache: {
			...events(metadataListeners),
			getFileCache: file => missingCache.has(file) ? null : ({ frontmatter: file.frontmatter }),
		},
		fileManager: {
			processFrontMatter: async (file, update) => {
				writes++;
				update(file.frontmatter);
			},
		},
	};

	const index = new VideoNoteIndexService(app);
	index.subscribe(() => notifications++);
	assert.equal(findVideoNote(app, index, 'legacy-id', ['Youtube/Missing.md', legacy.path]), legacy);
	await ensureVideoNoteId(app, index, legacy, 'legacy-id');
	assert.equal(legacy.frontmatter.video_id, 'legacy-id');
	assert.equal(findVideoNote(app, index, 'moved-id', ['Youtube/Old title.md']), moved);
	assert.equal(index.get('moved-id'), moved);
	await ensureVideoNoteId(app, index, moved, 'moved-id');
	assert.equal(writes, 1);
	assert.throws(() => findVideoNote(app, index, 'wanted-id', [conflicting.path]), /belongs to another video/);
	await assert.rejects(ensureVideoNoteId(app, index, conflicting, 'wanted-id'), /belongs to another video/);

	const beforeBodyChange = notifications;
	metadataListeners.get('changed')(moved);
	const unrelated = new TFile('Regular note.md');
	metadataListeners.get('changed')(unrelated);
	assert.equal(notifications, beforeBodyChange, 'unchanged mappings do not invalidate views');

	const oldPath = moved.path;
	moved.path = 'Another folder/New title.md';
	missingCache.add(moved);
	vaultListeners.get('rename')(moved, oldPath);
	assert.equal(index.get('moved-id'), moved, 'rename preserves identity while metadata loads');
	missingCache.delete(moved);
	moved.frontmatter.video_id = 'changed-id';
	metadataListeners.get('changed')(moved);
	assert.equal(index.has('moved-id'), false);
	assert.equal(index.get('changed-id'), moved);
	delete moved.frontmatter.video_id;
	metadataListeners.get('changed')(moved);
	assert.equal(index.has('changed-id'), false);

	const newlyCreated = new TFile('Fresh.md');
	files.push(newlyCreated); missingCache.add(newlyCreated);
	vaultListeners.get('create')(newlyCreated);
	await ensureVideoNoteId(app, index, newlyCreated, 'fresh-id');
	assert.equal(index.get('fresh-id'), newlyCreated, 'confirmed writes update the index before metadata arrives');
	assert.equal(findVideoNote(app, index, 'fresh-id', []), newlyCreated);
	missingCache.delete(newlyCreated);
	const beforeRefresh = notifications;
	metadataListeners.get('changed')(newlyCreated);
	assert.equal(notifications, beforeRefresh);

	const duplicate = new TFile('Duplicate.md', {video_id:'fresh-id'});
	files.push(duplicate); vaultListeners.get('create')(duplicate);
	metadataListeners.get('changed')(newlyCreated);
	assert.equal(index.get('fresh-id'), newlyCreated, 'body changes preserve duplicate selection order');
	files.splice(files.indexOf(newlyCreated),1); vaultListeners.get('delete')(newlyCreated);
	assert.equal(index.get('fresh-id'), duplicate);
	files.splice(files.indexOf(duplicate),1);
	assert.equal(index.get('fresh-id'), null, 'lookup checks the file still exists');
	assert.equal(index.has('fresh-id'), false);

	const beforeLegacyLifecycle = notifications;
	vaultListeners.get('create')(unrelated);
	vaultListeners.get('delete')(unrelated);
	assert.equal(notifications, beforeLegacyLifecycle + 2, 'legacy path existence still refreshes on file lifecycle changes');
	assert.equal(scans, 1);
	assert.deepEqual(index.getAll('legacy-id'), [legacy]);
	assert.ok(index.getVideoIds().includes('legacy-id'));
	const video = id => ({ id, pulled_at: '2026-09-16', snippet: {
		title: id, channelTitle: 'Channel', channelId: 'channel', categoryId: '27',
		publishedAt: '2026-01-01', tags: [], description: '', thumbnails: {},
	}, contentDetails: { duration: 'PT1M' }, statistics: {} });
	app.fileManager.getNewFileParent = () => ({ path: '' });
	app.vault.create = async (path, content) => {
		assert.ok(!files.some(file => file.path === path), 'no duplicate creation');
		const fm = parseYaml(content.match(/^---\n([\s\S]*?)\n---/)[1]) ?? {};
		const file = new TFile(path, fm); file.content = content;
		files.push(file); index.record(file, fm.video_id);
		return file;
	};
	let requests = 0;
	let ratingResponse = async ids => new Map(ids.map(id => [id, false]));
	const plugin = { app, videoNoteIndex: index, settings: { videoNotePath: '', organizeByChannel: false, enableTemplateSystem: false },
		getCategoryDisplay: () => 'Education', likedVideoApi: { getVideoRatings: async ids => { requests++; return ratingResponse(ids); } } };
	const notes = new VideoNoteService(plugin);
	const [first, same] = await Promise.all([notes.getOrCreate(video('new-video')), notes.getOrCreate(video('new-video'))]);
	assert.equal(first.file, same.file); assert.equal(requests, 1);
	assert.equal(first.file.frontmatter.liked, false);
	const copy = new TFile('Copy.md', { video_id: 'new-video', custom: 'keep' }); files.push(copy); index.record(copy, 'new-video');
	await notes.captureLikedUpdate()('new-video', true);
	assert.equal(first.file.frontmatter.liked, true); assert.equal(copy.frontmatter.liked, true); assert.equal(copy.frontmatter.custom, 'keep');
	await notes.captureLikedUpdate()('new-video', false);
	await notes.captureLikedUpdate()('new-video', true);
	assert.equal(copy.frontmatter.liked, true, 'Undo updates every canonical copy');
	assert.equal(buildTemplateVariables(video('template'), 'url', undefined, false).liked, 'false');
	assert.match(await generateVideoNoteContent(video('template'), 'url', undefined, undefined, true), /\nliked: true\n/);
	plugin.settings.enableTemplateSystem = true;
	plugin.settings.customTemplate = '---\nvideo_id: "{{video_id}}"\nliked: "{{liked}}"\ncustom: keep\n---\nBody';
	const templated = await notes.getOrCreate(video('templated'));
	assert.equal(templated.file.frontmatter.liked, false); assert.equal(templated.file.frontmatter.custom, 'keep');
	assert.match(templated.file.content, /Body$/);
	ratingResponse = async () => { throw new Error('offline'); };
	templated.file.frontmatter.liked = true;
	await notes.refreshLiked('templated');
	assert.equal(templated.file.frontmatter.liked, true, 'failed refresh preserves file values even when the service cached an older value');
	const unknown = await notes.getOrCreate(video('unknown'));
	assert.equal(Object.hasOwn(unknown.file.frontmatter, 'liked'), false);
	const priorValue = new TFile('Existing.md', { video_id: 'existing', liked: true, custom: 'untouched' }); files.push(priorValue); index.record(priorValue, 'existing');
	await notes.getOrCreate(video('existing'));
	assert.deepEqual(priorValue.frontmatter, { video_id: 'existing', liked: true, custom: 'untouched' });
	const checkpoint = notes.getLikedStateCheckpoint();
	await notes.syncLikedVideos(['existing'], false, checkpoint);
	assert.equal(priorValue.frontmatter.liked, true);
	assert.equal(Object.hasOwn(unknown.file.frontmatter, 'liked'), false, 'partial sync must not mark absent IDs false');
	const requestsBeforeAutomation = requests;
	await notes.getOrCreate(video('existing'), undefined, { reuseConfirmedRating: true });
	assert.equal(requests, requestsBeforeAutomation, 'auto creation reuses confirmed fetch results');
	notes.resetLikedState();
	ratingResponse = async ids => new Map(ids.filter(id => id === 'existing').map(id => [id, false]));
	await notes.syncLikedVideos(['templated'], true, notes.getLikedStateCheckpoint());
	assert.equal(priorValue.frontmatter.liked, false);
	assert.equal(templated.file.frontmatter.liked, true);
	assert.equal(Object.hasOwn(unknown.file.frontmatter, 'liked'), false, 'missing rating remains unknown even after full scan');
	notes.resetLikedState();
	let releaseRating;
	ratingResponse = () => new Promise(resolve => { releaseRating = resolve; });
	const racing = notes.refreshLiked('existing');
	await Promise.resolve();
	await notes.captureLikedUpdate()('existing', false);
	releaseRating(new Map([['existing', true]])); await racing;
	assert.equal(priorValue.frontmatter.liked, false, 'late reads cannot overwrite unlike');
	const oldFetch = notes.getLikedStateCheckpoint();
	await notes.captureLikedUpdate()('existing', false);
	await notes.syncLikedVideos(['existing'], false, oldFetch);
	assert.equal(priorValue.frontmatter.liked, false, 'late full/partial fetch cannot overwrite unlike');
	notes.resetLikedState();
	const oldAccountRead = notes.refreshLiked('existing'); await Promise.resolve();
	const oldAccountMutation = notes.captureLikedUpdate();
	notes.resetLikedState();
	releaseRating(new Map([['existing', true]])); await oldAccountRead;
	await oldAccountMutation('existing', true);
	assert.equal(priorValue.frontmatter.liked, false, 'account switches discard prior reads and mutations');
	let savedVideos = [video('existing')];
	localStorageService.initializeLikedVideos({ getVideos: () => savedVideos, setVideos: next => { savedVideos = next; }, flush: async () => {} }, () => {});
	let youtubeCalls = 0;
	const mutationApi = { likeVideo: async () => { youtubeCalls++; }, unlikeVideo: async () => { youtubeCalls++; } };
	await likeVideoAndPersist(mutationApi, video('existing'), 0, notes.captureLikedUpdate());
	assert.equal(priorValue.frontmatter.liked, true);
	localStorageService.setLikedVideos([]);
	assert.equal(priorValue.frontmatter.liked, true, 'clearing saved videos never unlikes notes');
	await unlikeVideoAndPersist(mutationApi, 'existing', notes.captureLikedUpdate());
	assert.equal(priorValue.frontmatter.liked, false);
	await likeVideoAndPersist(mutationApi, video('existing'), 0, async () => { throw new Error('read-only file'); });
	assert.equal(youtubeCalls, 3, 'metadata failure must not retry the YouTube change');
	assert.ok(notices.some(text => text.includes('YouTube was updated')));
	await assert.rejects(unlikeVideoAndPersist({ unlikeVideo: async () => { throw new Error('denied'); } }, 'existing', notes.captureLikedUpdate()), /denied/);
	assert.equal(priorValue.frontmatter.liked, false, 'failed mutations leave metadata unchanged');
	notes.destroy();
	console.log('PASS: note creation, template booleans, existing/copy notes, failed/unknown reads, partial/full sync, automation reuse, unlike/Undo, cache clearing, account resets and stale response protection.');
	index.destroy();
	assert.equal(vaultListeners.size, 0); assert.equal(metadataListeners.size, 0);
	console.log('PASS: one startup scan; indexed lookups, legacy backfill, conflicts, rename, metadata changes, immediate write visibility, duplicate paths, missing-file cleanup, scoped notifications and unload.');
} finally {
	await rm(root, { recursive: true, force: true });
}
