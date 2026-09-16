import { normalizePath } from "obsidian";
import type { DataAdapter } from "obsidian";
import type { SubscriptionChannel, YouTubeVideo } from "src/types";
import type { SubscriptionFailureDetail, SubscriptionSnapshot } from "./subscriptionService";

type StorageAdapter = Pick<DataAdapter, "exists" | "read" | "write">;

interface StoredSubscriptions {
	ownerChannelId: string | null;
	snapshot: SubscriptionSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalCount(value: unknown): boolean {
	return value === undefined
		|| (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0)
		|| (typeof value === "string" && /^\d+$/.test(value) && Number.isFinite(Number(value)));
}

function isChannel(value: unknown): value is SubscriptionChannel {
	return isRecord(value)
		&& typeof value.id === "string"
		&& typeof value.title === "string"
		&& typeof value.uploadsPlaylistId === "string"
		&& (value.thumbnailUrl === undefined || typeof value.thumbnailUrl === "string")
		&& (value.subscriptionId === undefined || typeof value.subscriptionId === "string");
}

function isVideo(value: unknown): value is YouTubeVideo {
	if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.snippet)
		|| !isRecord(value.contentDetails) || !isRecord(value.statistics)) return false;
	const snippet = value.snippet;
	return ["title", "channelTitle", "channelId", "publishedAt", "description"].every(
		(key) => typeof snippet[key] === "string",
	)
		&& isRecord(snippet.thumbnails)
		&& isRecord(snippet.thumbnails.medium)
		&& typeof snippet.thumbnails.medium.url === "string"
		&& (snippet.tags === undefined
			|| (Array.isArray(snippet.tags) && snippet.tags.every((tag) => typeof tag === "string")))
		&& (value.contentDetails.duration === undefined || typeof value.contentDetails.duration === "string")
		&& isOptionalCount(value.statistics.viewCount)
		&& isOptionalCount(value.statistics.likeCount)
		&& isOptionalCount(value.statistics.commentCount);
}

function isFailureDetail(value: unknown): value is SubscriptionFailureDetail {
	return isRecord(value)
		&& typeof value.message === "string"
		&& typeof value.retryable === "boolean";
}

function parseSnapshot(value: unknown): SubscriptionSnapshot {
	if (!isRecord(value)
		|| !Array.isArray(value.channels) || !value.channels.every(isChannel)
		|| !Array.isArray(value.videos) || !value.videos.every(isVideo)
		|| !Array.isArray(value.failedChannels) || !value.failedChannels.every(isChannel)
		|| (value.failureDetails !== undefined && (!isRecord(value.failureDetails)
			|| !Object.values(value.failureDetails).every(isFailureDetail)))
		|| typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) {
		throw new Error("Invalid subscriptions.json data.");
	}
	const failureDetails: Record<string, SubscriptionFailureDetail> = {};
	if (isRecord(value.failureDetails)) {
		for (const [channelId, detail] of Object.entries(value.failureDetails)) {
			if (isFailureDetail(detail)) failureDetails[channelId] = detail;
		}
	}
	return {
		channels: [...value.channels],
		videos: [...value.videos],
		failedChannels: [...value.failedChannels],
		failureDetails,
		updatedAt: value.updatedAt,
	};
}

function parseOwnerChannelId(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value === "string" && value.trim().length > 0) return value;
	throw new Error("Invalid subscription cache owner.");
}

function parseStoredSubscriptions(value: unknown): StoredSubscriptions {
	if (!isRecord(value)) {
		throw new Error("Unsupported subscriptions.json format.");
	}
	if (value.schemaVersion === 1) {
		return { ownerChannelId: null, snapshot: parseSnapshot(value.snapshot) };
	}
	if (value.schemaVersion === 2) {
		return {
			ownerChannelId: parseOwnerChannelId(value.ownerChannelId),
			snapshot: parseSnapshot(value.snapshot),
		};
	}
	throw new Error("Unsupported subscriptions.json format.");
}

export class SubscriptionStorageService {
	readonly filePath: string;
	private ownerChannelId: string | null = null;

	constructor(private readonly adapter: StorageAdapter, manifestDir: string) {
		this.filePath = normalizePath(`${manifestDir}/subscriptions.json`);
	}

	async load(): Promise<SubscriptionSnapshot | null> {
		if (!await this.adapter.exists(this.filePath)) {
			this.ownerChannelId = null;
			return null;
		}
		const stored: unknown = JSON.parse(await this.adapter.read(this.filePath));
		const parsed = parseStoredSubscriptions(stored);
		this.ownerChannelId = parsed.ownerChannelId;
		return parsed.snapshot;
	}

	getOwnerChannelId(): string | null {
		return this.ownerChannelId;
	}

	async save(snapshot: SubscriptionSnapshot, ownerChannelId = this.ownerChannelId): Promise<void> {
		const owner = ownerChannelId === null ? null : parseOwnerChannelId(ownerChannelId);
		const stored = { schemaVersion: 2, ownerChannelId: owner, snapshot };
		const json = JSON.stringify(stored, null, 2);
		const candidate: unknown = JSON.parse(json);
		parseStoredSubscriptions(candidate);
		if (await this.adapter.exists(this.filePath)) {
			const previous = await this.adapter.read(this.filePath);
			await this.adapter.write(normalizePath(`${this.filePath}.bak`), previous);
		}
		await this.adapter.write(this.filePath, json);
		const persisted: unknown = JSON.parse(await this.adapter.read(this.filePath));
		parseStoredSubscriptions(persisted);
		this.ownerChannelId = owner;
	}
}
