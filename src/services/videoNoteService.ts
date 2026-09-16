import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import { debugLogger } from 'src/debug';
import type GoogleLikedVideoPlugin from 'src/main';
import type { YouTubeVideo } from 'src/types';
import { computeExpectedNotePath, generateVideoNoteContent, getExpectedNotePath, getVideoUrl, sanitizeFileName } from 'src/utils/noteUtils';
import { ensureVideoNoteId, findVideoNote, updateVideoNoteLiked } from 'src/utils/videoNoteUtils';
import { TemplateService } from './templateService';

interface VideoNoteResult {
	file: TFile;
	created: boolean;
}

export interface LikedStateCheckpoint {
	generation: number;
	revision: number;
}

interface ConfirmedRating {
	liked: boolean;
	revision: number;
	mutationExpiresAt: number;
}

export class VideoNoteService {
	private readonly pending = new Map<string, Promise<VideoNoteResult>>();
	private readonly ratings = new Map<string, ConfirmedRating>();
	private readonly ratingRequests = new Map<string, Promise<void>>();
	private readonly writes = new Map<string, Promise<void>>();
	private controller = new AbortController();
	private generation = 0;
	private revision = 0;
	private active = true;

	constructor(private readonly plugin: GoogleLikedVideoPlugin) {}

	async getOrCreate(video: YouTubeVideo, url = getVideoUrl(video.id), options: { reuseConfirmedRating?: boolean } = {}): Promise<VideoNoteResult> {
		const pending = this.pending.get(video.id);
		if (pending) return pending;
		const task = this.findOrCreate(video, url, options.reuseConfirmedRating === true);
		this.pending.set(video.id, task);
		try { return await task; }
		finally { this.pending.delete(video.id); }
	}

	getLikedStateCheckpoint(): LikedStateCheckpoint {
		return { generation: this.generation, revision: this.revision };
	}

	isLikedStateCurrent(checkpoint: LikedStateCheckpoint): boolean {
		return this.active && checkpoint.generation === this.generation;
	}

	captureLikedUpdate(): (videoId: string, liked: boolean) => Promise<void> {
		const checkpoint = this.getLikedStateCheckpoint();
		return async (videoId, liked) => {
			if (!this.isLikedStateCurrent(checkpoint)) return;
			this.ratings.set(videoId, { liked, revision: ++this.revision, mutationExpiresAt: Date.now() + 60_000 });
			await this.writeLiked(videoId);
		};
	}

	async refreshLiked(videoId: string, file?: TFile): Promise<void> {
		await this.refreshRating(videoId);
		await this.writeLiked(videoId, file);
	}

	async syncLikedVideos(fetchedIds: readonly string[], full: boolean, checkpoint: LikedStateCheckpoint): Promise<void> {
		if (!this.isLikedStateCurrent(checkpoint)) return;
		const fetched = new Set(fetchedIds);
		for (const videoId of fetched) {
			if (this.canAcceptRating(videoId, checkpoint)) {
				this.ratings.set(videoId, { liked: true, revision: ++this.revision, mutationExpiresAt: 0 });
			}
		}
		const noteIds = this.plugin.videoNoteIndex.getVideoIds();
		if (full) await this.fetchRatings(noteIds.filter(id => !fetched.has(id)), checkpoint);
		for (const videoId of noteIds) {
			if (!this.isLikedStateCurrent(checkpoint)) return;
			if (full || fetched.has(videoId)) await this.writeLiked(videoId);
		}
	}

	resetLikedState(): void {
		this.controller.abort();
		this.controller = new AbortController();
		this.generation++;
		this.ratings.clear();
		this.ratingRequests.clear();
	}

	destroy(): void {
		this.active = false;
		this.resetLikedState();
	}

	private canAcceptRating(videoId: string, checkpoint: LikedStateCheckpoint): boolean {
		const current = this.ratings.get(videoId);
		return this.isLikedStateCurrent(checkpoint)
			&& (current?.revision ?? 0) <= checkpoint.revision
			&& (current?.mutationExpiresAt ?? 0) <= Date.now();
	}

