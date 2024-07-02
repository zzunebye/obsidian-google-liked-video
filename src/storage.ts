import { YouTubeVideo } from "./types";

/// GETTERS
export const getRefreshToken = (): string => {
    return window.localStorage.getItem("googleYtbLikedVideoRefreshToken") ?? "";
};

export const getAccessToken = (): string => {
    return window.localStorage.getItem("googleYtbLikedVideoAccessToken") ?? "";
};

export const getAccessTokenExpirationTime = (): number => {
    const expirationTime = window.localStorage.getItem("googleYtbLikedVideoExpirationTime");
    return expirationTime ? parseInt(expirationTime) : 0;
};

export const getLikedVideos = (): YouTubeVideo[] => {
    const likedVideos = window.localStorage.getItem("googleYtbLikedVideoLikedVideos");
    return likedVideos ? JSON.parse(likedVideos) : [];
};


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



