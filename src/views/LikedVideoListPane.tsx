import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { Root, createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { LikedVideoView } from "./LikedVideoView";
import { YouTubeVideo } from "src/types";
import GoogleLikedVideoPlugin from "../main";
import * as React from "react";

interface ILikedVideoListViewPersistedState {
    videos: YouTubeVideo[];
}

export const VIEW_TYPE_LIKED_VIDEO_LIST = "liked-video-list";

export const VideosContext = React.createContext<[YouTubeVideo[], React.Dispatch<React.SetStateAction<YouTubeVideo[]>>]>([[], () => { }]);
export const PluginContext = React.createContext<GoogleLikedVideoPlugin | null>(null);

export const useVideos = (): [YouTubeVideo[], React.Dispatch<React.SetStateAction<YouTubeVideo[]>>] => {
    return React.useContext(VideosContext);
};

export const usePlugin = (): GoogleLikedVideoPlugin | null => {
    return React.useContext(PluginContext);
};

const VideosProvider: React.FC<{ videos: YouTubeVideo[] }> = ({ videos }) => {
    const [videoList, setVideoList] = useState<YouTubeVideo[]>(videos);
    return (
        <VideosContext.Provider value={[videoList, setVideoList]}>
            <StrictMode>
                <LikedVideoView />
            </StrictMode>
        </VideosContext.Provider>
    );
};

export class LikedVideoListPane extends ItemView implements ILikedVideoListViewPersistedState {
    root: Root | null = null;

    /// Persisted State
    videos: YouTubeVideo[] = [];
    plugin: GoogleLikedVideoPlugin | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: GoogleLikedVideoPlugin,
    ) {
        super(leaf);

        // Initialize the state
        this.videos = localStorageService.getLikedVideos();
        this.plugin = plugin;
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
        return "youtube";
    }

    async onOpen() {
        this.videos = localStorageService.getLikedVideos();

        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <PluginContext.Provider value={this.plugin}>
                <VideosProvider videos={this.videos} />
            </PluginContext.Provider>
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