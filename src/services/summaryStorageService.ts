import { DataAdapter } from "obsidian";
import { SummaryFileData, SummaryStorageFile, VideoMetadata, CachedLLMSummary } from "../types";
import { debugLogger } from "../debug";

export class SummaryStorageService {
	private adapter: DataAdapter;
	private filePath: string;
	private legacyDir: string;
	private maxEntries: number;
	private cache: Map<string, SummaryFileData> = new Map();
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(adapter: DataAdapter, manifestDir: string, maxEntries = 500) {
		this.adapter = adapter;
		this.filePath = `${manifestDir}/summaries.json`;
		this.legacyDir = `${manifestDir}/summaries`;
		this.maxEntries = maxEntries;
	}

	async initialize(): Promise<void> {
		debugLogger.info("[SummaryStorage] Initializing...");

		// Migrate from Option 4 per-video files if legacy directory exists
		await this.migrateFromPerVideoFiles();

		// Load single file
		if (await this.adapter.exists(this.filePath)) {
			try {
				const content = await this.adapter.read(this.filePath);
				const data: SummaryStorageFile = JSON.parse(content);
				for (const [videoId, entry] of Object.entries(data.summaries)) {
					this.cache.set(videoId, entry);
				}
			} catch (err) {
				debugLogger.error("[SummaryStorage] Failed to read summaries.json:", err);
			}
		}

		debugLogger.info(`[SummaryStorage] Loaded ${this.cache.size} summaries`);
	}

	hasVideoSummary(videoId: string): boolean {
		return this.cache.has(videoId);
	}

	getVideoSummaryPreview(videoId: string): string | null {
		const entry = this.cache.get(videoId);
		return entry ? entry.summary.slice(0, 150) : null;
	}

	async getVideoSummary(videoId: string): Promise<SummaryFileData | null> {
		return this.cache.get(videoId) ?? null;
	}

	async setVideoSummary(
		videoId: string,
		summary: CachedLLMSummary,
		metadata: VideoMetadata,
	): Promise<void> {
		const fileData: SummaryFileData = {
			schemaVersion: 1,
			videoId,
			title: metadata.title,
			channelTitle: metadata.channelTitle,
			channelId: metadata.channelId,
			videoUrl: metadata.videoUrl,
			summary: summary.summary,
			generatedAt: summary.generatedAt,
			model: summary.model,
		};

		// LRU: delete then re-insert so it goes to the end
		this.cache.delete(videoId);
		this.cache.set(videoId, fileData);

		// LRU eviction
		this.evictIfNeeded();

		await this.persist();
		debugLogger.debug(`[SummaryStorage] Wrote summary for ${videoId}`);
	}

	async deleteVideoSummary(videoId: string): Promise<void> {
		this.cache.delete(videoId);
		await this.persist();
	}

	async migrateFromLocalStorage(): Promise<void> {
		const raw = window.localStorage.getItem("googleYtbVideoSummaries");
		if (!raw) return;

		debugLogger.info("[SummaryStorage] Migrating summaries from localStorage...");

		try {
			const summaries: Record<string, CachedLLMSummary> = JSON.parse(raw);
			const entries = Object.entries(summaries);
			let migrated = 0;

			for (const [videoId, cached] of entries) {
				if (this.cache.has(videoId)) continue;

				this.cache.set(videoId, {
					schemaVersion: 1,
					videoId,
					title: "",
					channelTitle: "",
					channelId: "",
					videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
					summary: cached.summary,
					generatedAt: cached.generatedAt,
					model: cached.model,
				});
				migrated++;
			}

			if (migrated > 0) {
				this.evictIfNeeded();
				await this.persist();
			}

			window.localStorage.removeItem("googleYtbVideoSummaries");
			debugLogger.info(`[SummaryStorage] Migrated ${migrated} summaries from localStorage, removed key`);
		} catch (err) {
			debugLogger.error("[SummaryStorage] localStorage migration failed:", err);
		}
	}

	private persist(): Promise<void> {
		const data: SummaryStorageFile = {
			schemaVersion: 1,
			summaries: Object.fromEntries(this.cache),
		};
		const json = JSON.stringify(data, null, 2);
		this.writeQueue = this.writeQueue
			.then(() => this.adapter.write(this.filePath, json))
			.catch((err) => debugLogger.error("[SummaryStorage] Failed to persist:", err));
		return this.writeQueue;
	}

	private evictIfNeeded(): void {
		while (this.cache.size > this.maxEntries) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			debugLogger.debug(`[SummaryStorage] Evicting oldest summary: ${oldest}`);
			this.cache.delete(oldest);
		}
	}

	/**
	 * Migrate from Option 4 per-video file storage to single-file storage.
	 * Reads all .json files from the legacy summaries/ directory, merges into cache,
	 * persists to summaries.json, then removes the directory.
	 */
	private async migrateFromPerVideoFiles(): Promise<void> {
		if (!(await this.adapter.exists(this.legacyDir))) return;

		debugLogger.info("[SummaryStorage] Migrating from per-video files...");

		try {
			const listing = await this.adapter.list(this.legacyDir);
			let migrated = 0;

			for (const filePath of listing.files) {
				if (!filePath.endsWith(".json")) continue;
				try {
					const content = await this.adapter.read(filePath);
					const data: SummaryFileData = JSON.parse(content);
					if (!this.cache.has(data.videoId)) {
						this.cache.set(data.videoId, data);
						migrated++;
					}
				} catch (err) {
					debugLogger.error(`[SummaryStorage] Failed to read legacy file ${filePath}:`, err);
				}
			}

			// Persist merged data
			if (migrated > 0) {
				this.evictIfNeeded();
				await this.persist();
			}

			// Clean up legacy files and directory
			for (const filePath of listing.files) {
				try {
					await this.adapter.remove(filePath);
				} catch (err) {
					debugLogger.error(`[SummaryStorage] Failed to remove legacy file ${filePath}:`, err);
				}
			}
			try {
				await this.adapter.rmdir(this.legacyDir, false);
				debugLogger.info(`[SummaryStorage] Migrated ${migrated} summaries from per-video files, removed legacy directory`);
			} catch (err) {
				debugLogger.error("[SummaryStorage] Failed to remove legacy directory:", err);
			}
		} catch (err) {
			debugLogger.error("[SummaryStorage] Per-video file migration failed:", err);
		}
	}
}
