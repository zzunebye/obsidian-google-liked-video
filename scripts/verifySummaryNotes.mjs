import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { load as parseYaml } from 'js-yaml';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-summary-notes-'));
const dom = new JSDOM('<!doctype html><body></body>');
global.window = dom.window;
global.document = dom.window.document;
const element = dom.window.HTMLElement.prototype;
element.empty = function () { this.replaceChildren(); };
element.createEl = function (tag, options = {}) {
	const child = dom.window.document.createElement(tag);
	child.textContent = options.text ?? '';
	child.className = options.cls ?? '';
	this.append(child);
	return child;
};
element.createDiv = function (options) { return this.createEl('div', options); };

try {
	const output = path.join(root, 'entry.mjs');
	await build({
		stdin: { contents: `
			export * from './src/services/summaryNoteService';
			export * from './src/utils/summaryNoteUtils';
			export * from './src/utils/videoNoteUtils';
			export { TFile, MarkdownView, Modal, notices } from 'obsidian';
		`, resolveDir: process.cwd(), loader: 'ts' },
		bundle: true, format: 'esm', platform: 'node', outfile: output,
		plugins: [{ name: 'obsidian-fixture', setup(builder) {
			builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'fixture' }));
			builder.onResolve({ filter: /^obsidian-daily-notes-interface$/ }, () => ({ path: 'daily', namespace: 'fixture' }));
			builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: name === 'daily'
				? 'export const getAllDailyNotes = () => []; export const getDailyNote = () => null; export const createDailyNote = async () => null;'
				: `
					export const notices = [];
					export class Notice { constructor(text) { notices.push(text); } }
					export class TFile { constructor(path, content = '') { this.path = path; this.content = content; this.frontmatter = {}; } }
					export class MarkdownView { constructor(file, editor) { this.file = file; this.editor = editor; } getMode() { return 'source'; } }
					export class Modal {
						static active = null;
						constructor(app) { this.app = app; this.contentEl = document.createElement('div'); }
						setTitle(title) { this.contentEl.setAttribute('aria-label', title); }
						open() { Modal.active = this; document.body.append(this.contentEl); this.onOpen(); }
						close() { this.onClose(); this.contentEl.remove(); Modal.active = null; }
					}
					export const normalizePath = value => value.replace(/[\\\\/]+/g, '/').replace(/^\\/+|\\/+$/g, '');
					export const moment = () => ({ format: () => '2026-09-16' });
				` }));
		} }],
	});
	const { saveSummaryToNote, createSummaryNoteBlock, getSummaryNoteRegion, getSummaryNoteEdit, findVideoNote, TFile, MarkdownView, Modal, notices } = await import(pathToFileURL(output).href);
	const video = { id: 'qa-video-01', snippet: { title: 'Summary "QA"', channelTitle: 'Fixture Channel' } };
	const block = createSummaryNoteBlock('Original summary\n\n## Nested heading\nDetails');
	const replacement = createSummaryNoteBlock('Regenerated summary');
	const quotedBlock = createSummaryNoteBlock('Quoted summary\n\n## Nested heading\n- Detail', true);
	assert.match(block, /^<!-- geulo:ai-summary:start -->\n# AI Summary\n/);
	assert.equal(quotedBlock, '<!-- geulo:ai-summary:start -->\n# AI Summary\n> Quoted summary\n>\n> ## Nested heading\n> - Detail\n<!-- geulo:ai-summary:end -->');
	assert.equal(getSummaryNoteRegion(quotedBlock).kind, 'marked');
	assert.equal(getSummaryNoteRegion('Personal notes').kind, 'empty');
	assert.equal(getSummaryNoteRegion('<!-- geulo:ai-summary:start -->\n## AI Summary\nEarlier managed summary\n<!-- geulo:ai-summary:end -->').kind, 'marked');
	assert.equal(getSummaryNoteRegion('## AI Summary\nLegacy\n## Personal notes\nKeep').kind, 'legacy');
	for (const invalid of [block + '\n' + block, block.replace('geulo:ai-summary:end', 'missing:end'), block.replace('geulo:ai-summary:start', 'missing:start')]) {
		assert.equal(getSummaryNoteRegion(invalid).kind, 'legacy');
		assert.equal(getSummaryNoteEdit(invalid, replacement, getSummaryNoteRegion(invalid)), null);
	}
	assert.throws(() => createSummaryNoteBlock(''), /cannot be saved/);
	assert.throws(() => createSummaryNoteBlock('<!-- geulo:ai-summary:end -->'), /cannot be saved/);
	assert.equal(getSummaryNoteRegion(block.replace(/\n/g, '\r\n')).kind, 'marked');

	const fixture = (content = 'My notes\nKeep this text.') => {
		const file = new TFile('Videos/Canonical.md', content);
		file.frontmatter.video_id = video.id;
		const files = new Map([[file.path, file]]);
		const state = { processes: 0, lookups: 0, opened: [], failWrite: false, failMetadata: false, beforeProcess: null };
		const app = {
			workspace: { activeEditor: null, iterateAllLeaves: callback => { if (app.workspace.activeEditor) callback({ view: app.workspace.activeEditor }); },
				openLinkText: async path => state.opened.push(path), getLeaf: () => ({ openFile: async file => state.opened.push(file.path) }) },
			vault: {
				read: async file => file.content,
				process: async (file, transform) => {
					state.processes++;
					if (state.failWrite) throw new Error('disk full');
					state.beforeProcess?.(file);
					file.content = transform(file.content);
				},
				getAbstractFileByPath: path => files.get(path) ?? null,
				getFolderByPath: path => path === 'Videos/Fixture Channel' ? {} : null,
				createFolder: async () => {},
				create: async (path, content) => {
					if (state.failWrite) throw new Error('disk full');
					assert.equal(files.has(path), false, 'never overwrite a copy');
					const copy = new TFile(path, content);
					copy.frontmatter = parseYaml(content.split('---')[1]);
					files.set(path, copy);
					return copy;
				},
			},
			metadataCache: { getFileCache: file => ({ frontmatter: file.frontmatter }) },
			fileManager: { getNewFileParent: () => ({ path: '' }), processFrontMatter: async (file, transform) => {
				if (state.failMetadata) throw new Error('metadata failure');
				transform(file.frontmatter);
			} },
		};
		const plugin = { app, settings: { videoNotePath: 'Videos', organizeByChannel: true, saveAISummariesAsBlockquotes: false },
			videoNotes: { getOrCreate: async () => { state.lookups++; return { file, created: false }; } } };
		return { plugin, app, file, files, state };
	};
	const choose = async label => {
		for (let attempt = 0; !Modal.active && attempt < 20; attempt++) await new Promise(resolve => setImmediate(resolve));
		assert.ok(Modal.active, 'save-choice modal is visible');
		const button = [...Modal.active.contentEl.querySelectorAll('button')].find(button => button.textContent === label);
		assert.ok(button, `${label} action exists`);
		button.click();
	};

	const first = fixture();
	await saveSummaryToNote(first.plugin, video, 'First version');
	assert.equal(first.file.content, 'My notes\nKeep this text.\n\n' + createSummaryNoteBlock('First version') + '\n');
	assert.equal(first.file.frontmatter.ai_summary, true);
	assert.equal(first.file.frontmatter.video_id, video.id);
	assert.deepEqual(first.state.opened, [first.file.path]);

	const quoted = fixture();
	quoted.plugin.settings.saveAISummariesAsBlockquotes = true;
	await saveSummaryToNote(quoted.plugin, video, 'Quoted version\n\n## Details\n- Item');
	assert.equal(quoted.file.content, 'My notes\nKeep this text.\n\n' + createSummaryNoteBlock('Quoted version\n\n## Details\n- Item', true) + '\n');

	const closed = fixture('Before\n' + block + '\nAfter');
	closed.state.beforeProcess = file => { file.content = 'Concurrent outside edit\n' + file.content; };
	let saving = saveSummaryToNote(closed.plugin, video, 'Regenerated summary');
	await choose('Replace existing summary');
	await saving;
	assert.equal(closed.file.content, 'Concurrent outside edit\nBefore\n' + replacement + '\nAfter');
	assert.equal(closed.state.processes, 1);

	const edited = fixture('Disk version');
	let editorText = 'Unsaved introduction\n' + block + '\nUnsaved ending';
	const toOffset = position => editorText.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
	const editor = {
		getValue: () => editorText,
		offsetToPos: offset => { const lines = editorText.slice(0, offset).split('\n'); return { line: lines.length - 1, ch: lines.at(-1).length }; },
		replaceRange: (text, from, to) => { editorText = editorText.slice(0, toOffset(from)) + text + editorText.slice(toOffset(to)); },
	};
	edited.app.workspace.activeEditor = new MarkdownView(edited.file, editor);
	saving = saveSummaryToNote(edited.plugin, video, 'Regenerated summary');
	await choose('Replace existing summary');
	await saving;
	assert.equal(editorText, 'Unsaved introduction\n' + replacement + '\nUnsaved ending');
	assert.equal(edited.file.content, 'Disk version');
	assert.equal(edited.state.processes, 0);

	const conflict = fixture(block);
	conflict.state.beforeProcess = file => { file.content = file.content.replace('Original summary', 'Manual edit'); };
	saving = saveSummaryToNote(conflict.plugin, video, 'Regenerated summary');
	await choose('Replace existing summary');
	await saving;
	assert.ok(conflict.file.content.includes('Manual edit'));
	assert.ok(!conflict.file.content.includes('Regenerated summary'));
	assert.ok(notices.at(-1).includes('Nothing was replaced'));

	for (const dismiss of ['Cancel', 'close']) {
		const cancelled = fixture(block);
		saving = saveSummaryToNote(cancelled.plugin, video, 'Cancelled text');
		if (dismiss === 'Cancel') await choose('Cancel');
		else {
			while (!Modal.active) await new Promise(resolve => setImmediate(resolve));
			Modal.active.close();
		}
		await saving;
		assert.equal(cancelled.file.content, block);
		assert.equal(cancelled.state.processes, 0);
	}

	const legacy = fixture('## AI Summary\nLegacy text\n## My thoughts\nKeep');
	const legacyBefore = legacy.file.content;
	saving = saveSummaryToNote(legacy.plugin, video, 'Separate summary');
	while (!Modal.active) await new Promise(resolve => setImmediate(resolve));
	assert.ok(!Modal.active.contentEl.textContent.includes('Replace existing summary'));
	await choose('Save as new note');
	await saving;
	assert.equal(legacy.file.content, legacyBefore);
	const copy = [...legacy.files.values()].find(file => file !== legacy.file);
	assert.ok(copy.path.startsWith('Videos/Fixture Channel/'));
	assert.equal(copy.frontmatter.source_video_id, video.id);
	assert.equal(copy.frontmatter.video_id, undefined);
	assert.equal(copy.frontmatter.title, video.snippet.title);
	assert.equal(findVideoNote(legacy.app, { get: () => null }, 'unrelated-video', [copy.path]), null);
	saving = saveSummaryToNote(legacy.plugin, video, 'Another copy');
	await choose('Save as new note');
	await saving;
	assert.equal(legacy.files.size, 3);
	assert.ok([...legacy.files.keys()].some(path => path.endsWith('AI Summary 2.md')));

	const rapid = fixture(block);
	const attempts = [saveSummaryToNote(rapid.plugin, video, 'Rapid'), saveSummaryToNote(rapid.plugin, video, 'Rapid')];
	await choose('Replace existing summary');
	await Promise.all(attempts);
	assert.equal(rapid.state.lookups, 1);
	assert.equal(rapid.state.processes, 1);

	const failure = fixture();
	failure.state.failWrite = true;
	await assert.rejects(saveSummaryToNote(failure.plugin, video, 'Retry'), /disk full/);
	assert.equal(failure.file.content, 'My notes\nKeep this text.');
	failure.state.failWrite = false;
	await saveSummaryToNote(failure.plugin, video, 'Retry');
	assert.ok(failure.file.content.includes('Retry'));
	const metadata = fixture();
	metadata.state.failMetadata = true;
	await saveSummaryToNote(metadata.plugin, video, 'Kept despite metadata failure');
	assert.ok(metadata.file.content.includes('Kept despite metadata failure'));
	assert.ok(notices.at(-1).includes('metadata could not be updated'));
	console.log('PASS: summary append, atomic/editor replacement, outside-edit preservation, conflict rejection, legacy/malformed protection, modal cancel/close, unique source-only copies, deduplication, failure recovery and partial metadata failure');
} finally {
	dom.window.close();
	delete global.window;
	delete global.document;
	await rm(root, { recursive: true, force: true });
}
