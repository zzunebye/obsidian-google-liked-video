import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
	url: "https://example.com",
});
const { document, window } = dom.window;
global.window = window;
global.document = document;
Object.defineProperty(global, "navigator", {
	configurable: true,
	value: dom.window.navigator,
});
global.HTMLElement = dom.window.HTMLElement;
global.DocumentFragment = dom.window.DocumentFragment;
global.Node = dom.window.Node;
global.IS_REACT_ACT_ENVIRONMENT = true;

const nowMs = Date.now();
const dayMs = 24 * 60 * 60 * 1000;
const video = (id, title, publishedAt, duration, channelTitle, viewCount) => ({
	kind: "youtube#video",
	etag: id,
	id,
	pulled_at: new Date(nowMs).toISOString(),
	snippet: {
		publishedAt: new Date(publishedAt).toISOString(),
		channelId: "channel",
		title,
		description: "",
		thumbnails: { medium: { url: "https://example.com/image.jpg" } },
		channelTitle,
		tags: [],
		categoryId: "22",
	},
	contentDetails: { duration },
	statistics: { viewCount, likeCount: 1, commentCount: "0" },
});

const state = {
	values: new Map(),
	videos: [
		video("recent-summary", "Recent summarized", nowMs - dayMs, "PT2M", "Zulu", 10),
		video("recent-missing", "Recent missing", nowMs - 2 * dayMs, "PT10M", "Alpha", 100),
		video("month-missing", "Month missing", nowMs - 20 * dayMs, "PT30M", "Echo", 2000),
		video("old-missing", "Old missing", nowMs - 400 * dayMs, "PT90M", "Beta", 100),
	],
	summaryIds: new Set(["recent-summary"]),
	summaryListeners: new Set(),
};

state.videos[0].snippet.defaultAudioLanguage = "en-US";
state.videos[0].snippet.defaultLanguage = "ko";
state.videos[1].snippet.defaultAudioLanguage = "en-GB";
state.videos[1].snippet.defaultLanguage = "en-US";
state.videos[2].snippet.defaultAudioLanguage = "ko";
state.videos[3].snippet.defaultLanguage = "en";

const storageSource = `
	const values = globalThis.__filterHarness.values;
	export const localStorageService = {
		getLikedVideoPaginationMode: () => "pagination",
		getSortOption: () => values.get("sort") ?? "addedDate",
		getSortOrder: () => values.get("order") ?? "DESC",
		getSelectedCategory: () => "all",
		getContentTypeSelection: () => [],
		getLikedVideoAISummaryFilter: () => values.get("summary") ?? "all",
		getLikedVideoPublishedDateFilter: () => values.get("published") ?? "all",
		getLikedVideoDurationFilter: () => values.get("duration") ?? "all",
		getLikedVideoAudioLanguageFilter: () => values.get("language") ?? "all",
		getLikedVideoLanguageFilter: () => values.get("textLanguage") ?? "all",
		getVideoNoteFilter: () => "all",
		getFiltersExpanded: () => true,
		setSortOption: value => values.set("sort", value),
		setSortOrder: value => values.set("order", value),
		setSelectedCategory: value => values.set("category", value),
		setContentTypeSelection: value => values.set("content", value),
		setLikedVideoAISummaryFilter: value => values.set("summary", value),
		setLikedVideoPublishedDateFilter: value => values.set("published", value),
		setLikedVideoDurationFilter: value => values.set("duration", value),
		setLikedVideoAudioLanguageFilter: value => values.set("language", value),
		setLikedVideoLanguageFilter: value => values.set("textLanguage", value),
		setVideoNoteFilter: value => values.set("note", value),
		setFiltersExpanded: value => values.set("expanded", value),
		getLikedVideos: () => globalThis.__filterHarness.videos,
	};
`;

