import { Notice } from 'obsidian';
import type { TFile } from 'obsidian';
import { debugLogger } from 'src/debug';
import type GoogleLikedVideoPlugin from 'src/main';
import type { YouTubeVideo } from 'src/types';
import { chooseSummaryNoteAction } from 'src/ui/SummaryNoteModal';
import { editNoteContent, readNoteContent } from 'src/utils/noteEditingUtils';
import { getExpectedNotePath, getVideoUrl, sanitizeFileName } from 'src/utils/noteUtils';
import { createSummaryNoteBlock, getSummaryNoteEdit, getSummaryNoteRegion } from 'src/utils/summaryNoteUtils';

const pendingSaves = new WeakMap<GoogleLikedVideoPlugin, Map<string, Promise<void>>>();

async function createSummaryCopy(plugin: GoogleLikedVideoPlugin, video: YouTubeVideo, block: string): Promise<TFile> {
	const folder = plugin.settings.videoNotePath.trim();
	const title = `${sanitizeFileName(video.snippet.title)} AI Summary`;
	const basePath = await getExpectedNotePath(plugin.app, title, folder,
		folder.length > 0 && plugin.settings.organizeByChannel, video.snippet.channelTitle);
	let path = basePath;
	let suffix = 2;
	while (plugin.app.vault.getAbstractFileByPath(path)) {
		path = `${basePath.slice(0, -3)} ${suffix++}.md`;
	}
	// Copies must never participate in canonical video_id lookups.
	const content = `---\nsource_video_id: ${JSON.stringify(video.id)}\nai_summary: true\ntitle: ${JSON.stringify(video.snippet.title)}\nurl: ${JSON.stringify(getVideoUrl(video.id))}\n---\n\n${block}\n`;
	return plugin.app.vault.create(path, content);
}

async function save(plugin: GoogleLikedVideoPlugin, video: YouTubeVideo, summary: string): Promise<void> {
	const block = createSummaryNoteBlock(summary);
	const { file } = await plugin.videoNotes.getOrCreate(video);
	const region = getSummaryNoteRegion(await readNoteContent(plugin.app, file));
	if (region.kind !== 'empty') {
		const choice = await chooseSummaryNoteAction(plugin.app, file.path, region.kind === 'marked');
		if (choice === 'cancel') return;
		if (choice === 'new') {
			const copy = await createSummaryCopy(plugin, video, block);
			new Notice('Summary saved as a new note');
			await plugin.app.workspace.getLeaf('tab').openFile(copy);
			return;
		}
	}

	const edited = await editNoteContent(plugin.app, file, content => getSummaryNoteEdit(content, block, region));
	if (!edited) {
		new Notice('The summary in this note changed while you were saving. Nothing was replaced. Click Add to Note to try again.');
		return;
	}
	try {
		await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			frontmatter.ai_summary = true;
		});
		new Notice(region.kind === 'marked' ? 'Summary replaced in video note' : 'Summary added to video note');
	} catch (error: unknown) {
		debugLogger.error('[AI Summary] Could not update note metadata', error);
		new Notice('The summary was saved, but its note metadata could not be updated. Save it again to retry.');
	}
	await plugin.app.workspace.openLinkText(file.path, '', true);
}

export async function saveSummaryToNote(plugin: GoogleLikedVideoPlugin, video: YouTubeVideo, summary: string): Promise<void> {
	let pending = pendingSaves.get(plugin);
	if (!pending) {
		pending = new Map();
		pendingSaves.set(plugin, pending);
	}
	const existing = pending.get(video.id);
	if (existing) return existing;
	const task = save(plugin, video, summary);
	pending.set(video.id, task);
	try { await task; }
	finally { pending.delete(video.id); }
}
