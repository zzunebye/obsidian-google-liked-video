import { ItemView } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type GoogleLikedVideoPlugin from "src/main";
import type { VideoTranscript } from "src/services/transcriptService";
import { PluginContext } from "src/store/pluginContext";
import type { YouTubeVideo } from "src/types";
import { VideoTranscriptReader } from "src/ui/VideoTranscriptReader";

export const VIEW_TYPE_TRANSCRIPT = "geulo-transcript";

export class TranscriptPane extends ItemView {
	private root: Root | null = null;
	private video?: YouTubeVideo;
	private transcript?: VideoTranscript;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GoogleLikedVideoPlugin) { super(leaf); }
	getViewType(): string { return VIEW_TYPE_TRANSCRIPT; }
	getDisplayText(): string { return this.video ? `Transcript: ${this.video.snippet.title}` : "Transcript"; }
	getIcon(): string { return "captions"; }
	async onOpen(): Promise<void> {
		this.contentEl.addClass("geulo-transcript-host");
		this.root = createRoot(this.contentEl);
		this.render();
	}
	async onClose(): Promise<void> { this.root?.unmount(); this.root = null; }
	async setState(state: { video?: YouTubeVideo; transcript?: VideoTranscript }, result: ViewStateResult): Promise<void> {
		if (state.video?.id && state.video.snippet?.title) {
			if (this.video?.id !== state.video.id) this.transcript = undefined;
			this.video = state.video;
			if (state.transcript?.videoId === state.video.id) this.transcript = state.transcript;
		}
		this.render();
		await super.setState(state, result);
	}
	getState(): Record<string, unknown> { return { video: this.video }; }
	private render(): void {
		this.root?.render(<StrictMode><PluginContext.Provider value={this.plugin}>
			{this.video ? <VideoTranscriptReader key={this.video.id} video={this.video} initialTranscript={this.transcript} /> : <p>Select a video's transcript from Geulo.</p>}
		</PluginContext.Provider></StrictMode>);
	}
}
