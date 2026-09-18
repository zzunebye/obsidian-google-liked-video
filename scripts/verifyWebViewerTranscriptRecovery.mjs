/* global globalThis */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

globalThis.window = {
	setTimeout: (fn, ms) => setTimeout(fn, ms === 25000 ? 200 : ms),
	clearTimeout,
	setInterval: fn => setInterval(fn, 5),
	clearInterval,
};
globalThis.recoveryNotices = 0;
globalThis.recoveryHttpStatus = 403;
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'geulo-transcript-recovery-'));
const outputPath = path.join(outputDirectory, 'recovery.cjs');
await build({
	stdin: { contents: `
		export { WebViewerTranscriptRecovery } from './src/services/webViewerTranscriptRecovery';
		export { transcriptService } from './src/services/transcriptService';
	`, resolveDir: process.cwd() },
	bundle: true, format: 'cjs', platform: 'node', outfile: outputPath,
	plugins: [{ name: 'recovery-fixtures', setup(builder) {
		builder.onResolve({ filter: /^(obsidian|src\/debug)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
		builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({
			contents: name === 'obsidian' ? `
				export class Component {
					cleanups = [];
					register(fn) { this.cleanups.push(fn); }
					load() { this.onload(); }
					unload() { this.onunload(); this.cleanups.forEach(fn => fn()); }
				}
				export class Notice {
					constructor() { globalThis.recoveryNotices++; }
					hide() { globalThis.recoveryNotices--; }
				}
				export const Platform = { isMobile: false };
				export const requestUrl = async () => ({status: globalThis.recoveryHttpStatus, text: ''});
			` : 'export const debugLogger = { info() {}, warn() {} };', loader: 'js',
		}));
	} }],
});
const { WebViewerTranscriptRecovery, transcriptService } = createRequire(import.meta.url)(outputPath);
let nextId = 0;
const id = () => 'recovery' + String(++nextId).padStart(3, '0');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

function fixture({ existing = false, ready = true, disabled = false, hold = false } = {}) {
	const videoId = id();
	const dom = new JSDOM('<div id="movie_player"></div><ytd-video-description-transcript-section-renderer><button>Show transcript</button></ytd-video-description-transcript-section-renderer>', {
		url: `https://www.youtube.com/watch?v=${videoId}`, runScripts: 'outside-only',
	});
	const doc = dom.window.document;
	let clicks = 0;
	let executions = 0;
	let navigations = 0;
	let created = 0;
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	doc.getElementById('movie_player').getPlayerResponse = () => ({
		videoDetails: { videoId }, captions: { playerCaptionsTracklistRenderer: {
			captionTracks: [{ languageCode: 'en', name: { simpleText: 'English' } }],
		} },
	});
	doc.querySelector('button').onclick = () => {
		clicks++;
		const panel = doc.createElement('ytd-transcript-search-panel-renderer');
		panel.data = {
			body: { transcriptSegmentListRenderer: { initialSegments: [{ transcriptSegmentRenderer: {
				startMs: '40', endMs: '1760', targetId: `${videoId}.track.40`, snippet: { simpleText: 'Recovered captions' },
			} }] } },
			footer: { transcriptFooterRenderer: { languageMenu: { sortFilterSubMenuRenderer: {
				subMenuItems: [{ title: 'English', selected: true }],
			} } } },
		};
		doc.body.appendChild(panel);
	};
	const viewer = {
		getURL: () => ready ? dom.window.location.href : 'about:blank',
		executeJavaScript: async code => { executions++; return dom.window.eval(code); },
	};
	const leaf = {
		view: {
			containerEl: { querySelector: () => viewer },
			getViewType: () => disabled ? 'empty' : 'webviewer',
			getState: () => ({ url: dom.window.location.href }),
		},
		async setViewState(state) {
			navigations++;
			assert.equal(state.type, 'webviewer');
			assert.equal(state.active, false, 'Do not focus the recovery pane');
			assert.equal(state.state.url, dom.window.location.href);
			if (hold) await gate;
		},
		async loadIfDeferred() {},
	};
	const unrelated = { view: { containerEl: { querySelector: () => null }, getState: () => ({ url: 'https://www.youtube.com/watch?v=otherVideo1' }) } };
	const leaves = [unrelated, ...(existing ? [leaf] : [])];
	const workspace = {
		getLeavesOfType: () => leaves,
		getLeaf: type => { assert.equal(type, 'split'); created++; leaves.push(leaf); return leaf; },
	};
	const recovery = new WebViewerTranscriptRecovery({ workspace });
	recovery.load();
	return {
		videoId, leaf, leaves, release,
		counts: () => ({ clicks, executions, navigations, created }),
		setReady: () => { ready = true; },
		close: () => { recovery.unload(); dom.window.close(); assert.equal(globalThis.recoveryNotices, 0); },
		unload: () => recovery.unload(),
	};
}

const fresh = fixture({ hold: true });
const canceled = new AbortController();
const firstPhases = [];
const secondPhases = [];
const first = transcriptService.getTranscript(fresh.videoId, canceled.signal, 'en', phase => firstPhases.push(phase));
const second = transcriptService.getTranscript(fresh.videoId, undefined, 'en', phase => secondPhases.push(phase));
await tick();
canceled.abort();
await assert.rejects(first, error => error.name === 'AbortError');
fresh.release();
assert.equal((await second).segments[0].text, 'Recovered captions');
assert.deepEqual(firstPhases, ['fetching-transcript', 'opening-youtube']);
assert.deepEqual(secondPhases, ['fetching-transcript', 'opening-youtube', 'reading-captions']);
assert.deepEqual(fresh.counts(), { clicks: 1, executions: 2, navigations: 1, created: 1 });
await transcriptService.getTranscript(fresh.videoId);
assert.equal(fresh.counts().created, 1, 'The cache must not reopen a viewer');
fresh.close();

const reused = fixture({ existing: true });
assert.equal((await transcriptService.getTranscript(reused.videoId)).segments.length, 1);
assert.equal(reused.counts().created, 0);
assert.equal(reused.counts().navigations, 0, 'Never reload or overwrite an existing viewer');
reused.close();

const delayed = fixture({ ready: false });
const delayedResult = transcriptService.getTranscript(delayed.videoId);
await tick();
assert.equal(delayed.counts().executions, 0, 'Wait for the guest to finish initial navigation');
delayed.setReady();
await delayedResult;
delayed.close();

const cancelAll = fixture({ hold: true });
const abort = new AbortController();
const canceledResult = transcriptService.getTranscript(cancelAll.videoId, abort.signal);
await tick();
abort.abort();
await assert.rejects(canceledResult, error => error.name === 'AbortError');
cancelAll.release();
await tick();
assert.equal(cancelAll.counts().executions, 0, 'Canceled setup must not later click Show transcript');
cancelAll.close();

const timedOut = fixture({ ready: false });
await assert.rejects(transcriptService.getTranscript(timedOut.videoId), error => error.code === 'blocked' && /Web Viewer/.test(error.message));
timedOut.setReady();
await tick();
assert.equal(timedOut.counts().executions, 0, 'Timed out jobs must stop watching the guest');
timedOut.close();

const disabled = fixture({ disabled: true });
await assert.rejects(transcriptService.getTranscript(disabled.videoId), error => error.code === 'blocked');
assert.equal(disabled.counts().executions, 0);
disabled.close();

const closed = fixture({ ready: false });
const closedResult = transcriptService.getTranscript(closed.videoId);
await tick();
closed.leaves.splice(closed.leaves.indexOf(closed.leaf), 1);
await assert.rejects(closedResult, error => error.code === 'blocked');
closed.close();

const unloading = fixture({ ready: false });
const unloadedResult = transcriptService.getTranscript(unloading.videoId);
await tick();
unloading.unload();
await assert.rejects(unloadedResult, error => error.name === 'AbortError');
await assert.rejects(transcriptService.getTranscript(id()), error => error.code === 'blocked');
unloading.close();

const network = fixture();
globalThis.recoveryHttpStatus = 500;
await assert.rejects(transcriptService.getTranscript(network.videoId), error => error.code === 'network');
assert.equal(network.counts().created, 0);
network.close();
console.log('Web Viewer recovery: blocked HTTP -> new split -> live page script -> shared cache, reuse, concurrent cancellation, delayed load, timeout, close, unavailable viewer, unload and network-error isolation passed.');
