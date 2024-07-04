import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { LikedVideoView } from "./LivedVideoView";
import { YouTubeVideo } from "src/types";
import GoogleLikedVideoPlugin from "../main";
import * as React from "react";

interface ILikedVideoListViewPersistedState {
    videos: YouTubeVideo[];
}

export const VIEW_TYPE_LIKED_VIDEO_LIST = "liked-video-list";

export const VideosContext = React.createContext<YouTubeVideo[]>([]);

export const useVideos = (): YouTubeVideo[] => {
    return React.useContext(VideosContext);
};

export class LikedVideoListView extends ItemView implements ILikedVideoListViewPersistedState {
    root: Root | null = null;

    /// Persisted State
    videos: YouTubeVideo[] = [];

    constructor(
        leaf: WorkspaceLeaf,
        plugin: GoogleLikedVideoPlugin,
    ) {
        super(leaf);

        // Initialize the state
        this.videos = localStorageService.getLikedVideos();
    }

    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source)
        menu.addItem((item: MenuItem) => {
            item.setTitle("Refresh");
            item.setIcon("sync");
            item.onClick(() => {
                this.onClose();
                this.onOpen();
            });
        })
    }


    getViewType(): string {
        return VIEW_TYPE_LIKED_VIDEO_LIST;
    }

    getDisplayText(): string {
        return "Liked Videos";
    }

    getIcon(): string {
        return "folder-kanban";
    }

    async onOpen() {
        console.log("onOpen!!!");

        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <VideosContext.Provider value={this.videos}>
                <StrictMode>
                    <LikedVideoView />
                </StrictMode>
            </VideosContext.Provider >
        );

        const container = this.containerEl.children[1];
        container.empty();
        container.createEl("h1", { text: "Liked Videos" });
    }

    async onClose() {
        this.root?.unmount();
    }

    async setState(state: ILikedVideoListViewPersistedState, result: ViewStateResult): Promise<void> {
        if (state.videos) {
            this.videos = state.videos;
        }

        return super.setState(state, result);
    }

    getState(): ILikedVideoListViewPersistedState {
        return {
            videos: this.videos,
        };
    }
}