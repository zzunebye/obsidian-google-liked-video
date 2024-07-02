import { getGoogleAccessToken, refreshAccessToken } from "./auth";
import { YouTubeVideo, YouTubeVideosResponse } from "./types";

/// wrap a request to handle error and refresh access token if needed
export async function sendRequest(url: string, headers: Record<string, string>): Promise<Response> {
    let accessToken = getGoogleAccessToken();
    if (!accessToken) {
        accessToken = await refreshAccessToken();
    }

    return await fetch(url, {
        headers: {
            ...headers,
            'Authorization': `Bearer ${accessToken}`,
        }
    });
}

export async function fetchLikedVideos(limit = 50, pageToken?: string): Promise<YouTubeVideosResponse> {
    let url = 'https://youtube.googleapis.com/youtube/v3/videos?'
        + 'part=snippet,contentDetails,statistics'
        + `&maxResults=${limit}`
        + '&myRating=like';

    if (pageToken) {
        url += `&pageToken=${pageToken}`;
    }
    const response = await sendRequest(url, {});
    const data: YouTubeVideosResponse = await response.json();
    return data;
}

export async function fetchTotalLikedVideoCount(): Promise<number> {
    const url = 'https://youtube.googleapis.com/youtube/v3/videos?'
        + 'part=snippet,statistics'
        + '&maxResults=1'
        + '&myRating=like';
    const response = await sendRequest(url, {});
    const data: YouTubeVideosResponse = await response.json();
    return data.pageInfo.totalResults;
}

export async function fetchPlaylists(): Promise<any> {
    const url = 'https://youtube.googleapis.com/youtube/v3/playlists?'
        + 'part=snippet,contentDetails'
        + '&maxResults=5'
        + '&mine=true';

    const response = await sendRequest(url, {});
    const data = await response.json();
    return data;
}