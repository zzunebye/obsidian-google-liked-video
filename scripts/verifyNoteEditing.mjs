import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-note-editing-'));
try {
	const entry = path.join(root, 'entry.ts');
	const output = path.join(root, 'entry.mjs');
	await writeFile(entry, `
		import { MarkdownView } from 'obsidian';
		export { MarkdownView } from 'obsidian';
		export { appendNoteContent } from ${JSON.stringify(path.resolve('src/utils/noteEditingUtils.ts'))};
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
					contents: `
						export class MarkdownView {
							constructor(file, editor, mode = 'source') {
								this.file = file;
								this.editor = editor;
								this.mode = mode;
							}
							getMode() { return this.mode; }
						}
					`,
				}));
			},
		}],
	});

	const { MarkdownView, appendNoteContent } = await import(pathToFileURL(output).href);

	const makeFile = (filePath, content) => ({ path: filePath, content });
	const makeEditor = initialValue => {
		let value = initialValue;
		const selection = { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 3 } };
		return {
			selection,
			getValue: () => value,
			lastLine: () => value.split('\n').length - 1,
			getLine: line => value.split('\n')[line],
			replaceRange: (text, from) => {
				const lines = value.split('\n');
				const offset = lines.slice(0, from.line).reduce((total, current) => total + current.length + 1, 0) + from.ch;
				value = value.slice(0, offset) + text + value.slice(offset);
			},
		};
	};
	const makeApp = ({ activeEditor = null, leaves = [], rejectProcess = false } = {}) => {
		let processCalls = 0;
		return {
			workspace: {
				activeEditor,
				iterateAllLeaves: callback => leaves.forEach(view => callback({ view })),
			},
			vault: {
				process: async (file, update) => {
					processCalls++;
					if (rejectProcess) throw new Error('disk full');
					file.content = update(file.content);
					return file.content;
				},
			},
			get processCalls() { return processCalls; },
		};
	};

	const activeFile = makeFile('Active.md', 'alpha\nbeta');
	const activeEditor = makeEditor(activeFile.content);
	const activeView = new MarkdownView(activeFile, activeEditor, 'source');
	const activeApp = makeApp({ activeEditor: activeView, leaves: [activeView] });
	const selectionBefore = structuredClone(activeEditor.selection);
	assert.equal(await appendNoteContent(activeApp, activeFile, { text: '\nadded' }), true);
	assert.equal(activeEditor.getValue(), 'alpha\nbeta\nadded');
	assert.deepEqual(activeEditor.selection, selectionBefore);
	assert.equal(activeApp.processCalls, 0);

	const unrelatedFile = makeFile('Other.md', 'other');
	const unrelatedView = new MarkdownView(unrelatedFile, makeEditor('other'), 'source');
	const splitFile = makeFile('Split.md', 'split');
	const splitEditor = makeEditor('split');
	const splitView = new MarkdownView(splitFile, splitEditor, 'source');
	const splitApp = makeApp({ activeEditor: unrelatedView, leaves: [unrelatedView, splitView] });
	assert.equal(await appendNoteContent(splitApp, splitFile, { text: '\nfrom split' }), true);
	assert.equal(splitEditor.getValue(), 'split\nfrom split');
	assert.equal(splitApp.processCalls, 0);

	const previewFile = makeFile('Preview.md', 'preview');
	const previewView = new MarkdownView(previewFile, makeEditor('stale preview'), 'preview');
	const previewApp = makeApp({ activeEditor: previewView, leaves: [previewView] });
	assert.equal(await appendNoteContent(previewApp, previewFile, { text: '\nbackground' }), true);
	assert.equal(previewFile.content, 'preview\nbackground');
	assert.equal(previewApp.processCalls, 1);

	const closedFile = makeFile('Closed.md', 'closed');
	const closedApp = makeApp({ activeEditor: unrelatedView, leaves: [unrelatedView] });
	assert.equal(await appendNoteContent(closedApp, closedFile, { text: '\natomic' }), true);
	assert.equal(closedFile.content, 'closed\natomic');
	assert.equal(closedApp.processCalls, 1);

	const duplicateFile = makeFile('Duplicate.md', '## AI Summary\nexisting');
	const duplicateEditor = makeEditor(duplicateFile.content);
	const duplicateView = new MarkdownView(duplicateFile, duplicateEditor, 'source');
	const duplicateApp = makeApp({ activeEditor: duplicateView, leaves: [duplicateView] });
	assert.equal(await appendNoteContent(duplicateApp, duplicateFile, { text: '\nnew', skipIfContains: '## AI Summary' }), false);
	assert.equal(duplicateEditor.getValue(), '## AI Summary\nexisting');
	assert.equal(duplicateApp.processCalls, 0);

	const rapidFile = makeFile('Rapid.md', 'body');
	const rapidEditor = makeEditor(rapidFile.content);
	const rapidView = new MarkdownView(rapidFile, rapidEditor, 'source');
	const rapidApp = makeApp({ activeEditor: rapidView, leaves: [rapidView] });
	const rapidResults = await Promise.all([
		appendNoteContent(rapidApp, rapidFile, { text: '\n## AI Summary\nfirst', skipIfContains: '## AI Summary' }),
		appendNoteContent(rapidApp, rapidFile, { text: '\n## AI Summary\nsecond', skipIfContains: '## AI Summary' }),
	]);
	assert.deepEqual(rapidResults, [true, false]);
	assert.equal(rapidEditor.getValue(), 'body\n## AI Summary\nfirst');

	const failingFile = makeFile('Fail.md', 'safe');
	const failingApp = makeApp({ rejectProcess: true });
	await assert.rejects(
		appendNoteContent(failingApp, failingFile, { text: '\nlost' }),
		/disk full/,
	);
	assert.equal(failingFile.content, 'safe');

	console.log('PASS: note appends use the matching editor or atomic Vault.process, preserve editor selection, prevent duplicates, and propagate failures');
} finally {
	await rm(root, { recursive: true, force: true });
}
