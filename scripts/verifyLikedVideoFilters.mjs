import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";

async function importBundle(entryPoint) {
	const bundle = await build({
		entryPoints: [entryPoint],
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const source = Buffer.from(bundle.outputFiles[0].text).toString("base64");
	return import(`data:text/javascript;base64,${source}`);
}

const values = new Map();
global.window = {
	localStorage: {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
	},
};

const { localStorageService } = await importBundle("src/storage.ts");

values.clear();
values.set("likedVideoViewAINoteFilter", "true");
assert.equal(localStorageService.getLikedVideoAISummaryFilter(), "with");
values.set("likedVideoViewAISummaryFilter", "invalid");
assert.equal(localStorageService.getLikedVideoAISummaryFilter(), "all");
localStorageService.setLikedVideoAISummaryFilter("without");
assert.equal(localStorageService.getLikedVideoAISummaryFilter(), "without");
assert.equal(localStorageService.getAINoteFilter(), true, "Playlist AI filter keeps its legacy boolean state");

values.clear();
for (const [setter, getter, value] of [
	["setLikedVideoPublishedDateFilter", "getLikedVideoPublishedDateFilter", "30d"],
	["setLikedVideoDurationFilter", "getLikedVideoDurationFilter", "20to60"],
	["setLikedVideoAudioLanguageFilter", "getLikedVideoAudioLanguageFilter", "en"],
	["setLikedVideoLanguageFilter", "getLikedVideoLanguageFilter", "ko"],
]) {
	localStorageService[setter](value);
	assert.equal(localStorageService[getter](), value);
}
values.set("likedVideoViewPublishedDateFilter", "bad-date-filter");
values.set("likedVideoViewDurationFilter", "bad-duration-filter");
assert.equal(localStorageService.getLikedVideoPublishedDateFilter(), "all");
assert.equal(localStorageService.getLikedVideoDurationFilter(), "all");
values.set("likedVideoViewAudioLanguageFilter", "invalid value");
assert.equal(localStorageService.getLikedVideoAudioLanguageFilter(), "all");
localStorageService.setLikedVideoAudioLanguageFilter("unknown");
assert.equal(localStorageService.getLikedVideoAudioLanguageFilter(), "unknown");
values.set("likedVideoViewLanguageFilter", "invalid value");
assert.equal(localStorageService.getLikedVideoLanguageFilter(), "all");
localStorageService.setLikedVideoLanguageFilter("unknown");
assert.equal(localStorageService.getLikedVideoLanguageFilter(), "unknown");

const {
	classifyVideoContent,
	getVideoLanguageLabel,
	matchesDurationFilter,
	matchesPublishedDateFilter,
	normalizeVideoLanguage,
	parseDurationToSeconds,
} = await importBundle("src/utils/videoUtils.ts");

for (const [input, expected] of [
	[undefined, "unknown"], [null, "unknown"], ["", "unknown"], [42, "unknown"],
	[" EN-us ", "en"], ["en-GB", "en"], ["ko", "ko"], ["zh-Hans", "zh"],
	["und", "unknown"], ["zxx", "zxx"],
]) {
	assert.equal(normalizeVideoLanguage(input), expected);
}
assert.equal(getVideoLanguageLabel("en"), "English");
assert.equal(getVideoLanguageLabel("unknown"), "Unknown");
assert.equal(getVideoLanguageLabel("zxx"), "No linguistic content");

const dayMs = 24 * 60 * 60 * 1000;
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");
const iso = value => new Date(value).toISOString();

assert.equal(matchesPublishedDateFilter("invalid", "all", nowMs), true);
assert.equal(matchesPublishedDateFilter(iso(nowMs - 7 * dayMs), "7d", nowMs), true);
assert.equal(matchesPublishedDateFilter(iso(nowMs - 7 * dayMs - 1), "7d", nowMs), false);
assert.equal(matchesPublishedDateFilter(iso(nowMs - 30 * dayMs), "30d", nowMs), true);
assert.equal(matchesPublishedDateFilter(iso(nowMs - 365 * dayMs), "365d", nowMs), true);
assert.equal(matchesPublishedDateFilter(iso(nowMs + 1), "7d", nowMs), false);
assert.equal(matchesPublishedDateFilter("invalid", "7d", nowMs), false);

assert.equal(matchesDurationFilter(null, "all"), true);
assert.equal(matchesDurationFilter(null, "under5"), false);
assert.equal(matchesDurationFilter(0, "under5"), false);
assert.equal(matchesDurationFilter(299, "under5"), true);
assert.equal(matchesDurationFilter(300, "under5"), false);
assert.equal(matchesDurationFilter(300, "5to20"), true);
assert.equal(matchesDurationFilter(1199, "5to20"), true);
assert.equal(matchesDurationFilter(1200, "5to20"), false);
assert.equal(matchesDurationFilter(1200, "20to60"), true);
assert.equal(matchesDurationFilter(3599, "20to60"), true);
assert.equal(matchesDurationFilter(3600, "20to60"), false);
assert.equal(matchesDurationFilter(3600, "60plus"), true);

assert.equal(parseDurationToSeconds("PT1H"), 3600);
assert.deepEqual(
	classifyVideoContent({ snippet: { categoryId: "10" }, contentDetails: { duration: "PT1M" } }, 90, 60),
	{ isShort: true, isMusic: true, isRegularVideo: false },
	"Shorts and Music classification remains overlapping",
);

console.log("Liked-video filters: migration, persistence, date/duration boundaries, and duration cache contracts passed.");
