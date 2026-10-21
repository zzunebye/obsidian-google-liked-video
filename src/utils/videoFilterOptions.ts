import type { DurationFilter, PresenceFilter, YouTubeVideo } from "src/types";
import { getVideoLanguageLabel, normalizeVideoLanguage } from "./videoUtils";
import { t } from "../i18n";

export const AI_SUMMARY_FILTER_OPTIONS: ReadonlyArray<{
	value: PresenceFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: t("filter.all"), activeLabel: t("filter.allSummaries") },
	{ value: "with", label: t("filter.hasSummary"), activeLabel: t("filter.has") },
	{ value: "without", label: t("filter.noSummary"), activeLabel: t("filter.missing") },
];

export const DURATION_FILTER_OPTIONS: ReadonlyArray<{
	value: DurationFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: t("filter.any"), activeLabel: t("filter.anyDuration") },
	{ value: "under5", label: t("filter.under5Min"), activeLabel: t("filter.under5Min") },
	{ value: "5to20", label: t("filter.5to20Min"), activeLabel: t("filter.5to20Min") },
	{ value: "20to60", label: t("filter.20to60Min"), activeLabel: t("filter.20to60Min") },
	{ value: "60plus", label: t("filter.60plusMin"), activeLabel: t("filter.60plusMin") },
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
