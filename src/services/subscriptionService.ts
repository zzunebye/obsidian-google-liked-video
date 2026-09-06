import { requestUrl } from "obsidian";
import { getValidAccessToken } from "src/auth";
import type {
	ObsidianGoogleLikedVideoSettings,
	SubscriptionChannel,
	YouTubeVideo,
} from "src/types";
import { debugLogger } from "src/debug";

const BASE_URL = "https://youtube.googleapis.com/youtube/v3/";
const CHANNEL_BATCH_SIZE = 50;
const VIDEO_BATCH_SIZE = 50;
const RECENT_VIDEOS_PER_CHANNEL = 10;
const CHANNEL_CONCURRENCY = 4;

type SubscriptionItem = {
	snippet?: {
		title?: string;
		resourceId?: { channelId?: string };
		thumbnails?: { default?: { url?: string } };
	};
};

type ChannelItem = {
	id?: string;
	contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

type PlaylistItem = {
	contentDetails?: { videoId?: string };
	snippet?: { resourceId?: { videoId?: string } };
};

type ListResponse<T> = {
	items?: T[];
	nextPageToken?: string;
};

export interface SubscriptionProgress {
	completedChannels: number;
	totalChannels: number;
}

export interface SubscriptionSnapshot {
	channels: SubscriptionChannel[];
	videos: YouTubeVideo[];
	failedChannels: SubscriptionChannel[];
	updatedAt: number;
}

interface FetchOptions {
	signal?: AbortSignal;
	onProgress?: (progress: SubscriptionProgress) => void;
	channels?: SubscriptionChannel[];
}

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		result.push(items.slice(index, index + size));
	}
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException("Subscription refresh cancelled", "AbortError");
	}
}

function getErrorMessage(status: number): string {
	if (status === 401) return "Google authentication expired";
	if (status === 403) return "YouTube API quota exceeded or permission denied";
	if (status >= 500) return "YouTube is temporarily unavailable";
	return `YouTube API request failed (${status})`;
}

export class SubscriptionService {
	private snapshot: SubscriptionSnapshot | null = null;
	private activeRequest: Promise<SubscriptionSnapshot> | null = null;

	constructor(private readonly settings: ObsidianGoogleLikedVideoSettings) {}

	getSnapshot(): SubscriptionSnapshot | null {
		return this.snapshot;
	}

	clear(): void {
		this.snapshot = null;
		this.activeRequest = null;
	}

	fetch(options: FetchOptions = {}): Promise<SubscriptionSnapshot> {
		if (this.activeRequest) return this.activeRequest;

		const request = this.fetchInternal(options).finally(() => {
			if (this.activeRequest === request) this.activeRequest = null;
		});
		this.activeRequest = request;
		return request;
	}

	async retryFailed(options: Omit<FetchOptions, "channels"> = {}): Promise<SubscriptionSnapshot> {
		const current = this.snapshot;
		if (!current || current.failedChannels.length === 0) {
			return current ?? this.fetch(options);
		}

		const retried = await this.fetch({ ...options, channels: current.failedChannels });
		const videosById = new Map(current.videos.map((video) => [video.id, video]));
		retried.videos.forEach((video) => videosById.set(video.id, video));
		const combined: SubscriptionSnapshot = {
			channels: current.channels,
			videos: [...videosById.values()].sort((left, right) =>
				right.snippet.publishedAt.localeCompare(left.snippet.publishedAt),
			),
			failedChannels: retried.failedChannels,
			updatedAt: Date.now(),
		};
		this.snapshot = combined;
		return combined;
	}

