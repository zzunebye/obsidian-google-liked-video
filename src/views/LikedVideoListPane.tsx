import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { YouTubeVideo } from "src/types";
import GoogleLikedVideoPlugin from "../main";
import { VideosProvider } from "../store/videoContext";
import { PluginContext } from "../store/pluginContext";
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
        return "tv-minimal-play";
    }

    async onOpen() {
        this.videos = localStorageService.getLikedVideos();
        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <StrictMode>
                <PluginContext.Provider value={this.plugin}>
                    <VideosProvider videos={this.videos} />
                </PluginContext.Provider>
            </StrictMode>
        );
    }

    async onClose() {
        this.root?.unmount();
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
            videos: this.videos,
        };
    }
}
