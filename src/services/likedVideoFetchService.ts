import { LikedVideoApi } from 'src/api';
import { localStorageService } from 'src/storage';
import { YouTubeVideo } from 'src/types';
import { mergeVideos } from 'src/utils/videoMergeUtils';

export type LikedVideoFetchMode = 'full' | 'partial';

const LIKED_VIDEOS_PAGE_SIZE = 50;

export interface FetchAndMergeLikedVideosOptions {
	mode: LikedVideoFetchMode;
	/**
	 * If true, keep stored videos that were not in the fetched set (partial fetch / auto-fetch).
	 * If false, drop them (manual full scan).
	 */
	keepUnfetched: boolean;
}

export interface FetchAndMergeLikedVideosResult {
	mergedVideos: YouTubeVideo[];
	newVideos: YouTubeVideo[];
	updatedCount: number;
	fetchedCount: number;
}

function nextPageTokenOrUndefined(token: string | undefined | null): string | undefined {
	return token ? token : undefined;
}

export async function fetchAllLikedVideos(
	api: LikedVideoApi
): Promise<YouTubeVideo[]> {
	const allVideos: YouTubeVideo[] = [];
	let nextPageToken: string | undefined = undefined;

	do {
		const response = await api.fetchLikedVideos(LIKED_VIDEOS_PAGE_SIZE, nextPageToken);
		allVideos.push(...(response?.items ?? []));
		nextPageToken = nextPageTokenOrUndefined(response?.nextPageToken);
	} while (nextPageToken !== undefined);

	return allVideos;
}

export async function fetchPartialLikedVideos(
	api: LikedVideoApi
): Promise<YouTubeVideo[]> {
	const response = await api.fetchLikedVideos(LIKED_VIDEOS_PAGE_SIZE);
	return response?.items ?? [];
}

/**
 * Fetches liked videos and merges them with the locally stored list.
 * Does not persist — callers decide when to write to storage and update UI.
 */
export async function fetchAndMergeLikedVideos(
	api: LikedVideoApi,
	options: FetchAndMergeLikedVideosOptions
): Promise<FetchAndMergeLikedVideosResult> {
	const fetchedVideos = options.mode === 'full'
		? await fetchAllLikedVideos(api)
		: await fetchPartialLikedVideos(api);

	const storedVideos = localStorageService.getLikedVideos();
	const { mergedVideos, newVideos, updatedCount } = mergeVideos(
		fetchedVideos,
		storedVideos,
		{ keepUnfetched: options.keepUnfetched }
	);

	return {
		mergedVideos,
		newVideos,
		updatedCount,
		fetchedCount: fetchedVideos.length,
	};
}

export async function createNotesForNewVideos(
	newVideos: YouTubeVideo[],
	autoCreateEnabled: boolean,
	processVideo: (video: YouTubeVideo) => Promise<void>
): Promise<number> {
	if (!autoCreateEnabled || newVideos.length === 0) {
		return 0;
	}

	for (const video of newVideos) {
		await processVideo(video);
	}

	return newVideos.length;
}
