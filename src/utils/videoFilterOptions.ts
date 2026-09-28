import type { DurationFilter, PresenceFilter, YouTubeVideo } from "src/types";
import { getVideoLanguageLabel, normalizeVideoLanguage } from "./videoUtils";

export const AI_SUMMARY_FILTER_OPTIONS: ReadonlyArray<{
	value: PresenceFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: "All", activeLabel: "All summaries" },
	{ value: "with", label: "Has summary", activeLabel: "Has" },
	{ value: "without", label: "No summary", activeLabel: "Missing" },
];

export const DURATION_FILTER_OPTIONS: ReadonlyArray<{
	value: DurationFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: "Any", activeLabel: "Any duration" },
	{ value: "under5", label: "Under 5 min", activeLabel: "Under 5 min" },
	{ value: "5to20", label: "5–20 min", activeLabel: "5–20 min" },
	{ value: "20to60", label: "20–60 min", activeLabel: "20–60 min" },
	{ value: "60plus", label: "60+ min", activeLabel: "60+ min" },
];

export function getLanguageFilterOptions(
	videos: readonly YouTubeVideo[],
	field: "defaultLanguage" | "defaultAudioLanguage",
	selectedLanguage: string,
): { value: string; label: string; count: number }[] {
	const counts = new Map<string, number>();
	videos.forEach((video) => {
		const language = normalizeVideoLanguage(video.snippet[field]);
		counts.set(language, (counts.get(language) ?? 0) + 1);
	});
	if (selectedLanguage !== "all" && !counts.has(selectedLanguage)) {
		counts.set(selectedLanguage, 0);
	}
	return Array.from(counts, ([value, count]) => ({
		value, count, label: getVideoLanguageLabel(value),
	})).sort((a, b) => {
		if (a.value === "unknown") return 1;
		if (b.value === "unknown") return -1;
		return a.label.localeCompare(b.label);
	});
}
