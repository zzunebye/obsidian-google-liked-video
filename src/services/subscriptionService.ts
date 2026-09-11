import type {
	SubscriptionChannel,
	YouTubeVideo,
} from "src/types";
import { debugLogger } from "src/debug";
import { SubscriptionStorageService } from "./subscriptionStorageService";
import { YouTubeApiClient, YouTubeRequestError } from "./youtubeApiClient";

const CHANNEL_BATCH_SIZE = 50;
const VIDEO_BATCH_SIZE = 50;
const RECENT_VIDEOS_PER_CHANNEL = 5;
const CHANNEL_DETAILS_CONCURRENCY = 4;
const CHANNEL_UPLOADS_CONCURRENCY = 6;
const VIDEO_DETAILS_CONCURRENCY = 6;

type SubscriptionItem = {
	id?: string;
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
	failureDetails: Record<string, SubscriptionFailureDetail>;
	updatedAt: number;
}

export interface SubscriptionFailureDetail {
	message: string;
	retryable: boolean;
}

export interface UnsubscribeFailure {
	channel: SubscriptionChannel;
	message: string;
}

export interface UnsubscribeResult {
	snapshot: SubscriptionSnapshot;
	succeededChannels: SubscriptionChannel[];
	failedChannels: UnsubscribeFailure[];
}

interface FetchOptions {
	signal?: AbortSignal;
	onProgress?: (progress: SubscriptionProgress) => void;
	channels?: SubscriptionChannel[];
	commit?: boolean;
}

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		result.push(items.slice(index, index + size));
	}
	return result;
}

async function forEachConcurrent<T>(
	items: T[],
	concurrency: number,
	task: (item: T) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const item = items[nextIndex++];
			await task(item);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
	);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DOMException("Subscription refresh cancelled", "AbortError");
	}
}

class SubscriptionRequestError extends Error {
	constructor(message: string, readonly retryable: boolean) {
		super(message);
		this.name = "SubscriptionRequestError";
	}
}

function hasReason(error: YouTubeRequestError, ...reasons: string[]): boolean {
	return error.reasons.some((reason) => reasons.includes(reason));
}

function getRequestFailure(error: YouTubeRequestError): SubscriptionFailureDetail {
	if (error.kind === "auth") return { message: "Google authentication expired.", retryable: true };
	if (error.kind === "network" || error.kind === "timeout") {
		return { message: error.message, retryable: true };
	}
	if (error.status === 404 || hasReason(error, "playlistNotFound")) {
		return { message: "The channel's uploads playlist is unavailable.", retryable: false };
	}
	if (error.status === 403) {
		const quotaExceeded = hasReason(error, "quotaExceeded", "dailyLimitExceeded");
		return {
			message: quotaExceeded ? "YouTube API quota is currently exhausted." : "YouTube denied access to the uploads playlist.",
			retryable: quotaExceeded,
		};
	}
	if (error.status === 429 || (error.status !== undefined && error.status >= 500)) {
		return { message: "YouTube is temporarily unavailable.", retryable: true };
	}
	return { message: error.message, retryable: false };
}

function getFailureDetail(error: unknown): SubscriptionFailureDetail {
	if (error instanceof SubscriptionRequestError) {
		return { message: error.message, retryable: error.retryable };
	}
	return {
		message: error instanceof Error ? error.message : "Unknown error while loading this channel.",
		retryable: true,
	};
}

function getDeleteFailure(error: YouTubeRequestError): SubscriptionFailureDetail {
	if (error.kind === "auth") return { message: "Google authentication expired.", retryable: true };
	if (error.kind === "network" || error.kind === "timeout") {
		return { message: error.message, retryable: true };
	}
	if (error.status === 404 || hasReason(error, "subscriptionNotFound")) {
		return { message: "The YouTube subscription could not be found.", retryable: false };
	}
	if (error.status === 403) {
		const quotaExceeded = hasReason(error, "quotaExceeded", "dailyLimitExceeded");
		return {
			message: quotaExceeded
				? "YouTube API quota is currently exhausted."
				: "YouTube did not allow this subscription to be removed.",
			retryable: quotaExceeded,
		};
	}
	if (error.status === 429 || (error.status !== undefined && error.status >= 500)) {
		return { message: "YouTube is temporarily unavailable.", retryable: true };
	}
	return { message: error.message, retryable: false };
}

