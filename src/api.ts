import type { RequestUrlResponse } from "obsidian";
import { YouTubeVideo, YouTubeVideosResponse, YouTubeCategory, YoutubeCategoriesResponse, PlaylistCache, YouTubePlaylistResponse, PlaylistSource, PaginatedResult, PlaylistInfo } from "./types";
import { debugLogger } from "./debug";
import { YouTubeApiClient } from "./services/youtubeApiClient";
import type { YouTubeRequestOptions } from "./services/youtubeApiClient";

type RequestOptions = Pick<YouTubeRequestOptions, 'body' | 'contentType'>;

type PlaylistItemResponse = {
    snippet: {
        resourceId: {
            videoId: string;
        };
    };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

// Generic Playlist API that can handle different playlist sources
export class PlaylistApi {
	private pendingPlaylistAdditions = new Set<string>();
    private paginationCache = new Map<string, PlaylistCache>();
    private static readonly MAX_CACHE_SIZE = 50; // Maximum number of cached playlists
    private static readonly DEFAULT_TTL = 10 * 60 * 1000; // 10 minutes in milliseconds

    constructor(private readonly client: YouTubeApiClient) { }

    /**
     * Cleanup resources when plugin is unloaded
     */
    cleanup(): void {
        this.paginationCache.clear();
        debugLogger.api('PlaylistApi resources cleaned up');
    }

    // Type-safe validation for YouTube playlist responses
    private validatePlaylistResponse(playlist: unknown): playlist is YouTubePlaylistResponse {
        if (!isRecord(playlist)) return false;

        const { id, snippet, contentDetails } = playlist;
        return typeof id === 'string'
            && isRecord(snippet)
            && typeof snippet.title === 'string'
            && isRecord(contentDetails)
            && typeof contentDetails.itemCount === 'number';
    }

    // Cache management methods
    private isValidCache(cache: PlaylistCache): boolean {
        const now = Date.now();
        return (now - (cache.lastFetched || 0)) < (cache.ttl || 0);
    }

    private enforceMaxCacheSize(): void {
        if (this.paginationCache.size >= PlaylistApi.MAX_CACHE_SIZE) {
            // Remove oldest cache entries
            const sortedEntries = Array.from(this.paginationCache.entries())
                .sort(([, a], [, b]) => (a.lastFetched || 0) - (b.lastFetched || 0));

            // Remove oldest 20% of entries
            const toRemove = Math.ceil(PlaylistApi.MAX_CACHE_SIZE * 0.2);
            for (let i = 0; i < toRemove; i++) {
                this.paginationCache.delete(sortedEntries[i][0]);
            }
        }
    }

    async sendRequest(method: 'GET' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, options: RequestOptions = {}): Promise<RequestUrlResponse> {
        return this.client.request(method, url, { ...options, headers });
    }

    async fetchVideos(source: PlaylistSource, limit = 50, pageToken?: string): Promise<YouTubeVideosResponse> {
        debugLogger.api(`Fetching videos for source: ${JSON.stringify(source)}, limit: ${limit}, pageToken: ${pageToken || 'none'}`);

        switch (source.type) {
            case 'liked':
                return this.fetchLikedVideos(limit, pageToken);

            case 'playlist':
                return this.fetchPlaylistVideos(source.playlistId, limit, pageToken);

            default:
                throw new Error(`Unsupported playlist source type: ${(source as PlaylistSource).type}`);
        }
    }

    private async fetchLikedVideos(limit: number, pageToken?: string): Promise<YouTubeVideosResponse> {
        let url = 'videos?'
            + 'part=snippet,contentDetails,statistics'
            + `&maxResults=${limit}`
            + '&myRating=like';

        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = response.json;

        // Add pulled_at timestamp to each video
        data.items.forEach((video: YouTubeVideo) => {
            video.pulled_at = new Date().toISOString();
        });

        debugLogger.api(`Fetched ${data.items?.length || 0} liked videos`);
        return data;
    }


    private async fetchPlaylistVideos(playlistId: string, limit: number, pageToken?: string): Promise<YouTubeVideosResponse> {
        let url = 'playlistItems?'
            + 'part=snippet,contentDetails'
            + `&playlistId=${playlistId}`
            + `&maxResults=${limit}`;

        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        const response = await this.sendRequest('GET', url, {});
        const playlistResponse = response.json;

        if (!playlistResponse.items || playlistResponse.items.length === 0) {
            return {
                kind: playlistResponse.kind,
                etag: playlistResponse.etag,
                items: [],
                nextPageToken: playlistResponse.nextPageToken,
                pageInfo: playlistResponse.pageInfo
            };
        }

        // Extract video IDs from playlist items, filtering out any invalid items with proper type checking
        const videoIds = playlistResponse.items
            .filter((item: unknown): item is PlaylistItemResponse =>
                isRecord(item)
                && isRecord(item.snippet)
                && isRecord(item.snippet.resourceId)
                && typeof item.snippet.resourceId.videoId === 'string'
            )
            .map((item: PlaylistItemResponse) => item.snippet.resourceId.videoId);

        if (videoIds.length === 0) {
            return {
                kind: playlistResponse.kind,
                etag: playlistResponse.etag,
                items: [],
                nextPageToken: playlistResponse.nextPageToken,
                pageInfo: playlistResponse.pageInfo
            };
        }

        // Fetch detailed video information
        const videosUrl = 'videos?'
            + 'part=snippet,contentDetails,statistics'
            + `&id=${videoIds.join(',')}`;

        const videosResponse = await this.sendRequest('GET', videosUrl, {});
        const videosData: YouTubeVideosResponse = videosResponse.json;

        // Filter out any videos that don't have required properties and add pulled_at timestamp
        videosData.items = (videosData.items || []).filter((video: YouTubeVideo) => {
            // Ensure video has all required properties
            const isValid = video && video.snippet && video.id && video.statistics;
            if (!isValid) {
                debugLogger.warn(`Filtering out invalid video: ${video?.id || 'unknown'}`);
            }
            return isValid;
        });

        // Add pulled_at timestamp to each valid video
        videosData.items.forEach((video: YouTubeVideo) => {
            video.pulled_at = new Date().toISOString();
            // Ensure statistics exist with default values if missing
            if (!video.statistics) {
                video.statistics = {
                    viewCount: 0,
                    likeCount: 0,
                    favoriteCount: "0",
                    commentCount: "0"
                };
            }
        });

        // Preserve pagination info from playlist response
        videosData.nextPageToken = playlistResponse.nextPageToken;
        videosData.pageInfo = playlistResponse.pageInfo;

        debugLogger.api(`Fetched ${videosData.items?.length || 0} videos from playlist ${playlistId}`);
        return videosData;
    }

	async fetchUserPlaylists(): Promise<PlaylistInfo[]> {
		const baseUrl = 'playlists?'
			+ 'part=snippet,contentDetails'
			+ '&maxResults=50'
			+ '&mine=true';

		const playlists: PlaylistInfo[] = [];
		let pageToken = '';
		do {
			const url = baseUrl + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
			const response = await this.sendRequest('GET', url, {});
			const data: unknown = response.json;

			if (!isRecord(data) || !Array.isArray(data.items)) {
				throw new Error('Invalid YouTube playlist response');
			}

			// Filter and map with type validation
			playlists.push(...data.items
				.filter((playlist: unknown) => this.validatePlaylistResponse(playlist))
				.map((playlist: YouTubePlaylistResponse): PlaylistInfo => ({
					id: playlist.id,
					title: playlist.snippet.title,
					description: playlist.snippet.description || '',
					itemCount: playlist.contentDetails.itemCount,
					thumbnailUrl: playlist.snippet.thumbnails?.medium?.url,
					publishedAt: playlist.snippet.publishedAt,
					isOwnedByUser: true
				})));
			pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
		} while (pageToken);
		return playlists;
	}

	async addVideoToPlaylist(playlistId: string, videoId: string): Promise<'added' | 'already-exists'> {
		const key = JSON.stringify([playlistId, videoId]);
		if (this.pendingPlaylistAdditions.has(key)) {
			throw new Error('This video is already being added to this playlist. Please wait.');
		}
		this.pendingPlaylistAdditions.add(key);
		try {
			// Check YouTube directly: a cached playlist may be incomplete or stale.
			const params = new URLSearchParams({ part: 'id', playlistId, videoId, maxResults: '1' });
			const response = await this.sendRequest('GET', `playlistItems?${params.toString()}`, {});
			const data: unknown = response.json;
			if (!isRecord(data) || !Array.isArray(data.items)) {
				throw new Error('Could not check whether this video is already in the playlist. Please try again.');
			}
			if (data.items.length > 0) {
				this.clearCache({ type: 'playlist', playlistId });
				return 'already-exists';
			}
			try {
				await this.sendRequest('POST', 'playlistItems?part=snippet', {}, {
					contentType: 'application/json',
					body: JSON.stringify({ snippet: {
						playlistId,
						resourceId: { kind: 'youtube#video', videoId },
					} }),
				});
			} finally {
				// A timed-out write may still have reached YouTube; do not reuse the old snapshot.
				this.clearCache({ type: 'playlist', playlistId });
			}
			return 'added';
		} finally {
			this.pendingPlaylistAdditions.delete(key);
		}
	}

    async deletePlaylist(playlistId: string): Promise<void> {
        const url = 'playlists?'
            + `id=${encodeURIComponent(playlistId)}`;

        await this.sendRequest('DELETE', url, {});
        this.clearCache({ type: 'playlist', playlistId });
    }

    async fetchPlaylistById(playlistId: string): Promise<PlaylistInfo> {
        debugLogger.api(`Fetching playlist by ID: ${playlistId}`);

        // Clean playlist ID (remove URL parts if user pasted a full YouTube URL)
        const cleanPlaylistId = this.extractPlaylistId(playlistId);

        const url = 'playlists?'
            + 'part=snippet,contentDetails'
            + `&id=${cleanPlaylistId}`;

        const response = await this.sendRequest('GET', url, {});
        const data = response.json;

        if (!data.items || data.items.length === 0) {
            throw new Error(`Playlist not found or not accessible: ${cleanPlaylistId}`);
        }

        const playlist = data.items[0];

        // Check if playlist is private
        if (playlist.snippet.privacyStatus === 'private') {
            throw new Error(`Playlist is private and cannot be accessed: ${cleanPlaylistId}`);
        }

        debugLogger.api(`Successfully fetched playlist: ${playlist.snippet.title}`);

        return {
            id: playlist.id,
            title: playlist.snippet.title,
            description: playlist.snippet.description || '',
            itemCount: playlist.contentDetails.itemCount,
            thumbnailUrl: playlist.snippet.thumbnails?.medium?.url,
            publishedAt: playlist.snippet.publishedAt,
            isOwnedByUser: false
        };
    }

    private extractPlaylistId(input: string): string {
        const trimmed = input.trim();

        // If it's already just an ID, return it
        if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length > 10) {
            return trimmed;
        }

        // Extract from various YouTube playlist URL formats
        const urlPatterns = [
            /[?&]list=([A-Za-z0-9_-]+)/,           // ?list=ID or &list=ID
            /playlist\?list=([A-Za-z0-9_-]+)/,     // playlist?list=ID
            /^([A-Za-z0-9_-]+)$/                   // Just the ID
        ];

        for (const pattern of urlPatterns) {
            const match = trimmed.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }

        // If no patterns match, return the input (might be a valid ID)
        return trimmed;
    }

    async fetchVideosPage(source: PlaylistSource, page = 1, videosPerPage = 10): Promise<PaginatedResult> {
        const cacheKey = this.getCacheKey(source);
        let cache: PlaylistCache | undefined = this.paginationCache.get(cacheKey);

        if (!cache) {
            cache = {
                pages: new Map(),
                tokens: new Map(),
                totalResults: undefined
            };
            this.paginationCache.set(cacheKey, cache);
        }

        // Check if we already have this page
        if (cache.pages.has(page)) {
            const videos = cache.pages.get(page) || [];
            return {
                videos,
                currentPage: page,
                hasNext: cache.pages.has(page + 1) || cache.tokens.has(page),
                hasPrev: page > 1,
                totalResults: cache.totalResults,
                totalPages: cache.totalResults ? Math.ceil(cache.totalResults / videosPerPage) : undefined
            };
        }

        // Calculate which page token to use
        let pageToken: string | undefined;
        if (page > 1) {
            // For pages after the first, we need the token from the previous page
            pageToken = cache.tokens.get(page - 1);
            if (!pageToken && !cache.pages.has(page - 1)) {
                // If we don't have the previous page, we need to fetch from the beginning
                await this.fetchPagesUpTo(source, page - 1, videosPerPage, cache);
                pageToken = cache.tokens.get(page - 1);
            }
        }

        // Fetch the current page
        const response = await this.fetchVideos(source, videosPerPage, pageToken);

        // Store the page data
        cache.pages.set(page, response.items);

        // Store the next page token if available
        if (response.nextPageToken) {
            cache.tokens.set(page, response.nextPageToken);
        }

        // Store total results if available
        if (response.pageInfo?.totalResults !== undefined) {
            cache.totalResults = response.pageInfo.totalResults;
        }

        return {
            videos: response.items,
            currentPage: page,
            hasNext: !!response.nextPageToken,
            hasPrev: page > 1,
            totalResults: cache.totalResults,
            totalPages: cache.totalResults ? Math.ceil(cache.totalResults / videosPerPage) : undefined
        };
    }

    private async fetchPagesUpTo(source: PlaylistSource, targetPage: number, videosPerPage: number, cache: PlaylistCache): Promise<void> {
        let currentPage = 1;
        let pageToken: string | undefined;

        while (currentPage <= targetPage) {
            if (cache.pages.has(currentPage)) {
                pageToken = cache.tokens.get(currentPage);
                currentPage++;
                continue;
            }

            const response = await this.fetchVideos(source, videosPerPage, pageToken);
            cache.pages.set(currentPage, response.items);

            if (response.nextPageToken) {
                cache.tokens.set(currentPage, response.nextPageToken);
                pageToken = response.nextPageToken;
            } else {
                pageToken = undefined;
            }

            if (response.pageInfo?.totalResults !== undefined) {
                cache.totalResults = response.pageInfo.totalResults;
            }

            currentPage++;

            if (!response.nextPageToken) {
                break;
            }
        }
    }

    private getCacheKey(source: PlaylistSource): string {
        switch (source.type) {
            case 'liked':
                return 'liked';
            case 'playlist':
                return `playlist_${source.playlistId}`;
            default:
                return 'unknown';
        }
    }

    clearAllCaches(): void {
        this.paginationCache.clear();
        debugLogger.api('All playlist caches cleared');
    }

    clearCache(source: PlaylistSource): void {
        const cacheKey = this.getCacheKey(source);
        this.paginationCache.delete(cacheKey);
        debugLogger.api(`Cache cleared for: ${cacheKey}`);
    }

    // Get all cached videos for a playlist
    getCachedVideos(source: PlaylistSource): YouTubeVideo[] | null {
        const cacheKey = this.getCacheKey(source);
        const cache = this.paginationCache.get(cacheKey);

        if (cache?.allVideos && cache.allVideos.length > 0) {
            // Check if cache is still valid
            if (this.isValidCache(cache)) {
                debugLogger.api(`Found ${cache.allVideos.length} valid cached videos for ${cacheKey}`);
                return cache.allVideos;
            } else {
                // Cache expired, remove it
                this.paginationCache.delete(cacheKey);
                debugLogger.api(`Cache expired for ${cacheKey}, removed from cache`);
            }
        }

        debugLogger.api(`No valid cached videos found for ${cacheKey}`);
        return null;
    }

    // Cache all videos for a playlist
    setCachedVideos(source: PlaylistSource, videos: YouTubeVideo[]): void {
        const cacheKey = this.getCacheKey(source);

        // Enforce max cache size before adding new entry
        this.enforceMaxCacheSize();

        let cache = this.paginationCache.get(cacheKey);

        if (!cache) {
            cache = {
                pages: new Map(),
                tokens: new Map(),
                totalResults: videos.length,
                lastFetched: Date.now(),
                ttl: PlaylistApi.DEFAULT_TTL
            };
        } else {
            cache.lastFetched = Date.now();
            cache.ttl = PlaylistApi.DEFAULT_TTL;
        }

        cache.allVideos = videos;
        this.paginationCache.set(cacheKey, cache);

        debugLogger.api(`Cached ${videos.length} videos for ${cacheKey} with TTL ${cache.ttl}ms`);
    }

    // Fetch all videos for a playlist (with caching)
    async fetchAllPlaylistVideos(source: PlaylistSource, forceRefresh = false): Promise<YouTubeVideo[]> {
        // Check cache first unless force refresh
        if (!forceRefresh) {
            const cached = this.getCachedVideos(source);
            if (cached) {
                debugLogger.api(`Returning cached videos for playlist`);
                return cached;
            }
        }

        debugLogger.api(`Fetching all videos for playlist (no cache or force refresh)`);
        let allVideos: YouTubeVideo[] = [];
        let nextPageToken: string | undefined = undefined;

        do {
            const response: YouTubeVideosResponse = await this.fetchVideos(source, 50, nextPageToken);
            if (response.items && response.items.length > 0) {
                allVideos = [...allVideos, ...response.items];
            }
            nextPageToken = response.nextPageToken;
        } while (nextPageToken);

        // Cache the results
        this.setCachedVideos(source, allVideos);

        return allVideos;
    }
}

