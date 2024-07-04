import { ItemView, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { LikedVideoView } from "./LivedVideoView";
import { YouTubeVideo } from "src/types";
import GoogleLikedVideoPlugin from "main";

interface ILikedVideoListViewPersistedState {
    videos: YouTubeVideo[];
}

export const VIEW_TYPE_LIKED_VIDEO_LIST = "liked-video-list";

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

    updateVideos(videos: YouTubeVideo[]) {
        this.videos = videos;
        // this.setState({ videos });
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

        const likedVideos = localStorageService.getLikedVideos();

        this.root = createRoot(this.containerEl.children[1]);
        this.root.render(
            <StrictMode>
                <LikedVideoView videos={this.videos} />
            </StrictMode>
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