	private async refreshRating(videoId: string): Promise<void> {
		const pending = this.ratingRequests.get(videoId);
		if (pending) return pending;
		const task = this.fetchRatings([videoId], this.getLikedStateCheckpoint());
		this.ratingRequests.set(videoId, task);
		try { await task; }
		finally {
			if (this.ratingRequests.get(videoId) === task) this.ratingRequests.delete(videoId);
		}
	}

	private async fetchRatings(videoIds: readonly string[], checkpoint: LikedStateCheckpoint): Promise<void> {
		const ids = videoIds.filter(id => this.canAcceptRating(id, checkpoint));
		if (ids.length === 0) return;
		try {
			const ratings = await this.plugin.likedVideoApi.getVideoRatings(ids, this.controller.signal);
			for (const videoId of ids) {
				if (!ratings.has(videoId) && this.canAcceptRating(videoId, checkpoint)) this.ratings.delete(videoId);
			}
			for (const [videoId, liked] of ratings) {
				if (this.canAcceptRating(videoId, checkpoint)) {
					this.ratings.set(videoId, { liked, revision: ++this.revision, mutationExpiresAt: 0 });
				}
			}
		} catch (error) {
			if (this.isLikedStateCurrent(checkpoint)) {
				for (const videoId of ids) {
					if (this.canAcceptRating(videoId, checkpoint)) this.ratings.delete(videoId);
				}
				debugLogger.error('[Video note] Could not check YouTube like status', error);
				new Notice('Geulo: Could not check your YouTube like status. Existing liked properties were kept; reopen the note to retry.');
			}
		}
	}

	private async writeLiked(videoId: string, file?: TFile, created = false): Promise<void> {
		const checkpoint = this.getLikedStateCheckpoint();
		const previous = this.writes.get(videoId) ?? Promise.resolve();
		const task = previous.then(async () => {
			if (!this.isLikedStateCurrent(checkpoint)) return;
			const files = new Set(this.plugin.videoNoteIndex.getAll(videoId));
			if (file) files.add(file);
			let failed = false;
			for (const target of files) {
				const rating = this.ratings.get(videoId);
				if (rating === undefined && !(created && target === file)) continue;
				try {
					await updateVideoNoteLiked(this.plugin.app, target, videoId, rating?.liked,
						() => this.isLikedStateCurrent(checkpoint) && this.ratings.get(videoId) === rating);
				} catch (error) {
					failed = true;
					debugLogger.error('[Video note] Could not write liked property', target.path, error);
				}
			}
			if (failed) new Notice('Geulo: YouTube like status was confirmed, but a note’s liked property could not be saved. Reopen the note to retry.');
		});
		this.writes.set(videoId, task);
		try { await task; }
		finally { if (this.writes.get(videoId) === task) this.writes.delete(videoId); }
	}

	private async findOrCreate(video: YouTubeVideo, url: string, reuseConfirmedRating: boolean): Promise<VideoNoteResult> {
		if (!reuseConfirmedRating || !this.ratings.has(video.id)) await this.refreshRating(video.id);
		const { app, settings, videoNoteIndex } = this.plugin;
		const title = sanitizeFileName(video.snippet.title);
		const folder = settings.videoNotePath.trim();
		const byChannel = folder.length > 0 && settings.organizeByChannel;
		const channel = video.snippet.channelTitle;
		const expectedPath = computeExpectedNotePath(app, title, folder, byChannel, channel);
		const legacyPaths = folder ? [expectedPath]
			: [expectedPath, computeExpectedNotePath(app, title, 'Youtube', byChannel, channel)];
		let file = findVideoNote(app, videoNoteIndex, video.id, legacyPaths);
		let created = false;
		if (!file) {
			const path = await getExpectedNotePath(app, title, folder, byChannel, channel);
			const content = await generateVideoNoteContent(video, url,
				this.plugin.getCategoryDisplay.bind(this.plugin), new TemplateService(app, settings), this.ratings.get(video.id)?.liked);
			file = findVideoNote(app, videoNoteIndex, video.id, legacyPaths);
			if (!file) {
				file = await app.vault.create(path, content);
				created = true;
			}
		}
		await ensureVideoNoteId(app, videoNoteIndex, file, video.id);
		await this.writeLiked(video.id, file, created);
		return { file, created };
	}
}
