import type { DurationFilter, PublishedDateFilter, YouTubeVideo } from "src/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function normalizeVideoLanguage(language: unknown): string {
	if (typeof language !== "string") return "unknown";
	const baseLanguage = language.trim().toLowerCase().split("-")[0];
	return /^[a-z]{2,3}$/.test(baseLanguage) && baseLanguage !== "und"
		? baseLanguage : "unknown";
}

export function getVideoLanguageLabel(language: string): string {
	if (language === "unknown") return "Unknown";
	if (language === "zxx") return "No linguistic content";
	return languageNames.of(language) ?? language;
}

export interface VideoContentClassification {
	isShort: boolean;
	isMusic: boolean;
	isRegularVideo: boolean;
}

export function parseDurationToSeconds(duration: string | undefined): number | null {
	if (!duration || !duration.startsWith("P")) return null;

	const match = duration.match(
		/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
	);
	if (!match) return null;

	const weeks = match[1] ? parseInt(match[1]) : 0;
	const days = match[2] ? parseInt(match[2]) : 0;
	const hours = match[3] ? parseInt(match[3]) : 0;
	const minutes = match[4] ? parseInt(match[4]) : 0;
	const seconds = match[5] ? parseInt(match[5]) : 0;

	return weeks * 604800 + days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function matchesPublishedDateFilter(
	publishedAt: string,
	filter: PublishedDateFilter,
	nowMs = Date.now(),
): boolean {
	if (filter === "all") return true;

	const publishedAtMs = Date.parse(publishedAt);
	if (!Number.isFinite(publishedAtMs) || publishedAtMs > nowMs) return false;

	let days: number;
	switch (filter) {
		case "7d":
			days = 7;
			break;
		case "30d":
			days = 30;
			break;
		default:
			days = 365;
	}
	return publishedAtMs >= nowMs - days * DAY_MS;
}

export function matchesDurationFilter(
	durationSeconds: number | null,
	filter: DurationFilter,
): boolean {
	if (filter === "all") return true;
	if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return false;
	}

	switch (filter) {
		case "under5":
			return durationSeconds < 5 * 60;
		case "5to20":
			return durationSeconds >= 5 * 60 && durationSeconds < 20 * 60;
		case "20to60":
			return durationSeconds >= 20 * 60 && durationSeconds < 60 * 60;
		case "60plus":
			return durationSeconds >= 60 * 60;
	}
}

export function formatVideoDuration(duration: string | undefined): string {
	const seconds = parseDurationToSeconds(duration);
	if (!seconds) return "";

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = seconds % 60;

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
	}
	return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatVideoCount(
	count: number | string,
	includeBillions = true,
): string {
	const value = typeof count === "string" ? parseInt(count) : count;
	if (isNaN(value)) return "0";

	if (includeBillions && value >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1)}B`;
	}
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return value.toString();
}

export function classifyVideoContent(
	video: YouTubeVideo,
	shortVideoMaxDurationSeconds: number,
	durationSeconds = parseDurationToSeconds(video.contentDetails?.duration) ?? 0,
): VideoContentClassification {
	const isShort = durationSeconds > 0 && durationSeconds <= shortVideoMaxDurationSeconds;
	const isMusic = video.snippet.categoryId === "10";

	return {
		isShort,
		isMusic,
		isRegularVideo: !isShort && !isMusic,
	};
}
