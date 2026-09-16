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
				if (file instanceof TFile) { this.updateFile(file, false); this.notify(); }
			}),
			app.vault.on("delete", (file) => {
				if (file instanceof TFile) { this.removePath(file.path, false); this.notify(); }
			}),
			app.vault.on("rename", (file, oldPath) => {
				const previousId = this.videoIdByPath.get(oldPath);
				this.removePath(oldPath, false);
				if (file instanceof TFile) {
					const videoId = this.app.metadataCache.getFileCache(file)
						? getVideoNoteId(this.app, file) : previousId ?? null;
					this.updateMapping(file.path, videoId);
					this.notify();
				}
			}),
		];
		this.metadataEventRef = app.metadataCache.on("changed", (file) => this.updateFile(file));
	}

	has(videoId: string): boolean {
		return (this.pathsByVideoId.get(videoId)?.size ?? 0) > 0;
	}

	get(videoId: string): TFile | null {
		const paths = this.pathsByVideoId.get(videoId);
		if (!paths) return null;
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) return file;
			this.removePath(path);
		}
		return null;
	}

	getAll(videoId: string): TFile[] {
		const files: TFile[] = [];
		for (const path of this.pathsByVideoId.get(videoId) ?? []) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) files.push(file);
			else this.removePath(path);
		}
		return files;
	}

	getVideoIds(): string[] {
		return [...this.pathsByVideoId.keys()];
	}

	record(file: TFile, videoId: string): void {
		if (this.updateMapping(file.path, videoId)) this.notify();
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
		if (!this.app.metadataCache.getFileCache(file)) return;
		if (this.updateMapping(file.path, getVideoNoteId(this.app, file)) && notify) this.notify();
	}

	private updateMapping(path: string, videoId: string | null): boolean {
		if ((this.videoIdByPath.get(path) ?? null) === videoId) return false;
		this.removePath(path, false);
		if (videoId !== null) {
			const paths = this.pathsByVideoId.get(videoId) ?? new Set<string>();
			paths.add(path);
			this.pathsByVideoId.set(videoId, paths);
			this.videoIdByPath.set(path, videoId);
		}
		return true;
	}

	private removePath(path: string, notify = true): void {
		const videoId = this.videoIdByPath.get(path);
		if (videoId !== undefined) {
			const paths = this.pathsByVideoId.get(videoId);
			paths?.delete(path);
			if (paths?.size === 0) this.pathsByVideoId.delete(videoId);
			this.videoIdByPath.delete(path);
		}
		if (videoId !== undefined && notify) this.notify();
	}

	private notify(): void {
		this.listeners.forEach((listener) => listener());
	}
}
