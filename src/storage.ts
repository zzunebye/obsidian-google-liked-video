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
}

export const localStorageService = new LocalStorageService();

/// SETTERS
export const setAccessToken = (googleAccessToken: string): void => {
    window.localStorage.setItem("googleYtbLikedVideoAccessToken", googleAccessToken);
};

export const setRefreshToken = (googleRefreshToken: string): void => {
    if (googleRefreshToken == "undefined") return;
    window.localStorage.setItem("googleYtbLikedVideoRefreshToken", googleRefreshToken);
};

export const setAccessTokenExpirationTime = (googleExpirationTime: number): void => {
    if (isNaN(googleExpirationTime)) return;

    window.localStorage.setItem("googleYtbLikedVideoExpirationTime", googleExpirationTime.toString());
};

export const setLikedVideos = (likedVideos: YouTubeVideo[]): void => {
    window.localStorage.setItem("googleYtbLikedVideoLikedVideos", JSON.stringify(likedVideos));
};