export class LikedVideoApi {
    constructor(private readonly client: YouTubeApiClient) { }

    /**
     * Cleanup resources when plugin is unloaded
     */
    cleanup(): void {
        debugLogger.api('LikedVideoApi resources cleaned up');
    }

    // Wrapper function for sending request to the YouTube Data API
    // 1. It will get the access token from the plugin settings
    // 2. If the access token is expired, it will refresh the access token with the refresh token
    // 3. It will add the access token to the request headers
    async sendRequest(method: 'GET' | 'POST', url: string, headers: Record<string, string>, options: RequestOptions = {}): Promise<RequestUrlResponse> {
        return this.client.request(method, url, { ...options, headers });
    }

    async fetchLikedVideos(limit = 50, pageToken?: string): Promise<YouTubeVideosResponse> {
        debugLogger.api(`Fetching liked videos - limit: ${limit}, pageToken: ${pageToken || 'none'}`);
        let url = 'videos?'
            + 'part=snippet,contentDetails,statistics'
            + `&maxResults=${limit}`
            + '&myRating=like';

        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }
        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = response.json;
        debugLogger.api(`Fetched ${data.items?.length || 0} videos`);
        debugLogger.verbose('API Response:', data);

        data.items?.forEach(video => {
            video.pulled_at = new Date().toISOString();
        });

        return data;
    }

    async fetchPlaylists(): Promise<unknown> {
        const url = 'playlists?'
            + 'part=snippet,contentDetails'
            + '&maxResults=5'
            + '&mine=true';

        const response = await this.sendRequest('GET', url, {});
        const data = response.json;
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
        const url = 'videos?'
            + 'part=snippet,statistics'
            + '&maxResults=1'
            + '&myRating=like';
        const response = await this.sendRequest('GET', url, {});
        const data: YouTubeVideosResponse = response.json;
        return data.pageInfo.totalResults;
    }

    async likeVideo(videoId: string): Promise<void> {
        const url = 'videos/rate?id=' + videoId + '&rating=like';
        await this.sendRequest('POST', url, {
            'Content-Type': 'application/json'
        });
    }

    async unlikeVideo(videoId: string): Promise<void> {
        const url = 'videos/rate?id=' + videoId + '&rating=none';
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

            const url = 'videoCategories?part=snippet&regionCode=US';
            const response = await this.sendRequest('GET', url, {});
            const data: YoutubeCategoriesResponse = response.json;

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
