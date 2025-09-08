import { Notice } from "obsidian";
import { getGoogleAccessTokenFromLocal, getValidAccessToken } from "./auth";
import { ObsidianGoogleLikedVideoSettings, YouTubeVideo, YouTubeVideosResponse, YouTubeCategory, YoutubeCategoriesResponse } from "./types";
import { debugLogger } from "./debug";

const BASE_URL = 'https://youtube.googleapis.com/youtube/v3/';

export class LikedVideoApi {
    constructor(private pluginSettings: ObsidianGoogleLikedVideoSettings) {
        this.pluginSettings = pluginSettings;
    }


    // Wrapper function for sending request to the YouTube Data API
    // 1. It will get the access token from the plugin settings
    // 2. If the access token is expired, it will refresh the access token with the refresh token
    // 3. It will add the access token to the request headers
    async sendRequest(method: 'GET' | 'POST', url: string, headers: Record<string, string>, options: RequestInit = {}): Promise<Response> {
        let accessToken = getGoogleAccessTokenFromLocal();
        debugLogger.api(`${method} request to: ${url}`);

        try {
            accessToken = await getValidAccessToken(
                this.pluginSettings.googleClientId,
                this.pluginSettings.googleClientSecret
            );
            const response = await fetch(url, {
                method: method,
                headers: {
                    ...headers,
                    'Authorization': `Bearer ${accessToken}`,
                },
                ...options
            });
            debugLogger.api(`Response status: ${response.status}`);
            return response;
        } catch (error) {
            debugLogger.error('API request failed:', error);
            new Notice("Failed to get access token: " + error.message);
            throw error;
        }
    }

    async fetchLikedVideos(limit = 50, pageToken?: string): Promise<YouTubeVideosResponse> {
        debugLogger.api(`Fetching liked videos - limit: ${limit}, pageToken: ${pageToken || 'none'}`);
        let url = BASE_URL + 'videos?'
            + 'part=snippet,contentDetails,statistics'
            + `&maxResults=${limit}`
            + '&myRating=like';

        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }
        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = await response.json();
        debugLogger.api(`Fetched ${data.items?.length || 0} videos`);
        debugLogger.verbose('API Response:', data);

        data.items.forEach(video => {
            video.pulled_at = new Date().toISOString();
        });

        return data;
    }

    async fetchPlaylists(): Promise<any> {
        const url = BASE_URL + 'playlists?'
            + 'part=snippet,contentDetails'
            + '&maxResults=5'
            + '&mine=true';

        const response = await this.sendRequest('GET', url, {});
        const data = await response.json();
        return data;
    }

    async fetchNewLikedVideos(lastFetchTime: Date): Promise<YouTubeVideo[]> {
        let allNewVideos: YouTubeVideo[] = [];
        let pageToken: string | undefined;

        do {
            const response = await this.fetchLikedVideos(50, pageToken);
            const newVideos = response.items.filter(video =>
                new Date(video.snippet.publishedAt) > lastFetchTime
            );

            allNewVideos = [...allNewVideos, ...newVideos];
            pageToken = response.nextPageToken;

            if (newVideos.length === 0) {
                break; // Stop if we've reached videos older than the last fetch time
            }
        } while (pageToken);

        return allNewVideos;
    }

    async fetchTotalLikedVideoCount(): Promise<number> {
        const url = BASE_URL + 'videos?'
            + 'part=snippet,statistics'
            + '&maxResults=1'
            + '&myRating=like';
        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = await response.json();
        return data.pageInfo.totalResults;
    }

    async unlikeVideo(videoId: string): Promise<void> {
        const url = BASE_URL + 'videos/rate?id=' + videoId + '&rating=none';
        await this.sendRequest('POST', url, {
            'Content-Type': 'application/json'
        });
    }

    /**
     * Fetch video categories from YouTube API
     * Returns categories for US region by default
     */
    async fetchVideoCategories(): Promise<YouTubeCategory[]> {
        try {
            debugLogger.api('Fetching video categories for US region');

            const url = BASE_URL + 'videoCategories?part=snippet&regionCode=US';
            const response = await this.sendRequest('GET', url, {});
            const data: YoutubeCategoriesResponse = await response.json();

            debugLogger.api(`Fetched ${data.items?.length || 0} video categories`);
            debugLogger.verbose('Categories API Response:', data);

            if (!data.items || data.items.length === 0) {
                debugLogger.warn('No categories returned from API');
                return [];
            }

            // Transform API response to our category format
            const categories: YouTubeCategory[] = data.items.map(item => ({
                id: item.id,
                title: item.snippet.title
            }));

            return categories;
        } catch (error) {
            debugLogger.error('Failed to fetch video categories:', error);
            throw error;
        }
    }
}

/// wrap a request to handle error and refresh access token if needed
// export async function sendRequest(url: string, headers: Record<string, string>, pluginSettings: ObsidianGoogleLikedVideoSettings): Promise<Response> {
//     let accessToken = getGoogleAccessToken();
//     if (!accessToken) {
//         accessToken = await refreshAccessToken(pluginSettings.googleClientId, pluginSettings.googleClientSecret);
//     }

//     return await fetch(url, {
//         headers: {
//             ...headers,
//             'Authorization': `Bearer ${accessToken}`,
//         }
//     });
// }



