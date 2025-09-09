export interface ObsidianGoogleLikedVideoSettings {
    accessToken: string;
    googleClientId: string;
    googleClientSecret: string;
    dailyNotePath: string;
    videoNotePath: string;
    fetchLimit: number;
    fullFetchLimit: number;
    autoFetchEnabled: boolean;
    autoFetchInterval: number;
    fetchOnStartup: boolean;
    lastAutoFetchTime: number;
}

export interface YouTubeVideo {
    kind: string;
    etag: string;
    id: string;
    pulled_at: string;
    snippet: {
        publishedAt: string;
        channelId: string;
        title: string;
        description: string;
        thumbnails: {
            default: {
                url: string;
                width: number;
                height: number;
            };
            medium: {
                url: string;
                width: number;
                height: number;
            };
            high: {
                url: string;
                width: number;
                height: number;
            };
            standard: {
                url: string;
                width: number;
                height: number;
            };
            maxres: {
                url: string;
                width: number;
                height: number;
            };
        };
        channelTitle: string;
        tags: string[];
        categoryId: string;
        liveBroadcastContent: string;
        localized: {
            title: string;
            description: string;
        };
        defaultAudioLanguage: string;
    };
    contentDetails: {
        duration: string;
        dimension: string;
        definition: string;
        caption: string;
        licensedContent: boolean;
        contentRating: Record<string, unknown>;
        projection: string;
    };
    statistics: {
        viewCount: number;
        likeCount: number;
        favoriteCount: string;
        commentCount: string;
    };
}

export interface YouTubeVideosResponse {
    kind: string;
    etag: string;
    items: YouTubeVideo[];
    nextPageToken: string;
    pageInfo: {
        totalResults: number;
        resultsPerPage: number;
    };
}

export interface YouTubeCategory {
    id: string;
    title: string;
}

export interface YoutubeCategoriesResponse {
    kind: string;
    etag: string;
    items: {
        kind: string;
        etag: string;
        id: string;
        snippet: {
            channelId: string;
            title: string;
        };
    }[];
}

export interface CategoriesCache {
    categories: { [key: string]: YouTubeCategory };
    lastFetched: number;
}