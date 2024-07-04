import { ItemView, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { LikedVideoView } from "./LivedVideoView";
import { YouTubeVideo } from "src/types";

interface ILikedVideoListViewPersistedState {
    videos: YouTubeVideo[];
}

export const VIEW_TYPE_LIKED_VIDEO_LIST = "liked-video-list";

export class LikedVideoListView extends ItemView {
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

    getViewType(): string {
        return VIEW_TYPE_LIKED_VIDEO_LIST;
    }

    getDisplayText(): string {
        return "Liked Videos";
    }

    async onOpen() {
        console.log("onOpen!!");

        const likedVideos = localStorageService.getLikedVideos();


        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <StrictMode>
                <LikedVideoView videos={likedVideos} />
            </StrictMode>
        );

        const container = this.containerEl.children[1];
        container.empty();
        container.createEl("h1", { text: "Liked Videos" });
    }
    async onClose() {
        // Nothing to clean up.
    }
}