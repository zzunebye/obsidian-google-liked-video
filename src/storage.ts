import { YouTubeVideo, ContentTypeSelection, ContentTypeOption } from "./types";
import { PlaylistInfo } from "./api";

export interface SavedPlaylist extends PlaylistInfo {
    savedAt: string; // ISO string
    isUserSaved: boolean; // true for manually saved playlists
}

class LocalStorageService {
    /**
     * Retrieves liked videos from local storage.
     * @returns {YouTubeVideo[]} An array of liked videos.
     */
    getLikedVideos(): YouTubeVideo[] {
        const likedVideos = window.localStorage.getItem("googleYtbLikedVideoLikedVideos");
        return likedVideos ? JSON.parse(likedVideos) : [];
    }

    getWatchLaterVideos(): YouTubeVideo[] {
        const watchLaterVideos = window.localStorage.getItem("googleYtbLikedVideoWatchLaterVideos");
        return watchLaterVideos ? JSON.parse(watchLaterVideos) : [];
    }

    getLastLikedVideoId(): string {
        const likedVideos = this.getLikedVideos();
        if (likedVideos.length === 0) {
            throw new Error('No liked videos found');
        }
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

    getAINoteFilter(): boolean {
        return window.localStorage.getItem("likedVideoViewAINoteFilter") === "true";
    }

    getContentTypeSelection(): ContentTypeSelection {
        const stored = window.localStorage.getItem("likedVideoViewContentTypeSelection");
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    const validOptions: ContentTypeOption[] = ['videos', 'shorts', 'music'];
                    return parsed.filter((item: string) => validOptions.includes(item as ContentTypeOption)) as ContentTypeSelection;
                }
            } catch {
                // Invalid JSON, return default
            }
        }
        return []; // Empty = show all
    }

    getPlaylistsSortOption(): string {
        return window.localStorage.getItem("userPlaylistsSortOption") ?? "title";
    }

    getPlaylistsSortOrder(): string {
        return window.localStorage.getItem("userPlaylistsSortOrder") ?? "ASC";
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

    setAINoteFilter(enabled: boolean): void {
        window.localStorage.setItem("likedVideoViewAINoteFilter", String(enabled));
    }

    setContentTypeSelection(selection: ContentTypeSelection): void {
        window.localStorage.setItem("likedVideoViewContentTypeSelection", JSON.stringify(selection));
    }

    setPlaylistsSortOption(sortOption: string): void {
        window.localStorage.setItem("userPlaylistsSortOption", sortOption);
    }

    setPlaylistsSortOrder(sortOrder: string): void {
        window.localStorage.setItem("userPlaylistsSortOrder", sortOrder);
    }

    // Pinned playlists management
    getPinnedPlaylistIds(): string[] {
        const pinnedIds = window.localStorage.getItem("pinnedPlaylistIds");
        return pinnedIds ? JSON.parse(pinnedIds) : [];
    }

    setPinnedPlaylistIds(playlistIds: string[]): void {
        window.localStorage.setItem("pinnedPlaylistIds", JSON.stringify(playlistIds));
    }

    pinPlaylist(playlistId: string): void {
        const pinnedIds = this.getPinnedPlaylistIds();
        if (!pinnedIds.includes(playlistId)) {
            pinnedIds.push(playlistId);
            this.setPinnedPlaylistIds(pinnedIds);
        }
    }

    unpinPlaylist(playlistId: string): void {
        const pinnedIds = this.getPinnedPlaylistIds();
        const updatedIds = pinnedIds.filter(id => id !== playlistId);
        this.setPinnedPlaylistIds(updatedIds);
    }

    isPlaylistPinned(playlistId: string): boolean {
        const pinnedIds = this.getPinnedPlaylistIds();
        return pinnedIds.includes(playlistId);
    }

    setLikedVideos = (likedVideos: YouTubeVideo[]): void => {
        window.localStorage.setItem("googleYtbLikedVideoLikedVideos", JSON.stringify(likedVideos));
    };

    setWatchLaterVideos = (watchLaterVideos: YouTubeVideo[]): void => {
        window.localStorage.setItem("googleYtbLikedVideoWatchLaterVideos", JSON.stringify(watchLaterVideos));
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

    // Saved playlists management
    getSavedPlaylists(): SavedPlaylist[] {
        const savedPlaylists = window.localStorage.getItem("googleYtbSavedPlaylists");
        return savedPlaylists ? JSON.parse(savedPlaylists) : [];
    }

    setSavedPlaylists(playlists: SavedPlaylist[]): void {
        window.localStorage.setItem("googleYtbSavedPlaylists", JSON.stringify(playlists));
    }

    addSavedPlaylist(playlistInfo: PlaylistInfo): boolean {
        const savedPlaylists = this.getSavedPlaylists();

        // Check if playlist already exists
        if (savedPlaylists.some(p => p.id === playlistInfo.id)) {
            return false; // Already exists
        }

        const savedPlaylist: SavedPlaylist = {
            ...playlistInfo,
            savedAt: new Date().toISOString(),
            isUserSaved: true
        };

        savedPlaylists.push(savedPlaylist);
        this.setSavedPlaylists(savedPlaylists);
        return true; // Successfully added
    }

    removeSavedPlaylist(playlistId: string): boolean {
        const savedPlaylists = this.getSavedPlaylists();
        const initialLength = savedPlaylists.length;

        const updatedPlaylists = savedPlaylists.filter(p => p.id !== playlistId);
        this.setSavedPlaylists(updatedPlaylists);

        return updatedPlaylists.length < initialLength; // True if something was removed
    }

    isPlaylistSaved(playlistId: string): boolean {
        const savedPlaylists = this.getSavedPlaylists();
        return savedPlaylists.some(p => p.id === playlistId);
    }

    updateSavedPlaylist(playlistInfo: PlaylistInfo): void {
        const savedPlaylists = this.getSavedPlaylists();
        const index = savedPlaylists.findIndex(p => p.id === playlistInfo.id);

        if (index !== -1) {
            // Keep the original savedAt and isUserSaved values
            savedPlaylists[index] = {
                ...playlistInfo,
                savedAt: savedPlaylists[index].savedAt,
                isUserSaved: savedPlaylists[index].isUserSaved
            };
            this.setSavedPlaylists(savedPlaylists);
        }
    }

}

export const localStorageService = new LocalStorageService();


