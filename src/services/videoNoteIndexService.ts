import { App, EventRef, TFile } from "obsidian";
import { getVideoNoteId } from "src/utils/videoNoteUtils";

export class VideoNoteIndexService {
	private readonly pathsByVideoId = new Map<string, Set<string>>();
	private readonly videoIdByPath = new Map<string, string>();
	private readonly listeners = new Set<() => void>();
	private readonly vaultEventRefs: EventRef[];
	private readonly metadataEventRef: EventRef;

	constructor(private readonly app: App) {
		for (const file of app.vault.getMarkdownFiles()) this.updateFile(file, false);
		this.vaultEventRefs = [
			app.vault.on("create", (file) => {
				if (file instanceof TFile) this.updateFile(file);
			}),
			app.vault.on("delete", (file) => this.removePath(file.path)),
			app.vault.on("rename", (file, oldPath) => {
				this.removePath(oldPath, false);
				if (file instanceof TFile) this.updateFile(file);
			}),
		];
		this.metadataEventRef = app.metadataCache.on("changed", (file) => this.updateFile(file));
	}

	has(videoId: string): boolean {
		return (this.pathsByVideoId.get(videoId)?.size ?? 0) > 0;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	destroy(): void {
		this.vaultEventRefs.forEach((eventRef) => this.app.vault.offref(eventRef));
		this.app.metadataCache.offref(this.metadataEventRef);
		this.listeners.clear();
		this.pathsByVideoId.clear();
		this.videoIdByPath.clear();
	}

	private updateFile(file: TFile, notify = true): void {
		this.removePath(file.path, false);
		const videoId = getVideoNoteId(this.app, file);
		if (videoId !== null) {
			const paths = this.pathsByVideoId.get(videoId) ?? new Set<string>();
			paths.add(file.path);
			this.pathsByVideoId.set(videoId, paths);
			this.videoIdByPath.set(file.path, videoId);
		}
		if (notify) this.notify();
	}

	private removePath(path: string, notify = true): void {
		const videoId = this.videoIdByPath.get(path);
		if (videoId !== undefined) {
			const paths = this.pathsByVideoId.get(videoId);
			paths?.delete(path);
			if (paths?.size === 0) this.pathsByVideoId.delete(videoId);
			this.videoIdByPath.delete(path);
		}
		if (notify) this.notify();
	}

	private notify(): void {
		this.listeners.forEach((listener) => listener());
	}
}
