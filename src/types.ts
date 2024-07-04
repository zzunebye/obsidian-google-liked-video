export interface ObsidianGoogleLikedVideoSettings {
    mySetting: string;
    accessToken: string;
    googleClientId: string;
    googleClientSecret: string;
    dailyNotePath: string;
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
        likeCount: string;
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