const mocks = new Map([
	["src/storage", storageSource],
	["../store/pluginContext", `export const usePlugin = () => globalThis.__filterHarness.plugin;`],
	["src/store/videoContext", `
		import { createContext } from "react";
		export const VideosContext = createContext([globalThis.__filterHarness.videos]);
	`],
	["src/ui/VideoCard", `
		export const VideoCard = ({ videoInfo }) => <article data-video-title={videoInfo.snippet.title}>{videoInfo.snippet.title}</article>;
	`],
	["src/ui/SearchBar", `
		export const SearchBar = ({ searchTerm, onSearchTermChange }) => <input value={searchTerm} onChange={event => onSearchTermChange(event.target.value)} />;
	`],
	["src/ui/LikedVideoCollection", `
		export const LikedVideoCollection = ({ videos, renderVideo }) => <section data-testid="collection">
			{videos.map(video => <div key={video.id}>{renderVideo(video, false, {})}</div>)}
		</section>;
	`],
	["src/ui/ViewHeader", `
		export const ViewHeader = ({ title, badge, actions }) => <header><span>{title}</span><span data-testid="badge">{badge}</span>{actions}</header>;
	`],
	["src/ui/OpenYouTubeButton", `export const OpenYouTubeButton = () => null;`],
	["src/hooks/useNoteExistence", `export const useNoteExistenceMap = () => new Map();`],
	["src/utils/noteEditingUtils", `export const appendNoteContent = async () => {};`],
	["src/services/likedVideoMutationService", `
		export const likeVideoAndPersist = async () => {};
		export const unlikeVideoAndPersist = async () => {};
	`],
	["src/categoriesService", `
		export const categoriesService = {
			isReady: () => true,
			getAllCategories: () => [{ id: "22", title: "People & Blogs" }],
		};
	`],
	["src/constants/uiText", `
		export const UI_TEXT = {
			BTN_FETCH_ALL: "Fetch all",
			BTN_SETTINGS: "Settings",
			CONTENT_TYPE_MUSIC: "Music",
			CONTENT_TYPE_SHORTS: "Shorts",
			CONTENT_TYPE_VIDEOS: "Videos",
			FILTERS_HIDE: "Hide filters",
			FILTERS_SHOW: "Show filters",
			HEADER_TITLE: "Liked videos",
			NOTICE_LIKE_FAILED: "Like failed",
			NOTICE_UNLIKE_FAILED: "Unlike failed",
			NO_VIDEOS_FOUND: "No videos",
			SORT_BY_COMMENT_COUNT: "Comments",
			SORT_BY_DURATION: "Duration",
			SORT_BY_AVERAGE_VIEWS_PER_DAY: "Average Views/Day",
			SORT_BY_CHANNEL_NAME: "Channel Name",
			SORT_BY_LIKED_ORDER: "Liked order",
			SORT_BY_LIKE_COUNT: "Likes",
			SORT_BY_LIKE_VIEW_RATIO: "Like ratio",
			SORT_BY_PUBLISHED_DATE: "Published",
			SORT_BY_TITLE: "Title",
			SORT_BY_VIEW_COUNT: "Views",
			TOOLTIP_MUSIC: "Music",
			TOOLTIP_SHORTS: () => "Shorts",
			TOOLTIP_VIDEOS: () => "Videos",
			VIDEO_COUNT_WITH_TOTAL: (shown, total) => String(shown) + "/" + String(total),
		};
	`],
	["obsidian", `
		export class Notice {}
		export class Menu {
			setUseNativeMenu() { return this; }
			addItem() { return this; }
			addSeparator() { return this; }
			showAtPosition() {}
		}
	`],
]);

