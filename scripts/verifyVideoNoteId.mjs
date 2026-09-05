import assert from 'node:assert/strict';
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
		export { TFile } from 'obsidian';
		export { ensureVideoNoteId, findVideoNote, indexVideoNotesById } from ${JSON.stringify(path.resolve('src/utils/videoNoteUtils.ts'))};
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
				buildContext.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
					contents: `export class TFile { constructor(path, frontmatter = {}) { this.path = path; this.frontmatter = frontmatter; } }`,
				}));
			},
		}],
	});

	const { TFile, ensureVideoNoteId, findVideoNote, indexVideoNotesById } = await import(pathToFileURL(output).href);
	const legacy = new TFile('Youtube/Legacy title.md');
	const moved = new TFile('Archive/Renamed note.md', { video_id: 'moved-id' });
	const conflicting = new TFile('Youtube/Conflict.md', { video_id: 'other-id' });
	const files = [legacy, moved, conflicting];
	let writes = 0;
	const app = {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: candidate => files.find(file => file.path === candidate) ?? null,
		},
		metadataCache: {
			getFileCache: file => ({ frontmatter: file.frontmatter }),
		},
		fileManager: {
			processFrontMatter: async (file, update) => {
				writes++;
				update(file.frontmatter);
			},
		},
	};

	assert.equal(findVideoNote(app, 'legacy-id', ['Youtube/Missing.md', legacy.path]), legacy);
	await ensureVideoNoteId(app, legacy, 'legacy-id');
	assert.equal(legacy.frontmatter.video_id, 'legacy-id');
	assert.equal(findVideoNote(app, 'moved-id', ['Youtube/Old title.md']), moved);
	assert.equal(indexVideoNotesById(app).get('moved-id'), moved);
	await ensureVideoNoteId(app, moved, 'moved-id');
	assert.equal(writes, 1);
	assert.throws(() => findVideoNote(app, 'wanted-id', [conflicting.path]), /belongs to another video/);
	await assert.rejects(ensureVideoNoteId(app, conflicting, 'wanted-id'), /belongs to another video/);

	console.log('PASS: legacy notes are backfilled and renamed notes resolve by video_id without rewriting matching frontmatter');
} finally {
	await rm(root, { recursive: true, force: true });
}
