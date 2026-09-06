import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import GoogleLikedVideoPlugin from "../main";
import { PluginContext } from "../store/pluginContext";
import { SubscriptionView, SubscriptionViewState } from "./SubscriptionView";

export const VIEW_TYPE_SUBSCRIPTIONS = "subscriptions";

const DEFAULT_VIEW_STATE: SubscriptionViewState = {
	searchTerm: "",
	channelId: "all",
	period: "all",
	contentTypes: ["videos", "shorts", "music"],
	sortOrder: "DESC",
	filtersExpanded: false,
	dismissedFailureUpdatedAt: null,
};

export class SubscriptionPane extends ItemView {
	private root: Root | null = null;
	private refreshVersion = 0;
	private viewState: SubscriptionViewState = { ...DEFAULT_VIEW_STATE };

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: GoogleLikedVideoPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_SUBSCRIPTIONS;
	}

	getDisplayText(): string {
		return "Subscriptions";
	}

	getIcon(): string {
		return "rss";
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem((item: MenuItem) => {
			item.setTitle("Refresh subscriptions");
			item.setIcon("refresh-cw");
			item.onClick(() => this.requestRefresh());
		});
	}

	async onOpen(): Promise<void> {
		this.root = createRoot(this.containerEl.children[1]);
		this.renderView();
	}

	async onClose(): Promise<void> {
		this.root?.unmount();
		this.root = null;
	}

	async setState(state: Partial<SubscriptionViewState>, result: ViewStateResult): Promise<void> {
		this.viewState = { ...DEFAULT_VIEW_STATE, ...state };
		this.renderView();
		return super.setState(state, result);
	}

	getState(): Record<string, unknown> {
		return { ...this.viewState };
	}

	private requestRefresh(): void {
		this.refreshVersion += 1;
		this.renderView();
	}

	private renderView(): void {
		if (!this.root) return;
		this.root.render(
			<StrictMode>
				<PluginContext.Provider value={this.plugin}>
					<SubscriptionView
						initialState={this.viewState}
						refreshVersion={this.refreshVersion}
						onRequestRefresh={() => this.requestRefresh()}
						onStateChange={(state) => {
							this.viewState = state;
						}}
					/>
				</PluginContext.Provider>
			</StrictMode>,
		);
	}
}
