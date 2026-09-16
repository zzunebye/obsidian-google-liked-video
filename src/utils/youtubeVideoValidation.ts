import type { YouTubeVideo } from 'src/types';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalCount(value: unknown): boolean {
	return value === undefined
		|| (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0)
		|| (typeof value === 'string' && /^\d+$/.test(value) && Number.isFinite(Number(value)));
}

export function isYouTubeVideo(value: unknown): value is YouTubeVideo {
	if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || !isRecord(value.snippet)
		|| !isRecord(value.contentDetails) || !isRecord(value.statistics)) return false;
	const snippet = value.snippet;
	return ['title', 'channelTitle', 'channelId', 'publishedAt', 'description'].every(key => typeof snippet[key] === 'string')
		&& isRecord(snippet.thumbnails) && isRecord(snippet.thumbnails.medium)
		&& typeof snippet.thumbnails.medium.url === 'string'
		&& (snippet.tags === undefined || (Array.isArray(snippet.tags) && snippet.tags.every(tag => typeof tag === 'string')))
		&& (value.contentDetails.duration === undefined || typeof value.contentDetails.duration === 'string')
		&& isOptionalCount(value.statistics.viewCount)
		&& isOptionalCount(value.statistics.likeCount)
		&& isOptionalCount(value.statistics.commentCount);
}
