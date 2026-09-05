import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(path.join(tmpdir(), 'geulo-note-paths-'));
try {
	const entry = path.join(root, 'entry.ts');
	const output = path.join(root, 'entry.mjs');
	await writeFile(entry, `
		export { computeExpectedNotePath, getExpectedNotePath } from ${JSON.stringify(path.resolve('src/utils/noteUtils.ts'))};
	`);
	await build({
		entryPoints: [entry],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: output,
		plugins: [{
			name: 'note-path-mocks',
			setup(buildContext) {
				buildContext.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
				buildContext.onResolve({ filter: /^obsidian-daily-notes-interface$/ }, () => ({ path: 'daily-notes', namespace: 'mock' }));
				buildContext.onResolve({ filter: /src\/ui\/VideoInfoModal$/ }, () => ({ path: 'video-info', namespace: 'mock' }));
				buildContext.onResolve({ filter: /src\/services\/templateService$/ }, () => ({ path: 'template-service', namespace: 'mock' }));
				buildContext.onLoad({ filter: /.*/, namespace: 'mock' }, args => {
					if (args.path === 'obsidian') {
						return { contents: `
							export class TFile { constructor(path) { this.path = path; } }
							export class TFolder { constructor(path) { this.path = path; } }
							export class MarkdownView {}
							export class Notice {}
							export const normalizePath = value => value
								.replace(/\\u00a0/g, ' ')
								.normalize('NFC')
								.replace(/[\\\\/]+/g, '/')
								.replace(/^\\/+|\\/+$/g, '');
							export const moment = () => ({ startOf: () => ({}), format: () => '' });
						` };
					}
					if (args.path === 'daily-notes') {
						return { contents: `export const getAllDailyNotes = () => []; export const getDailyNote = () => null; export const createDailyNote = async () => null;` };
					}
					if (args.path === 'video-info') return { contents: `export const parseDurationToSeconds = () => 0;` };
					return { contents: `export class TemplateService {}` };
				});
			},
		}],
	});

	const { computeExpectedNotePath, getExpectedNotePath } = await import(pathToFileURL(output).href);
	const folders = new Map([['Inbox', { path: 'Inbox' }]]);
	const files = new Map();
	const createdFolders = [];
	const app = {
		fileManager: { getNewFileParent: () => ({ path: 'Inbox' }) },
		vault: {
			getFolderByPath: candidate => folders.get(candidate) ?? null,
			getAbstractFileByPath: candidate => folders.get(candidate) ?? files.get(candidate) ?? null,
			createFolder: async candidate => {
				if (files.has(candidate)) throw new Error('path is a file');
				createdFolders.push(candidate);
				folders.set(candidate, { path: candidate });
			},
		},
	};

	assert.equal(computeExpectedNotePath(app, 'Demo', ''), 'Inbox/Demo.md');
	assert.equal(computeExpectedNotePath(app, 'Demo', '/'), 'Demo.md');
	assert.equal(computeExpectedNotePath(app, 'Demo', '\\'), 'Demo.md');
	assert.equal(computeExpectedNotePath(app, 'Demo', '//Youtube\\Videos/'), 'Youtube/Videos/Demo.md');
	assert.equal(
		computeExpectedNotePath(app, 'Cafe\u0301', 'My\u00a0Notes', true, 'Cre\u0301ator'),
		'My Notes/Créator/Café.md',
	);

	assert.equal(await getExpectedNotePath(app, 'Demo', '//Youtube\\Videos/'), 'Youtube/Videos/Demo.md');
	assert.deepEqual(createdFolders, ['Youtube/Videos']);

	files.set('Blocked', { path: 'Blocked' });
	assert.equal(await getExpectedNotePath(app, 'Demo', 'Blocked'), 'Inbox/Demo.md');

	let concurrentFolderExists = false;
	const concurrentApp = {
		fileManager: { getNewFileParent: () => ({ path: 'Inbox' }) },
		vault: {
			getFolderByPath: candidate => concurrentFolderExists && candidate === 'Concurrent' ? { path: candidate } : folders.get(candidate) ?? null,
			getAbstractFileByPath: () => null,
			createFolder: async candidate => {
				if (candidate === 'Concurrent') {
					concurrentFolderExists = true;
					throw new Error('already exists');
				}
			},
		},
	};
	assert.equal(await getExpectedNotePath(concurrentApp, 'Demo', 'Concurrent'), 'Concurrent/Demo.md');

	console.log('PASS: note paths normalize user input and constructed segments, preserve root semantics, and use Vault folder lookups with collision recovery');
} finally {
	await rm(root, { recursive: true, force: true });
}
