import { normalizePath } from 'obsidian';
import type { DataAdapter } from 'obsidian';
import type { YouTubeVideo } from 'src/types';

const LEGACY_KEY = 'googleYtbLikedVideoLikedVideos';
const STORAGE_INSTANCES = Symbol.for('geulo.likedVideoStorage.instances');

type StorageAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write'> & {
	[STORAGE_INSTANCES]?: Map<string, LikedVideoStorageService>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalCount(value: unknown): boolean {
	return value === undefined
		|| (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0)
		|| (typeof value === 'string' && /^\d+$/.test(value) && Number.isFinite(Number(value)));
}

function isVideo(value: unknown): value is YouTubeVideo {
	if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.snippet)
		|| !isRecord(value.contentDetails) || !isRecord(value.statistics)) return false;
	const snippet = value.snippet;
	return ['title', 'channelTitle', 'channelId', 'publishedAt', 'description'].every(key => typeof snippet[key] === 'string')
		&& isRecord(snippet.thumbnails) && isRecord(snippet.thumbnails.medium)
		&& typeof snippet.thumbnails.medium.url === 'string'
		&& (snippet.tags === undefined || (Array.isArray(snippet.tags) && snippet.tags.every(tag => typeof tag === 'string')))
		&& typeof value.contentDetails.duration === 'string'
		&& isOptionalCount(value.statistics.viewCount)
		&& isOptionalCount(value.statistics.likeCount)
		&& isOptionalCount(value.statistics.commentCount);
}

function parseVideos(value: unknown): YouTubeVideo[] {
	if (!Array.isArray(value) || !value.every(isVideo)) {
		throw new Error('Invalid liked video list. The original data has been preserved.');
	}
	return value;
}

export class LikedVideoStorageService {
	private videos: YouTubeVideo[] = [];
	private initialized = false;
	private closed = false;
	private revision = 0;
	private savedRevision = 0;
	private pendingWrite: Promise<void> | null = null;
	readonly filePath: string;

	constructor(private readonly adapter: StorageAdapter, manifestDir: string) {
		this.filePath = normalizePath(`${manifestDir}/liked-videos.json`);
	}

	async initialize(legacyStorage: Pick<Storage, 'getItem' | 'removeItem'>): Promise<void> {
		// The adapter survives plugin reloads; a module-level queue would be recreated too early.
		const instances = this.adapter[STORAGE_INSTANCES] ??= new Map();
		const previous = instances.get(this.filePath);
		if (previous && previous !== this) await previous.close();
		if (await this.adapter.exists(this.filePath)) {
			const data: unknown = JSON.parse(await this.adapter.read(this.filePath));
			if (!isRecord(data) || data.schemaVersion !== 1) {
				throw new Error('Unsupported liked-videos.json format. The original file has been preserved.');
			}
			this.videos = parseVideos(data.videos);
		} else {
			const legacy = legacyStorage.getItem(LEGACY_KEY);
			this.videos = legacy === null ? [] : parseVideos(JSON.parse(legacy));
			await this.writeSnapshot();
			// Keep the legacy copy until the new file has been written and read back successfully.
			const persisted: unknown = JSON.parse(await this.adapter.read(this.filePath));
			if (!isRecord(persisted) || JSON.stringify(persisted.videos) !== JSON.stringify(this.videos)) {
				throw new Error('Could not verify liked video migration. Legacy data has been preserved.');
			}
		}
		legacyStorage.removeItem(LEGACY_KEY);
		this.initialized = true;
		instances.set(this.filePath, this);
	}

	getVideos(): YouTubeVideo[] {
		this.requireInitialized();
		return [...this.videos];
	}

	setVideos(videos: YouTubeVideo[]): void {
		this.requireInitialized();
		if (this.closed) throw new Error('Liked video storage is closed.');
		this.videos = [...videos];
		this.revision++;
	}

	close(): Promise<void> {
		this.closed = true;
		return this.flush();
	}

	flush(): Promise<void> {
		this.requireInitialized();
		if (!this.pendingWrite) {
			// Start on the next microtask so synchronous updates share one serialization/write.
			this.pendingWrite = Promise.resolve().then(async () => {
				try {
					while (this.savedRevision !== this.revision) {
						const revision = this.revision;
						await this.writeSnapshot();
						this.savedRevision = revision;
					}
				} finally {
					this.pendingWrite = null;
				}
			});
		}
		return this.pendingWrite;
	}

	private async writeSnapshot(): Promise<void> {
		const json = JSON.stringify({ schemaVersion: 1, videos: this.videos }, null, 2);
		if (await this.adapter.exists(this.filePath)) {
			const previous = await this.adapter.read(this.filePath);
			const data: unknown = JSON.parse(previous);
			if (!isRecord(data) || data.schemaVersion !== 1) throw new Error('Unsupported liked video file. Save cancelled.');
			parseVideos(data.videos);
			await this.adapter.write(normalizePath(`${this.filePath}.bak`), previous);
		}
		await this.adapter.write(this.filePath, json);
	}

	private requireInitialized(): void {
		if (!this.initialized) throw new Error('Liked video storage has not been initialized.');
	}
}
