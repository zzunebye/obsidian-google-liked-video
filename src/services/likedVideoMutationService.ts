import type { LikedVideoApi } from "src/api";
import { localStorageService } from "src/storage";
import type { YouTubeVideo } from "src/types";

type LikedVideoMutationApi = Pick<LikedVideoApi, "likeVideo" | "unlikeVideo">;
type InsertIndex = number | (() => number);

export async function likeVideoAndPersist(
	api: LikedVideoMutationApi,
	video: YouTubeVideo,
	insertIndex: InsertIndex = 0,
): Promise<void> {
	await api.likeVideo(video.id);
	const resolvedInsertIndex = typeof insertIndex === "function"
		? insertIndex()
		: insertIndex;
	localStorageService.restoreLikedVideo(video, resolvedInsertIndex);
}

export async function unlikeVideoAndPersist(
	api: LikedVideoMutationApi,
	videoId: string,
): Promise<void> {
	await api.unlikeVideo(videoId);
	localStorageService.removeLikedVideo(videoId);
}
