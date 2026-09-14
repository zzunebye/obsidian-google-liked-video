import type { YouTubeVideo } from "src/types";

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
): VideoContentClassification {
	const durationSeconds = parseDurationToSeconds(video.contentDetails?.duration) ?? 0;
	const isShort = durationSeconds > 0 && durationSeconds <= shortVideoMaxDurationSeconds;
	const isMusic = video.snippet.categoryId === "10";

	return {
		isShort,
		isMusic,
		isRegularVideo: !isShort && !isMusic,
	};
}
