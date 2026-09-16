import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { YouTubeVideo } from "src/types";
import GoogleLikedVideoPlugin from "../main";
import { VideosProvider } from "../store/videoContext";
import { PluginContext } from "../store/pluginContext";
import { TranscriptWorkspace } from "src/ui/TranscriptWorkspace";
interface ILikedVideoListViewPersistedState {
    videos: YouTubeVideo[];
}

export const VIEW_TYPE_LIKED_VIDEO_LIST = "liked-video-list";

export class LikedVideoListPane
    extends ItemView
    implements ILikedVideoListViewPersistedState {
    root: Root | null = null;

    /// Persisted State
    videos: YouTubeVideo[] = [];
    plugin: GoogleLikedVideoPlugin | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: GoogleLikedVideoPlugin) {
        super(leaf);

        // Initialize the state
        this.videos = localStorageService.getLikedVideos();
        this.plugin = plugin;
    }

    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source);
        menu.addItem((item: MenuItem) => {
            item.setTitle("Refresh");
            item.setIcon("sync");
            item.onClick(() => {
                void this.onClose();
                void this.onOpen();
            });
        });
    }

    getViewType(): string {
        return VIEW_TYPE_LIKED_VIDEO_LIST;
    }

    getDisplayText(): string {
        return "Liked videos";
    }

    getIcon(): string {
        return "thumbs-up";
    }

    async onOpen() {
        this.contentEl.tabIndex = -1;
        this.videos = localStorageService.getLikedVideos();
        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <StrictMode>
                <PluginContext.Provider value={this.plugin}>
                    <TranscriptWorkspace label="liked videos"><VideosProvider videos={this.videos} /></TranscriptWorkspace>
                </PluginContext.Provider>
            </StrictMode>
        );
    }

    async onClose() {
        this.root?.unmount();
    }

    focusList(): void {
        const target = this.contentEl.querySelector<HTMLElement>(".geulo-transcript-workspace__list:not([inert])")
            ?? this.contentEl.querySelector<HTMLElement>(".geulo-transcript-reader")
            ?? this.contentEl;
        target.focus({ preventScroll: true });
    }

    async setState(
        state: ILikedVideoListViewPersistedState,
        result: ViewStateResult,
    ): Promise<void> {
        if (state.videos) {
            this.videos = state.videos;
        }

        return super.setState(state, result);
    }

    getState(): Record<string, unknown> {
        return {
			videos: localStorageService.getLikedVideos(),
        };
    }
}
