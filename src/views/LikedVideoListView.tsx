import { ItemView, WorkspaceLeaf } from "obsidian";
import { localStorageService } from "src/storage";
import { YouTubeVideo } from "src/types";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { LikedVideoView } from "./ReactView";


export const VIEW_TYPE_LIKED_VIDEO_LIST = "liked-video-list";

export class LikedVideoListView extends ItemView {
    root: Root | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
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

        /// read liked videos from local storage
        const videosPerPage = 20;
        let currentPage = 1;

        // const renderPage = (page: number) => {
        //     container.empty();
        //     container.createEl("h1", { text: "Liked Videos" });

        //     const startIndex = (page - 1) * videosPerPage;
        //     const endIndex = startIndex + videosPerPage;
        //     const videosToShow = likedVideos.slice(startIndex, endIndex);

        //     videosToShow.forEach((video: YouTubeVideo) => {
        //         const videoContainer = container.createEl("div", { cls: "video-card" });
        //         videoContainer.setAttr("style", "border: 1px solid black;");

        //         const thumbnail = videoContainer.createEl("img", { cls: "video-thumbnail" });
        //         thumbnail.setAttr("src", video.snippet.thumbnails.default.url);
        //         thumbnail.setAttr("alt", video.snippet.title);

        //         const videoDetails = videoContainer.createEl("div", { cls: "video-details" });

        //         const title = videoDetails.createEl("h2", { cls: "video-title", text: video.snippet.title });
        //         // const description = videoDetails.createEl("p", { cls: "video-description", text: video.snippet.description });
        //         const channelTitle = videoDetails.createEl("span", { cls: "video-channel", text: `Channel: ${video.snippet.channelTitle}` });
        //         const publishDate = videoDetails.createEl("span", { cls: "video-date", text: `Published on: ${new Date(video.snippet.publishedAt).toLocaleDateString()}` });
        //     });

        //     const paginationContainer = container.createEl("div", { cls: "pagination-container" });
        //     const totalPages = Math.ceil(likedVideos.length / videosPerPage);

        //     const startPage = Math.max(1, page - 2);
        //     const endPage = Math.min(totalPages, page + 2);

        //     for (let i = startPage; i <= endPage; i++) {
        //         const pageButton = paginationContainer.createEl("button", { text: i.toString() });
        //         pageButton.addEventListener("click", () => {
        //             currentPage = i;
        //             renderPage(currentPage);
        //         });
        //     }
        // };

        // renderPage(currentPage);
    }
    async onClose() {
        // Nothing to clean up.
    }
}