export class SubscriptionService {
	private snapshot: SubscriptionSnapshot | null = null;
	private activeRequest: { promise: Promise<SubscriptionSnapshot>; signal?: AbortSignal } | null = null;
	private commitQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly client: YouTubeApiClient,
		private readonly storage: SubscriptionStorageService,
	) {}

	async initialize(): Promise<void> {
		this.snapshot = await this.storage.load();
	}

	getSnapshot(): SubscriptionSnapshot | null {
		return this.snapshot;
	}

	clear(): void {
		this.snapshot = null;
		this.activeRequest = null;
	}

	fetch(options: FetchOptions = {}): Promise<SubscriptionSnapshot> {
		if (this.activeRequest && !this.activeRequest.signal?.aborted) return this.activeRequest.promise;

		const request = this.fetchInternal(options).finally(() => {
			if (this.activeRequest?.promise === request) this.activeRequest = null;
		});
		this.activeRequest = { promise: request, signal: options.signal };
		return request;
	}

	async retryFailed(options: Omit<FetchOptions, "channels"> = {}): Promise<SubscriptionSnapshot> {
		const current = this.snapshot;
		if (!current || current.failedChannels.length === 0) {
			return current ?? this.fetch(options);
		}

		const permanentFailures = current.failedChannels.filter(
			(channel) => current.failureDetails[channel.id]?.retryable === false,
		);
		const retryableFailures = current.failedChannels.filter(
			(channel) => current.failureDetails[channel.id]?.retryable !== false,
		);
		if (retryableFailures.length === 0) return current;

		const retried = await this.fetch({
			...options,
			channels: retryableFailures,
			commit: false,
		});
		throwIfAborted(options.signal);
		const videosById = new Map(current.videos.map((video) => [video.id, video]));
		retried.videos.forEach((video) => videosById.set(video.id, video));
		const failureDetails = { ...retried.failureDetails };
		for (const channel of permanentFailures) {
			const detail = current.failureDetails[channel.id];
			if (detail) failureDetails[channel.id] = detail;
		}
		const combined: SubscriptionSnapshot = {
			channels: current.channels,
			videos: [...videosById.values()].sort((left, right) =>
				right.snippet.publishedAt.localeCompare(left.snippet.publishedAt),
			),
			failedChannels: [...permanentFailures, ...retried.failedChannels],
			failureDetails,
			updatedAt: Date.now(),
		};
		await this.commitSnapshot(combined);
		return combined;
	}

	async unsubscribeChannels(channels: SubscriptionChannel[]): Promise<UnsubscribeResult> {
		const current = this.snapshot;
		if (!current) throw new Error("Subscriptions have not been loaded.");

		const succeededChannels: SubscriptionChannel[] = [];
		const failedChannels: UnsubscribeFailure[] = [];
		for (const channel of channels) {
			try {
				const subscriptionId = channel.subscriptionId ?? await this.findSubscriptionId(channel.id);
				if (subscriptionId) await this.deleteSubscription(subscriptionId);
				succeededChannels.push(channel);
			} catch (error) {
				failedChannels.push({
					channel,
					message: error instanceof Error ? error.message : "Failed to unsubscribe from this channel.",
				});
			}
		}

		if (succeededChannels.length === 0) {
			return { snapshot: current, succeededChannels, failedChannels };
		}

		const removedChannelIds = new Set(succeededChannels.map((channel) => channel.id));
		const failureDetails = { ...current.failureDetails };
		for (const channelId of removedChannelIds) delete failureDetails[channelId];
		const nextSnapshot: SubscriptionSnapshot = {
			channels: current.channels.filter((channel) => !removedChannelIds.has(channel.id)),
			videos: current.videos.filter((video) => !removedChannelIds.has(video.snippet.channelId)),
			failedChannels: current.failedChannels.filter((channel) => !removedChannelIds.has(channel.id)),
			failureDetails,
			updatedAt: current.updatedAt,
		};
		await this.commitSnapshot(nextSnapshot);
		return { snapshot: nextSnapshot, succeededChannels, failedChannels };
	}

	private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
		try {
			return (await this.client.request("GET", path, { signal })).json as T;
		} catch (error) {
			if (!(error instanceof YouTubeRequestError)) throw error;
			const failure = getRequestFailure(error);
			throw new SubscriptionRequestError(failure.message, failure.retryable);
		}
	}

	private async findSubscriptionId(channelId: string): Promise<string | null> {
		const params = new URLSearchParams({
			part: "id,snippet",
			mine: "true",
			forChannelId: channelId,
			maxResults: "5",
		});
		const data = await this.request<ListResponse<SubscriptionItem>>(
			`subscriptions?${params.toString()}`,
		);
		return data.items?.find((item) => item.snippet?.resourceId?.channelId === channelId)?.id ?? null;
	}

	private async deleteSubscription(subscriptionId: string): Promise<void> {
		const params = new URLSearchParams({ id: subscriptionId });
		try {
			await this.client.request("DELETE", `subscriptions?${params.toString()}`);
		} catch (error) {
			if (!(error instanceof YouTubeRequestError)) throw error;
			const failure = getDeleteFailure(error);
			throw new SubscriptionRequestError(failure.message, failure.retryable);
		}
	}

	private async fetchInternal(options: FetchOptions): Promise<SubscriptionSnapshot> {
		throwIfAborted(options.signal);
		const channels = options.channels ?? await this.fetchChannels(options.signal);
		throwIfAborted(options.signal);
		options.onProgress?.({ completedChannels: 0, totalChannels: channels.length });

		const videoIds = new Set<string>();
		const failedChannels: SubscriptionChannel[] = [];
		const failureDetails: Record<string, SubscriptionFailureDetail> = {};
		let completedChannels = 0;
		await forEachConcurrent(channels, CHANNEL_UPLOADS_CONCURRENCY, async (channel) => {
			throwIfAborted(options.signal);
			try {
				const ids = await this.fetchRecentVideoIds(channel, options.signal);
				ids.forEach((id) => videoIds.add(id));
			} catch (error) {
				if (options.signal?.aborted) throw error;
				failedChannels.push(channel);
				failureDetails[channel.id] = getFailureDetail(error);
				debugLogger.warn(`Failed to fetch subscription channel ${channel.id}:`, error);
			} finally {
				if (!options.signal?.aborted) {
					completedChannels += 1;
					options.onProgress?.({ completedChannels, totalChannels: channels.length });
				}
			}
		});
		throwIfAborted(options.signal);

		const videos = await this.fetchVideoDetails([...videoIds], options.signal);
		if (options.channels === undefined && this.snapshot && failedChannels.length > 0) {
			const failedChannelIds = new Set(failedChannels.map((channel) => channel.id));
			for (const video of this.snapshot.videos) {
				if (failedChannelIds.has(video.snippet.channelId) && !videoIds.has(video.id)) {
					videos.push(video);
				}
			}
		}
		videos.sort((left, right) =>
			right.snippet.publishedAt.localeCompare(left.snippet.publishedAt),
		);

		const nextSnapshot: SubscriptionSnapshot = {
			channels,
			videos,
			failedChannels,
			failureDetails,
			updatedAt: Date.now(),
		};
		throwIfAborted(options.signal);
		if (options.commit !== false) await this.commitSnapshot(nextSnapshot, options.signal);
		return nextSnapshot;
	}

	private async commitSnapshot(snapshot: SubscriptionSnapshot, signal?: AbortSignal): Promise<void> {
		const commit = this.commitQueue.then(async () => {
			throwIfAborted(signal);
			await this.storage.save(snapshot);
			if (!signal?.aborted) this.snapshot = snapshot;
		});
		this.commitQueue = commit.catch(() => {});
		await commit;
	}

	private async fetchChannels(signal?: AbortSignal): Promise<SubscriptionChannel[]> {
		const subscriptions: Array<{
			id: string;
			title: string;
			thumbnailUrl?: string;
			subscriptionId?: string;
		}> = [];
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
							subscriptionId: item.id,
						});
				}
			}
			pageToken = data.nextPageToken;
		} while (pageToken);

		const uploadsByChannel = new Map<string, string>();
		await forEachConcurrent(chunks(subscriptions, CHANNEL_BATCH_SIZE), CHANNEL_DETAILS_CONCURRENCY, async (batch) => {
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
		});

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

	private async fetchVideoDetails(
		ids: string[],
		signal?: AbortSignal,
	): Promise<YouTubeVideo[]> {
		const videos: YouTubeVideo[] = [];
		const pulledAt = new Date().toISOString();
		await forEachConcurrent(chunks(ids, VIDEO_BATCH_SIZE), VIDEO_DETAILS_CONCURRENCY, async (batch) => {
			const params = new URLSearchParams({
				part: "snippet,contentDetails,statistics",
				id: batch.join(","),
				maxResults: "50",
			});
			const data = await this.request<ListResponse<YouTubeVideo>>(
				`videos?${params.toString()}`,
				signal,
			);
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
		});
		return videos;
	}
}
