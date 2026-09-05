import { TFile } from 'obsidian';
import type { App } from 'obsidian';

export function getVideoNoteId(app: App, file: TFile): string | null {
	const videoId: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.video_id;
	return typeof videoId === 'string' && videoId.length > 0 ? videoId : null;
}

export function indexVideoNotesById(app: App): Map<string, TFile> {
	const notes = new Map<string, TFile>();
	for (const file of app.vault.getMarkdownFiles()) {
		const videoId = getVideoNoteId(app, file);
		if (videoId !== null && !notes.has(videoId)) notes.set(videoId, file);
	}
	return notes;
}

export function findVideoNote(app: App, videoId: string, legacyPaths: readonly string[]): TFile | null {
	const noteById = indexVideoNotesById(app).get(videoId);
	if (noteById) return noteById;

	for (const legacyPath of legacyPaths) {
		const noteAtLegacyPath = app.vault.getAbstractFileByPath(legacyPath);
		if (!(noteAtLegacyPath instanceof TFile)) continue;

		const existingVideoId = getVideoNoteId(app, noteAtLegacyPath);
		if (existingVideoId !== null && existingVideoId !== videoId) {
			throw new Error(`The expected video note path belongs to another video: ${legacyPath}`);
		}
		return noteAtLegacyPath;
	}
	return null;
}

export async function ensureVideoNoteId(app: App, file: TFile, videoId: string): Promise<void> {
	if (getVideoNoteId(app, file) === videoId) return;
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		const existingVideoId = frontmatter.video_id;
		if (existingVideoId !== undefined && existingVideoId !== videoId) {
			throw new Error(`Video note already belongs to another video: ${file.path}`);
		}
		frontmatter.video_id = videoId;
	});
}
