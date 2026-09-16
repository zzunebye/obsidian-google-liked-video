import { normalizePath } from 'obsidian';
import type { DataAdapter } from 'obsidian';
import type { YouTubeVideo } from 'src/types';
import { isYouTubeVideo } from 'src/utils/youtubeVideoValidation';

const LEGACY_KEY = 'googleYtbLikedVideoLikedVideos';
const STORAGE_INSTANCES = Symbol.for('geulo.likedVideoStorage.instances');

type StorageAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write'> & {
	[STORAGE_INSTANCES]?: Map<string, LikedVideoStorageService>;
};

interface StoredLikedVideos {
	ownerChannelId: string | null;
	videos: YouTubeVideo[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVideos(value: unknown): YouTubeVideo[] {
	if (!Array.isArray(value) || !value.every(isYouTubeVideo)) {
		throw new Error('Invalid liked video list. The original data has been preserved.');
	}
	return value;
}

function parseOwnerChannelId(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value === 'string' && value.trim().length > 0) return value;
	throw new Error('Invalid liked-video cache owner. The original data has been preserved.');
}

function parseStoredLikedVideos(value: unknown): StoredLikedVideos {
	if (!isRecord(value)) {
		throw new Error('Unsupported liked-videos.json format. The original file has been preserved.');
	}
	if (value.schemaVersion === 1) {
		return { ownerChannelId: null, videos: parseVideos(value.videos) };
	}
	if (value.schemaVersion === 2) {
		return {
			ownerChannelId: parseOwnerChannelId(value.ownerChannelId),
			videos: parseVideos(value.videos),
		};
	}
	throw new Error('Unsupported liked-videos.json format. The original file has been preserved.');
}

export class LikedVideoStorageService {
	private videos: YouTubeVideo[] = [];
	private initialized = false;
	private closed = false;
	private revision = 0;
	private savedRevision = 0;
	private pendingWrite: Promise<void> | null = null;
	private ownerChannelId: string | null = null;
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
			const stored = parseStoredLikedVideos(data);
			this.ownerChannelId = stored.ownerChannelId;
			this.videos = stored.videos;
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

	getOwnerChannelId(): string | null {
		this.requireInitialized();
		return this.ownerChannelId;
	}

	async setOwnerChannelId(ownerChannelId: string): Promise<void> {
		this.requireInitialized();
		if (this.closed) throw new Error('Liked video storage is closed.');
		const owner = parseOwnerChannelId(ownerChannelId);
		if (this.ownerChannelId === owner) return;
		const previousOwnerChannelId = this.ownerChannelId;
		this.ownerChannelId = owner;
		this.revision++;
		const revision = this.revision;
		try {
			await this.flush();
		} catch (error) {
			if (this.revision === revision) {
				this.ownerChannelId = previousOwnerChannelId;
				this.revision++;
			}
			throw error;
		}
	}

	setVideos(videos: YouTubeVideo[]): void {
		this.requireInitialized();
		if (this.closed) throw new Error('Liked video storage is closed.');
		this.videos = [...parseVideos(videos)];
		this.revision++;
	}

	async setVideosForOwner(videos: YouTubeVideo[], ownerChannelId: string): Promise<void> {
		this.requireInitialized();
		if (this.closed) throw new Error('Liked video storage is closed.');
		const nextVideos = [...parseVideos(videos)];
		const nextOwnerChannelId = parseOwnerChannelId(ownerChannelId);
		const previousVideos = this.videos;
		const previousOwnerChannelId = this.ownerChannelId;
		this.videos = nextVideos;
		this.ownerChannelId = nextOwnerChannelId;
		this.revision++;
		const revision = this.revision;
		try {
			await this.flush();
		} catch (error) {
			if (this.revision === revision) {
				this.videos = previousVideos;
				this.ownerChannelId = previousOwnerChannelId;
				this.revision++;
			}
			throw error;
		}
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
		const json = JSON.stringify({
			schemaVersion: 2,
			ownerChannelId: this.ownerChannelId,
			videos: this.videos,
		}, null, 2);
		if (await this.adapter.exists(this.filePath)) {
			const previous = await this.adapter.read(this.filePath);
			const data: unknown = JSON.parse(previous);
			parseStoredLikedVideos(data);
			await this.adapter.write(normalizePath(`${this.filePath}.bak`), previous);
		}
		await this.adapter.write(this.filePath, json);
	}

	private requireInitialized(): void {
		if (!this.initialized) throw new Error('Liked video storage has not been initialized.');
	}
}
