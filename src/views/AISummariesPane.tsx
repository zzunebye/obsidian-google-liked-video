import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import GoogleLikedVideoPlugin from "../main";
import { PluginContext } from "../store/pluginContext";
import { AISummariesView } from "./AISummariesView";

export const VIEW_TYPE_AI_SUMMARIES = "geulo-ai-summaries";

export class AISummariesPane extends ItemView {
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: GoogleLikedVideoPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_AI_SUMMARIES;
	}

	getDisplayText(): string {
		return "AI summaries";
	}

	getIcon(): string {
		return "bot";
	}

	async onOpen(): Promise<void> {
		this.contentEl.tabIndex = -1;
		this.root = createRoot(this.contentEl);
		this.root.render(
			<StrictMode>
				<PluginContext.Provider value={this.plugin}>
					<AISummariesView />
				</PluginContext.Provider>
			</StrictMode>,
		);
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	focusList(): void {
		const target = this.contentEl.querySelector<HTMLElement>(".ai-summary-list-item") ?? this.contentEl;
		target.focus({ preventScroll: true });
	}
}
