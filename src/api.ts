import { getGoogleAccessToken, refreshAccessToken } from "./auth";
import { ObsidianGoogleLikedVideoSettings, YouTubeVideo, YouTubeVideosResponse } from "./types";

export class LikedVideoApi {
    constructor(private pluginSettings: ObsidianGoogleLikedVideoSettings) {
        this.pluginSettings = pluginSettings;
    }

    async sendRequest(method: 'GET' | 'POST', url: string, headers: Record<string, string>, options: RequestInit = {}): Promise<Response> {
        let accessToken = getGoogleAccessToken();
        if (!accessToken) {
            accessToken = await refreshAccessToken(this.pluginSettings.googleClientId, this.pluginSettings.googleClientSecret);
        }

        return await fetch(url, {
            method: method,
            headers: {
                ...headers,
                'Authorization': `Bearer ${accessToken}`,
            },
            ...options
        });
    }

    async fetchLikedVideos(limit = 50, pageToken?: string): Promise<YouTubeVideosResponse> {
        let url = 'https://youtube.googleapis.com/youtube/v3/videos?'
            + 'part=snippet,contentDetails,statistics'
            + `&maxResults=${limit}`
            + '&myRating=like';

        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }
        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = await response.json();

        data.items.forEach(video => {
            video.pulled_at = new Date().toISOString();
        });

        return data;
    }

    async fetchPlaylists(): Promise<any> {
        const url = 'https://youtube.googleapis.com/youtube/v3/playlists?'
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
        const url = 'https://youtube.googleapis.com/youtube/v3/videos?'
            + 'part=snippet,statistics'
            + '&maxResults=1'
            + '&myRating=like';
        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = await response.json();
        return data.pageInfo.totalResults;
    }

    async unlikeVideo(videoId: string): Promise<void> {
        const url = `https://youtube.googleapis.com/youtube/v3/videos/rate?id=${videoId}&rating=none`;
        await this.sendRequest('POST', url, {
            'Content-Type': 'application/json'
        });
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



