export type LikedVideoPaginationMode = 'pagination' | 'infinite';

export const AI_PROVIDERS = ['gemini', 'openrouter'] as const;
export type AIProvider = typeof AI_PROVIDERS[number];

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
    gemini: 'Google Gemini',
    openrouter: 'OpenRouter (experimental)',
};

export function isAIProvider(value: string): value is AIProvider {
    return (AI_PROVIDERS as readonly string[]).includes(value);
}

export interface ObsidianGoogleLikedVideoSettings {
    googleClientId: string;
    dailyNotePath: string;
    videoNotePath: string;
    organizeByChannel: boolean;
    fetchLimit: number;
    fullFetchLimit: number;
    autoFetchEnabled: boolean;
    autoFetchInterval: number;
    fetchOnStartup: boolean;
    lastAutoFetchTime: number;
    lastSeenVersion: string;
	lastSeenAnnouncementId?: string;
    autoCreateNoteEnabled: boolean;
    linkToDailyNote: boolean;
    fullFetchOnEveryAutoFetch: boolean;
    enableTemplateSystem: boolean;
    customTemplate: string;
    openInObsidianWebViewer: boolean;
    openWebViewerInSplitPane: boolean;
    showVideoTags: boolean;
    enableAISummary: boolean;
    geminiApiKey: string;
    aiProvider: AIProvider;
    openRouterApiKey: string;
    openRouterModel: string;
    summaryPrompt: string;
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

export type PlaylistType = 'liked' | 'playlist';

export type ContentTypeOption = 'videos' | 'shorts' | 'music';
export type ContentTypeSelection = ContentTypeOption[];

export interface SummaryFileData {
    schemaVersion: 1;
    videoId: string;
    title: string;
    channelTitle: string;
    channelId: string;
    videoUrl: string;
    summary: string;
    oneLinerSummary?: string;
    generatedAt: string; // ISO string
    model: string;
}

// File format for persisting AI generated Video summaries
export interface SummaryStorageFile {
    schemaVersion: 1;
    summaries: Record<string, SummaryFileData>;
}

export interface VideoMetadata {
    title: string;
    channelTitle: string;
    channelId: string;
    videoUrl: string;
}

// Playlist source types for generic playlist handling
export type PlaylistSource =
    | { type: 'liked' }
    | { type: 'playlist', playlistId: string };

export interface PlaylistInfo {
    id: string;
    title: string;
    description: string;
    itemCount: number;
    thumbnailUrl?: string;
    publishedAt?: string; // Playlist creation date
    isOwnedByUser?: boolean;
}

// Type-safe YouTube API response interfaces
export interface YouTubePlaylistResponse {
    id: string;
    snippet: {
        title: string;
        description?: string;
        publishedAt: string;
        thumbnails?: {
            medium?: {
                url: string;
            };
        };
    };
    contentDetails: {
        itemCount: number;
    };
}

export interface PaginatedResult {
    videos: YouTubeVideo[];
    currentPage: number;
    hasNext: boolean;
    hasPrev: boolean;
    totalResults?: number;
    totalPages?: number;
}

export interface PlaylistCache {
    pages: Map<number, YouTubeVideo[]>;
    tokens: Map<number, string>;
    totalResults?: number;
    allVideos?: YouTubeVideo[];  // Cache all videos for the playlist
    lastFetched?: number;  // Timestamp of last fetch (required)
    ttl?: number; // Time to live in milliseconds
}

/// LLM Summary Cache Interface

export interface CachedLLMSummary {
    summary: string;
    generatedAt: string; // ISO string
    model: string;
}
