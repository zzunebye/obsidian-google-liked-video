import { YouTubeVideo } from "./types";

class LocalStorageService {
    /**
     * Retrieves liked videos from local storage.
     * @returns {YouTubeVideo[]} An array of liked videos.
     */
    getLikedVideos(): YouTubeVideo[] {
        const likedVideos = window.localStorage.getItem("googleYtbLikedVideoLikedVideos");
        return likedVideos ? JSON.parse(likedVideos) : [];
    }

    getLastLikedVideoId(): string {
        const likedVideos = this.getLikedVideos();
        return likedVideos[0].id;
    }

    getRefreshToken(): string {
        return window.localStorage.getItem("googleYtbLikedVideoRefreshToken") ?? "";
    }

    getAccessToken(): string {
        return window.localStorage.getItem("googleYtbLikedVideoAccessToken") ?? "";
    }

    getAccessTokenExpirationTime(): number {
        const expirationTime = window.localStorage.getItem("googleYtbLikedVideoExpirationTime");
        return expirationTime ? parseInt(expirationTime) : 0;
    }

    getSortOption(): string {
        return window.localStorage.getItem("likedVideoViewSortOption") ?? "addedDate";
    }

    getSortOrder(): string {
        return window.localStorage.getItem("likedVideoViewSortOrder") ?? "DESC";
    }

    getSelectedCategory(): string {
        return window.localStorage.getItem("likedVideoViewSelectedCategory") ?? "all";
    }

    /// SET
    setSortOption(sortOption: string): void {
        window.localStorage.setItem("likedVideoViewSortOption", sortOption);
    }

    setSortOrder(sortOrder: string): void {
        window.localStorage.setItem("likedVideoViewSortOrder", sortOrder);
    }

    setSelectedCategory(categoryId: string): void {
        window.localStorage.setItem("likedVideoViewSelectedCategory", categoryId);
    }

    setLikedVideos = (likedVideos: YouTubeVideo[]): void => {
        window.localStorage.setItem("googleYtbLikedVideoLikedVideos", JSON.stringify(likedVideos));
    };

    setAccessToken(googleAccessToken: string): void {
        window.localStorage.setItem("googleYtbLikedVideoAccessToken", googleAccessToken);
    }

    setRefreshToken(googleRefreshToken: string): void {
        if (googleRefreshToken == "undefined") return;
        window.localStorage.setItem("googleYtbLikedVideoRefreshToken", googleRefreshToken);
    }

    setAccessTokenExpirationTime(googleExpirationTime: number): void {
        if (isNaN(googleExpirationTime)) return;
        window.localStorage.setItem("googleYtbLikedVideoExpirationTime", googleExpirationTime.toString());
    }

}

export const localStorageService = new LocalStorageService();


