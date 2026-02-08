import { YouTubeVideo } from "src/types";

export interface MergeVideosOptions {
	/** If true (default), keep stored videos not present in fetched set. If false, drop them (for full scans). */
	keepUnfetched?: boolean;
}

export interface MergeVideosResult {
	/** The merged video list, with fetched data taking precedence */
	mergedVideos: YouTubeVideo[];
	/** Videos that were newly added (not in stored set) */
	newVideos: YouTubeVideo[];
	/** Count of existing videos whose properties were updated */
	updatedCount: number;
}

/**
 * Merges fetched videos with stored videos, updating existing video properties
 * while preserving the original pulled_at timestamp.
 *
 * @param fetchedVideos - Videos freshly fetched from the API
 * @param storedVideos - Videos currently in storage
 * @param options - Merge behavior options
 * @returns Merged result with new videos and update count
 */
export function mergeVideos(
	fetchedVideos: YouTubeVideo[],
	storedVideos: YouTubeVideo[],
	options: MergeVideosOptions = {}
): MergeVideosResult {
	const { keepUnfetched = true } = options;

	// Build a Map from stored videos for O(1) lookup
	const storedVideoMap = new Map<string, YouTubeVideo>();
	for (const video of storedVideos) {
		storedVideoMap.set(video.id, video);
	}

	const newVideos: YouTubeVideo[] = [];
	let updatedCount = 0;

	// Process fetched videos - update existing or track as new
	const mergedVideos: YouTubeVideo[] = fetchedVideos.map((fetchedVideo) => {
		const storedVideo = storedVideoMap.get(fetchedVideo.id);

		if (storedVideo) {
			// Video exists in storage - update properties but preserve pulled_at
			updatedCount++;
			return {
				...fetchedVideo,
				pulled_at: storedVideo.pulled_at,
			};
		} else {
			// New video
			newVideos.push(fetchedVideo);
			return fetchedVideo;
		}
	});

	// If keepUnfetched is true, append stored videos not in the fetched set
	if (keepUnfetched) {
		const fetchedIds = new Set(fetchedVideos.map((v) => v.id));
		for (const storedVideo of storedVideos) {
			if (!fetchedIds.has(storedVideo.id)) {
				mergedVideos.push(storedVideo);
			}
		}
	}

	return {
		mergedVideos,
		newVideos,
		updatedCount,
	};
}
