import { Platform } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import type { ObsidianGoogleLikedVideoSettings } from "src/types";

// WebViewer is a core plugin, not a public player API. Check its Electron capability
// at runtime and keep timestamp URL navigation working when it is unavailable.
interface PlayerWebview extends HTMLElement {
	getURL(): string;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

function videoIdFromUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname)) return null;
		return url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/shorts\/([\w-]{11})/)?.[1] ?? null;
	} catch { return null; }
}

export class TranscriptPlaybackService {
	constructor(private readonly app: App, private readonly settings: ObsidianGoogleLikedVideoSettings) {}

	private findPlayer(videoId: string): { leaf: WorkspaceLeaf; player?: PlayerWebview } | undefined {
		for (const leaf of this.app.workspace.getLeavesOfType("webviewer")) {
			const element = leaf.view.containerEl.querySelector("webview");
			const player = element as Partial<PlayerWebview> | null;
			try {
				if (typeof player?.getURL === "function") {
					if (videoIdFromUrl(player.getURL()) !== videoId) continue;
					if (typeof player.executeJavaScript === "function") return { leaf, player: player as PlayerWebview };
				} else if (videoIdFromUrl(leaf.view.getState().url) !== videoId) continue;
				return { leaf };
			} catch { /* The webview can be detached while the workspace is changing. */ }
		}
		return undefined;
	}

	private playerScript(videoId: string, seconds?: number): string {
		// Recheck origin and video identity inside the page, including after SPA navigation.
		return `(() => {
			if (!['https://www.youtube.com', 'https://youtube.com', 'https://m.youtube.com'].includes(location.origin)) return null;
			const id = location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') : location.pathname.split('/')[2];
			if (id !== ${JSON.stringify(videoId)} || document.querySelector('.ad-showing, .ad-interrupting')) return null;
			const video = document.querySelector('video.html5-main-video');
			if (!video || video.readyState === 0) return null;
			${seconds === undefined ? "" : `video.currentTime = ${seconds};`}
			return Number.isFinite(video.currentTime) ? video.currentTime : null;
		})()`;
	}

	async getPosition(videoId: string): Promise<number | null> {
		if (Platform.isMobile || !this.settings.openInObsidianWebViewer) return null;
		try {
			const player = this.findPlayer(videoId)?.player;
			if (!player) return null;
			const value = await player.executeJavaScript(this.playerScript(videoId));
			return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
		} catch { return null; }
	}

	async open(videoId: string, start?: number): Promise<void> {
		if (!/^[\w-]{11}$/.test(videoId)) throw new Error("Invalid YouTube video ID");
		const seconds = start === undefined ? undefined : Math.max(0, start);
		if (seconds !== undefined && !Number.isFinite(seconds)) throw new Error("Invalid video timestamp");
		const url = `https://www.youtube.com/watch?v=${videoId}${seconds === undefined ? "" : `&t=${Math.ceil(seconds)}s`}`;
		if (Platform.isMobile || !this.settings.openInObsidianWebViewer) {
			window.open(url, "_blank");
			return;
		}
		const existing = this.findPlayer(videoId);
		if (existing?.player && seconds !== undefined) {
			try {
				const result = await existing.player.executeJavaScript(this.playerScript(videoId, seconds), true);
				if (typeof result === "number") return;
			} catch { /* Navigation remains available without the optional player bridge. */ }
		}
		if (existing && seconds === undefined) {
			await this.app.workspace.revealLeaf(existing.leaf);
			return;
		}
		const leaf = existing?.leaf ?? this.app.workspace.getLeaf(this.settings.openWebViewerInSplitPane ? "split" : "tab");
		await leaf.setViewState({ type: "webviewer", state: { url, navigate: true }, active: true });
	}
}