	private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
		throwIfAborted(signal);
		const accessToken = await getValidAccessToken(this.settings.googleClientId);
		throwIfAborted(signal);
		const response = await requestUrl({
			url: BASE_URL + path,
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
			throw: false,
		});
		if (response.status >= 400) throw new Error(getErrorMessage(response.status));
		return response.json as T;
	}

	private async fetchInternal(options: FetchOptions): Promise<SubscriptionSnapshot> {
		const channels = options.channels ?? await this.fetchChannels(options.signal);
		options.onProgress?.({ completedChannels: 0, totalChannels: channels.length });

		const videoIds = new Set<string>();
		const failedChannels: SubscriptionChannel[] = [];
		let nextChannelIndex = 0;
		let completedChannels = 0;
		const worker = async (): Promise<void> => {
			while (nextChannelIndex < channels.length) {
				throwIfAborted(options.signal);
				const channel = channels[nextChannelIndex++];
				try {
					const ids = await this.fetchRecentVideoIds(channel, options.signal);
					ids.forEach((id) => videoIds.add(id));
				} catch (error) {
					if (options.signal?.aborted) throw error;
					failedChannels.push(channel);
					debugLogger.warn(`Failed to fetch subscription channel ${channel.id}:`, error);
				} finally {
					completedChannels += 1;
					options.onProgress?.({ completedChannels, totalChannels: channels.length });
				}
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(CHANNEL_CONCURRENCY, channels.length) }, () => worker()),
		);
		throwIfAborted(options.signal);

		const videos = await this.fetchVideoDetails([...videoIds], options.signal);
		videos.sort((left, right) =>
			right.snippet.publishedAt.localeCompare(left.snippet.publishedAt),
		);

		const nextSnapshot: SubscriptionSnapshot = {
			channels,
			videos,
			failedChannels,
			updatedAt: Date.now(),
		};
		this.snapshot = nextSnapshot;
		return nextSnapshot;
	}

	private async fetchChannels(signal?: AbortSignal): Promise<SubscriptionChannel[]> {
		const subscriptions: Array<{ id: string; title: string; thumbnailUrl?: string }> = [];
		let pageToken: string | undefined;
		do {
			const params = new URLSearchParams({
				part: "snippet",
				mine: "true",
				maxResults: "50",
			});
			if (pageToken) params.set("pageToken", pageToken);
			const data = await this.request<ListResponse<SubscriptionItem>>(
				`subscriptions?${params.toString()}`,
				signal,
			);
			for (const item of data.items ?? []) {
				const id = item.snippet?.resourceId?.channelId;
				const title = item.snippet?.title;
				if (id && title) {
					subscriptions.push({
						id,
						title,
						thumbnailUrl: item.snippet?.thumbnails?.default?.url,
					});
				}
			}
			pageToken = data.nextPageToken;
		} while (pageToken);

		const uploadsByChannel = new Map<string, string>();
		for (const batch of chunks(subscriptions, CHANNEL_BATCH_SIZE)) {
			const params = new URLSearchParams({
				part: "contentDetails",
				id: batch.map((channel) => channel.id).join(","),
				maxResults: "50",
			});
			const data = await this.request<ListResponse<ChannelItem>>(
				`channels?${params.toString()}`,
				signal,
			);
			for (const item of data.items ?? []) {
				const uploads = item.contentDetails?.relatedPlaylists?.uploads;
				if (item.id && uploads) uploadsByChannel.set(item.id, uploads);
			}
		}

		return subscriptions.flatMap((channel) => {
			const uploadsPlaylistId = uploadsByChannel.get(channel.id);
			return uploadsPlaylistId ? [{ ...channel, uploadsPlaylistId }] : [];
		});
	}

	private async fetchRecentVideoIds(
		channel: SubscriptionChannel,
		signal?: AbortSignal,
	): Promise<string[]> {
		const params = new URLSearchParams({
			part: "contentDetails,snippet",
			playlistId: channel.uploadsPlaylistId,
			maxResults: String(RECENT_VIDEOS_PER_CHANNEL),
		});
		const data = await this.request<ListResponse<PlaylistItem>>(
			`playlistItems?${params.toString()}`,
			signal,
		);
		return (data.items ?? []).flatMap((item) => {
			const id = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
			return id ? [id] : [];
		});
	}

	private async fetchVideoDetails(ids: string[], signal?: AbortSignal): Promise<YouTubeVideo[]> {
		const videos: YouTubeVideo[] = [];
		for (const batch of chunks(ids, VIDEO_BATCH_SIZE)) {
			const params = new URLSearchParams({
				part: "snippet,contentDetails,statistics",
				id: batch.join(","),
				maxResults: "50",
			});
			const data = await this.request<ListResponse<YouTubeVideo>>(
				`videos?${params.toString()}`,
				signal,
			);
			const pulledAt = new Date().toISOString();
			for (const video of data.items ?? []) {
				if (!video.id || !video.snippet) continue;
				video.pulled_at = pulledAt;
				video.statistics ??= {
					viewCount: 0,
					likeCount: 0,
					favoriteCount: "0",
					commentCount: "0",
				};
				videos.push(video);
			}
		}
		return videos;
	}
}
