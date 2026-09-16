import { Notice } from "obsidian";
import type { LikedVideoApi } from "src/api";
import { debugLogger } from "src/debug";
import { localStorageService } from "src/storage";
import type { YouTubeVideo } from "src/types";

type LikedVideoMutationApi = Pick<LikedVideoApi, "likeVideo" | "unlikeVideo">;
type InsertIndex = number | (() => number);
type RatingChanged = (videoId: string, liked: boolean) => Promise<void>;

async function updateNoteRating(onRatingChanged: RatingChanged | undefined, videoId: string, liked: boolean): Promise<void> {
	try {
		await onRatingChanged?.(videoId, liked);
	} catch (error) {
		debugLogger.error('[Video note] Could not save like status after a successful YouTube change', error);
		new Notice('Geulo: YouTube was updated, but the note’s liked property could not be saved. Reopen the note to retry.');
	}
}

export async function likeVideoAndPersist(
	api: LikedVideoMutationApi,
	video: YouTubeVideo,
	insertIndex: InsertIndex = 0,
	onRatingChanged?: RatingChanged,
): Promise<void> {
	await api.likeVideo(video.id);
	const resolvedInsertIndex = typeof insertIndex === "function"
		? insertIndex()
		: insertIndex;
	localStorageService.restoreLikedVideo(video, resolvedInsertIndex);
	await updateNoteRating(onRatingChanged, video.id, true);
}

export async function unlikeVideoAndPersist(
	api: LikedVideoMutationApi,
	videoId: string,
	onRatingChanged?: RatingChanged,
): Promise<void> {
	await api.unlikeVideo(videoId);
	localStorageService.removeLikedVideo(videoId);
	await updateNoteRating(onRatingChanged, videoId, false);
}
