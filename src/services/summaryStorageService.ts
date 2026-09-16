import { normalizePath } from "obsidian";
import type { DataAdapter } from "obsidian";
import { SummaryFileData, SummaryStorageFile, VideoMetadata, CachedLLMSummary } from "../types";
import { debugLogger } from "../debug";

export class SummaryStorageService {
	private adapter: DataAdapter;
	private filePath: string;
	private maxEntries: number;
	private cache: Map<string, SummaryFileData> = new Map();
	private writeQueue: Promise<void> = Promise.resolve();
	private listeners = new Set<() => void>();

	constructor(adapter: DataAdapter, manifestDir: string, maxEntries = 500) {
		this.adapter = adapter;
		this.filePath = normalizePath(`${manifestDir}/summaries.json`);
		this.maxEntries = maxEntries;
	}

	// Initialize the storage service, loading existing summaries
	async initialize(): Promise<void> {
		debugLogger.info("[SummaryStorage] Initializing...");

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

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getOneLineSummary(videoId: string): string | null {
		const entry = this.cache.get(videoId);
		if (!entry) return null;
		return entry.oneLinerSummary || entry.summary.slice(0, 100) + '...';
	}

	async getVideoSummaryData(videoId: string): Promise<SummaryFileData | null> {
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
			source: summary.source ?? 'video',
		};

		await this.persist(cache => {
			cache.delete(videoId);
			cache.set(videoId, fileData);
			this.evictIfNeeded(cache);
		});
		debugLogger.debug(`[SummaryStorage] Wrote summary for ${videoId}`);
	}

	async deleteVideoSummary(videoId: string): Promise<void> {
		await this.persist(cache => { cache.delete(videoId); });
	}

	async setOneLinerSummary(videoId: string, oneLiner: string): Promise<void> {
		await this.persist(cache => {
			const entry = cache.get(videoId);
			if (entry) cache.set(videoId, { ...entry, oneLinerSummary: oneLiner });
		});
		debugLogger.debug(`[SummaryStorage] Set one-liner summary for ${videoId}`);
	}

	private persist(update: (cache: Map<string, SummaryFileData>) => void): Promise<void> {
		const write = this.writeQueue.then(async () => {
			const cache = new Map(this.cache);
			update(cache);
			const data: SummaryStorageFile = {
				schemaVersion: 1,
				summaries: Object.fromEntries(cache),
			};
			await this.adapter.write(this.filePath, JSON.stringify(data, null, 2));
			this.cache = cache;
			this.listeners.forEach(listener => listener());
		});
		this.writeQueue = write.catch(err => debugLogger.error("[SummaryStorage] Failed to persist:", err));
		return write;
	}

	private evictIfNeeded(cache: Map<string, SummaryFileData>): void {
		while (cache.size > this.maxEntries) {
			const oldest = cache.keys().next().value;
			if (oldest === undefined) break;
			debugLogger.debug(`[SummaryStorage] Evicting oldest summary: ${oldest}`);
			cache.delete(oldest);
		}
	}

	/**
	 * Cleanup resources when plugin is unloaded
	 */
	cleanup(): void {
		// Clear pending write queue
		this.writeQueue = Promise.resolve();
		// Clear in-memory cache
		this.cache.clear();
		this.listeners.clear();
		debugLogger.info("[SummaryStorage] Resources cleaned up");
	}
}