state.plugin = {
	settings: {
		shortVideoMaxDurationSeconds: 90,
		autoFetchEnabled: false,
		autoFetchInterval: 60,
		lastAutoFetchTime: 0,
		openInObsidianWebViewer: false,
		openWebViewerInSplitPane: false,
	},
	getFetchStatus: () => "idle",
	subscribeFetchStatus: () => () => {},
	performAutoFetch: async () => {},
	settingTabRef: null,
	summaryStorage: {
		hasVideoSummary: id => state.summaryIds.has(id),
		subscribe: listener => {
			state.summaryListeners.add(listener);
			return () => state.summaryListeners.delete(listener);
		},
	},
	videoNoteIndex: { subscribe: () => () => {}, has: () => false },
	app: { workspace: { openLinkText: async () => {}, getLeaf: () => ({ setViewState: async () => {} }) } },
	likedVideoApi: null,
};
global.__filterHarness = state;

const harnessSource = `
	import React, { act } from "react";
	import { createRoot } from "react-dom/client";
	import { LikedVideoView } from "./src/views/LikedVideoView";
	export { act };
	export async function renderView(element) {
		const root = createRoot(element);
		await act(async () => root.render(<LikedVideoView />));
		return root;
	}
`;

const tempDir = await mkdtemp(path.join(tmpdir(), "geulo-filter-ui-"));
try {
	const outfile = path.join(tempDir, "harness.mjs");
	await build({
		absWorkingDir: process.cwd(),
		entryPoints: ["filter-harness-entry"],
		bundle: true,
		format: "esm",
		jsx: "automatic",
		platform: "node",
		outfile,
		plugins: [{
			name: "filter-harness",
			setup(buildContext) {
				buildContext.onResolve({ filter: /^filter-harness-entry$/ }, () => ({ path: "entry", namespace: "harness" }));
				buildContext.onLoad({ filter: /.*/, namespace: "harness" }, () => ({ contents: harnessSource, loader: "jsx", resolveDir: process.cwd() }));
				buildContext.onResolve({ filter: /.*/ }, args => mocks.has(args.path)
					? { path: args.path, namespace: "mock" }
					: undefined);
				buildContext.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
					contents: mocks.get(args.path),
					loader: "jsx",
					resolveDir: process.cwd(),
				}));
			},
		}],
	});

	const harness = await import(pathToFileURL(outfile).href);
	const root = await harness.renderView(document.getElementById("root"));
	const titles = () => Array.from(document.querySelectorAll("[data-video-title]"), element => element.textContent);
	const change = async (label, value) => {
		const select = document.querySelector(`select[aria-label="${label}"]`);
		assert.ok(select, `${label} select is rendered`);
		await harness.act(async () => {
			select.value = value;
			select.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
	};

	assert.deepEqual(titles(), ["Recent summarized", "Recent missing", "Month missing", "Old missing"]);
	assert.equal(document.querySelector('select[aria-label="Filter by AI summary"] option[value="without"]').textContent, "No summary");
	assert.equal(document.querySelector('select[aria-label="Filter by upload date"] option[value="30d"]').textContent, "Past 30 days");
	assert.equal(document.querySelector('select[aria-label="Filter by duration"] option[value="5to20"]').textContent, "5–20 min");
	assert.equal(document.querySelector('select[aria-label="Filter by audio language"] option[value="en"]').textContent, "English (2)");
	assert.equal(document.querySelector('select[aria-label="Filter by audio language"] option[value="unknown"]').textContent, "Unknown (1)");
	assert.deepEqual(Array.from(document.querySelectorAll(".liked-video-filter-group"), group => group.getAttribute("aria-label")),
		["Category", "Content", "Language", "Saved state"]);
	assert.equal(document.querySelector('select[aria-label="Filter by category"] option[value="all"]').textContent, "All (4)");
	assert.equal(document.querySelector('select[aria-label="Filter by category"]').parentElement.querySelector(".liked-video-filter__select-value").textContent, "All");
	assert.match(document.querySelector(".liked-video-result-count").textContent, /4 of 4 videos/);


	await change("Filter by audio language", "en");
	assert.deepEqual(titles(), ["Recent summarized", "Recent missing"]);
	assert.equal(state.values.get("language"), "en");
	const audioSelect = document.querySelector('select[aria-label="Filter by audio language"]');
	assert.equal(audioSelect.parentElement.querySelector(".liked-video-filter__select-value").textContent, "English");
	assert.ok(audioSelect.closest(".liked-video-filter--active"));
	assert.match(document.querySelector(".liked-video-result-count").textContent, /2 of 4 videos/);

	await change("Filter by duration", "under5");
	assert.deepEqual(titles(), ["Recent summarized"]);
	assert.equal(document.querySelector(".filter-toggle-button__count").textContent, "2");
	await change("Filter by duration", "all");
	await change("Filter by audio language", "unknown");
	assert.deepEqual(titles(), ["Old missing"], "Title language does not replace missing audio language");
	await harness.act(async () => document.querySelector('button[title="Clear Audio language: Unknown"]').click());
	assert.equal(state.values.get("language"), "all");
	assert.deepEqual(titles(), ["Recent summarized", "Recent missing", "Month missing", "Old missing"]);

	await change("Filter by language", "en");
	assert.deepEqual(titles(), ["Recent missing", "Old missing"]);
	assert.equal(state.values.get("textLanguage"), "en");
	await change("Filter by audio language", "en");
	assert.deepEqual(titles(), ["Recent missing"], "Both language filters must match independently");
	await change("Filter by audio language", "all");
	await change("Filter by language", "unknown");
	assert.deepEqual(titles(), ["Month missing"], "Audio language does not replace missing title language");
	await harness.act(async () => document.querySelector('button[title="Clear Language: Unknown"]').click());
	assert.equal(state.values.get("textLanguage"), "all");

	await change("Filter by AI summary", "without");
	assert.deepEqual(titles(), ["Recent missing", "Month missing", "Old missing"]);
	assert.match(document.body.textContent, /AI summary: Missing/);

	await change("Filter by upload date", "30d");
	assert.deepEqual(titles(), ["Recent missing", "Month missing"]);
	await change("Filter by duration", "5to20");
	assert.deepEqual(titles(), ["Recent missing"]);
	assert.equal(document.querySelector(".filter-toggle-button__count").textContent, "3");

	await harness.act(async () => {
		state.summaryIds.add("recent-missing");
		state.summaryListeners.forEach(listener => listener());
	});
	assert.deepEqual(titles(), [], "A newly generated summary leaves the missing-summary result immediately");

	const clearAll = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Clear all");
	assert.ok(clearAll);
	await harness.act(async () => clearAll.click());
	assert.deepEqual(titles(), ["Recent summarized", "Recent missing", "Month missing", "Old missing"]);
	assert.equal(state.values.get("summary"), "all");
	assert.equal(state.values.get("published"), "all");
	assert.equal(state.values.get("duration"), "all");

	await harness.act(async () => root.unmount());

	state.values.set("sort", "averageViewsPerDay");
	state.values.set("order", "DESC");
	const averageRoot = await harness.renderView(document.getElementById("root"));
	assert.deepEqual(titles(), ["Month missing", "Recent missing", "Recent summarized", "Old missing"]);
	assert.match(document.querySelector(".sort-menu-button").title, /Average Views\/Day, highest first/);
	await harness.act(async () => averageRoot.unmount());

	state.values.set("sort", "channelTitle");
	state.values.set("order", "ASC");
	const channelRoot = await harness.renderView(document.getElementById("root"));
	assert.deepEqual(titles(), ["Recent missing", "Old missing", "Month missing", "Recent summarized"]);
	assert.match(document.querySelector(".sort-menu-button").title, /Channel Name, A to Z/);
	assert.equal(document.querySelector(".liked-video-result-sort").textContent, "Channel Name ↑");

	await harness.act(async () => channelRoot.unmount());

	console.log("LikedVideoView UI: filters, Average Views/Day sorting, and Channel Name sorting passed.");
} finally {
	await rm(tempDir, { recursive: true, force: true });
	dom.window.close();
}
process.exit(0);
