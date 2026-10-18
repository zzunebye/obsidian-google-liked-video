import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>', { url: "https://example.com" });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
let width = 500;
let resize;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => width });
dom.window.HTMLElement.prototype.scrollTo = () => {};
dom.window.ResizeObserver = class {
	constructor(callback) { resize = callback; }
	observe() {}
	disconnect() {}
};
let summaries = [{ videoId: "one", title: "First summary", channelTitle: "Channel", summary: "Text", generatedAt: "2026-10-18" }];
let notify;
global.__summaryFocusPlugin = {
	settings: {},
	summaryStorage: {
		getAllVideoSummaries: () => summaries,
		subscribe: listener => { notify = listener; return () => {}; },
	},
};
const mocks = new Map([
	["obsidian", "export class Notice {}"],
	["../store/pluginContext", "export const usePlugin = () => globalThis.__summaryFocusPlugin;"],
	["src/debug", "export const debugLogger = {};"],
	["src/services/summaryNoteService", "export const saveSummaryToNote = () => {};"],
	["src/ui/SearchBar", "export const SearchBar = () => null;"],
	["src/ui/SummarySection", "export const SummarySection = () => <button>Copy summary</button>;"],
	["src/ui/SummarySpeechButton", "export const SummarySpeechButton = () => null;"],
	["src/ui/VideoCommentsModal", "export class VideoCommentsModal {}"],
	["src/ui/ViewHeader", "export const ViewHeader = () => null;"],
]);
const result = await build({
	stdin: { contents: 'export { AISummariesView } from "./src/views/AISummariesView";', resolveDir: process.cwd() },
	bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react-dom"],
	plugins: [{ name: "summary-focus-fixtures", setup(builder) {
		builder.onResolve({ filter: /.*/ }, args => mocks.has(args.path) ? { path: args.path, namespace: "fixture" } : undefined);
		builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks.get(args.path), loader: "tsx" }));
	} }],
});
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const compiled = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiled, compiled.exports);
const React = require("react");
const { createRoot } = require("react-dom/client");
const root = createRoot(document.getElementById("root"));
const { act } = React;
try {
	// Given a narrow pane with a saved summary.
	await act(async () => root.render(React.createElement(compiled.exports.AISummariesView)));
	const list = document.querySelector(".ai-summaries-list");
	const detail = document.querySelector(".ai-summaries-detail");
	const trigger = document.querySelector(".ai-summary-list-item");
	// When opening the summary, then focus leaves the hidden list.
	trigger.focus();
	await act(async () => trigger.click());
	assert.equal(document.activeElement, detail);
	assert.equal(list.hasAttribute("inert"), true);
	assert.equal(list.getAttribute("aria-hidden"), "true");
	// Given an open detail, when returning, then the original item regains focus.
	await act(async () => document.querySelector(".ai-summary-reader__back").click());
	assert.equal(document.activeElement, trigger);
	assert.equal(list.hasAttribute("inert"), false);
	assert.equal(list.hasAttribute("aria-hidden"), false);
	// Given a wide pane, when opening, then both regions remain accessible.
	await act(async () => { width = 900; resize(); });
	await act(async () => trigger.click());
	assert.equal(list.hasAttribute("inert"), false);
	// Given focus in the wide list, when narrowed, then focus moves into detail.
	trigger.focus();
	await act(async () => { width = 500; resize(); });
	assert.equal(document.activeElement, detail);
	assert.equal(list.hasAttribute("inert"), true);
	// Given a selected item, when storage removes it, then focus has a visible fallback.
	await act(async () => { summaries = []; notify(); });
	assert.equal(document.activeElement, list);
	assert.equal(list.hasAttribute("inert"), false);
	console.log("AI summary focus: open, return, wide/narrow resize, removed-item fallback passed");
} finally {
	await act(async () => root.unmount());
	dom.window.close();
	delete global.__summaryFocusPlugin;
}
