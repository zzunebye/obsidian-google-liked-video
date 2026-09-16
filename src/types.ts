export type LikedVideoPaginationMode = 'pagination' | 'infinite';

export const TRANSCRIPT_LANGUAGE_OPTIONS: Record<string, string> = {
    auto: 'Follow Obsidian language',
    ko: 'Korean (한국어)',
    en: 'English',
    ja: 'Japanese (日本語)',
    'zh-Hans': 'Chinese, simplified (简体中文)',
    'zh-Hant': 'Chinese, traditional (繁體中文)',
    es: 'Spanish (Español)',
    fr: 'French (Français)',
    de: 'German (Deutsch)',
    pt: 'Portuguese (Português)',
    ru: 'Russian (Русский)',
    hi: 'Hindi (हिन्दी)',
    ar: 'Arabic (العربية)',
    id: 'Indonesian (Bahasa Indonesia)',
    th: 'Thai (ไทย)',
    vi: 'Vietnamese (Tiếng Việt)',
};

export const AI_PROVIDERS = ['openrouter', 'openai', 'gemini'] as const;
export type AIProvider = typeof AI_PROVIDERS[number];
export type SummarySource = 'transcript' | 'video';

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
    gemini: 'Google Gemini',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
};

export function isAIProvider(value: string): value is AIProvider {
    return (AI_PROVIDERS as readonly string[]).includes(value);
}

export const OPENROUTER_MODEL_PRESETS = [
    'deepseek/deepseek-v4.1-flash',
    'openai/gpt-5.6-luna',
    'google/gemini-3.8-flash',
] as const;
export type OpenRouterModelPreset = typeof OPENROUTER_MODEL_PRESETS[number];

export function isOpenRouterModelPreset(value: string): value is OpenRouterModelPreset {
    return (OPENROUTER_MODEL_PRESETS as readonly string[]).includes(value);
}

export const OPENAI_MODEL_PRESETS = [
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-5.6-sol',
] as const;
export type OpenAIModelPreset = typeof OPENAI_MODEL_PRESETS[number];

export function isOpenAIModelPreset(value: string): value is OpenAIModelPreset {
    return (OPENAI_MODEL_PRESETS as readonly string[]).includes(value);
}

export const SHORT_VIDEO_MAX_DURATION_OPTIONS = [60, 90, 120, 180] as const;
export type ShortVideoMaxDurationSeconds = typeof SHORT_VIDEO_MAX_DURATION_OPTIONS[number];

export function isShortVideoMaxDurationSeconds(
    value: number,
): value is ShortVideoMaxDurationSeconds {
    return (SHORT_VIDEO_MAX_DURATION_OPTIONS as readonly number[]).includes(value);
}

export const SUMMARY_LINE_HEIGHT_OPTIONS = [1.3, 1.5, 1.8, 2] as const;
export type SummaryLineHeight = typeof SUMMARY_LINE_HEIGHT_OPTIONS[number];

export function isSummaryLineHeight(value: number): value is SummaryLineHeight {
	return (SUMMARY_LINE_HEIGHT_OPTIONS as readonly number[]).includes(value);
}

export interface ObsidianGoogleLikedVideoSettings {
    googleClientId: string;
    dailyNotePath: string;
    videoNotePath: string;
    organizeByChannel: boolean;
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
    transcriptLanguage: string;
    summaryLineHeight: SummaryLineHeight;
    showVideoTags: boolean;
    shortVideoMaxDurationSeconds: ShortVideoMaxDurationSeconds;
    enableAISummary: boolean;
    geminiApiKey: string;
    aiProvider: AIProvider;
    openRouterApiKey: string;
    openRouterModel: string;
    openAIApiKey: string;
    openAIModel: string;
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
        defaultAudioLanguage?: string;
		defaultLanguage?: string;
    };
    contentDetails: {
        duration?: string;
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

export interface SubscriptionChannel {
    id: string;
    title: string;
    thumbnailUrl?: string;
    uploadsPlaylistId: string;
    subscriptionId?: string;
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
export type PresenceFilter = 'all' | 'with' | 'without';
export type PublishedDateFilter = 'all' | '7d' | '30d' | '365d';
export type DurationFilter = 'all' | 'under5' | '5to20' | '20to60' | '60plus';

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
    source?: SummarySource; // Summaries saved before this field used video input.
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
	isUnavailable?: boolean;
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
    source?: SummarySource;
}
