import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { VideoNoteIndexService } from 'src/services/videoNoteIndexService';

export function getVideoNoteId(app: App, file: TFile): string | null {
	const videoId: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.video_id;
	return typeof videoId === 'string' && videoId.length > 0 ? videoId : null;
}

export function findVideoNote(app: App, index: VideoNoteIndexService, videoId: string, legacyPaths: readonly string[]): TFile | null {
	const noteById = index.get(videoId);
	if (noteById) return noteById;

	for (const legacyPath of legacyPaths) {
		const noteAtLegacyPath = app.vault.getAbstractFileByPath(legacyPath);
		if (!(noteAtLegacyPath instanceof TFile)) continue;
		if (app.metadataCache.getFileCache(noteAtLegacyPath)?.frontmatter?.source_video_id) continue;

		const existingVideoId = getVideoNoteId(app, noteAtLegacyPath);
		if (existingVideoId !== null && existingVideoId !== videoId) {
			throw new Error(`The expected video note path belongs to another video: ${legacyPath}`);
		}
		return noteAtLegacyPath;
	}
	return null;
}

export async function ensureVideoNoteId(app: App, index: VideoNoteIndexService, file: TFile, videoId: string): Promise<void> {
	if (getVideoNoteId(app, file) !== videoId) {
		await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			const existingVideoId = frontmatter.video_id;
			if (existingVideoId !== undefined && existingVideoId !== videoId) {
				throw new Error(`Video note already belongs to another video: ${file.path}`);
			}
			frontmatter.video_id = videoId;
		});
	}
	index.record(file, videoId);
}

export async function updateVideoNoteLiked(
	app: App,
	file: TFile,
	videoId: string,
	liked: boolean | undefined,
	isCurrent: () => boolean,
): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		if (!isCurrent()) return;
		if (frontmatter.video_id !== videoId) {
			throw new Error(`Video note already belongs to another video: ${file.path}`);
		}
		// Undefined is used only to remove an unconfirmed value from a NEW template.
		if (liked === undefined) delete frontmatter.liked;
		else frontmatter.liked = liked;
	});
}
