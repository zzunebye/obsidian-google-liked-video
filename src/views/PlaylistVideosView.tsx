import { useEffect, useMemo, useState, useRef } from 'react';
import { usePlugin } from '../store/pluginContext';
import { Play, Search, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { VideoCard } from 'src/ui/VideoCard';
import { SearchBar } from 'src/ui/SearchBar';
import { PlaylistSource, PlaylistInfo } from 'src/api';
import { YouTubeVideo } from 'src/types';
import { Notice } from 'obsidian';
import { UI_TEXT } from 'src/constants/uiText';

interface PlaylistVideosViewProps {
    playlistSource: PlaylistSource;
    playlistInfo: PlaylistInfo;
}

export const PlaylistVideosView: React.FC<PlaylistVideosViewProps> = ({ playlistSource, playlistInfo }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [allVideos, setAllVideos] = useState<YouTubeVideo[]>([]);
    const [displayedVideos, setDisplayedVideos] = useState<YouTubeVideo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMoreToShow, setHasMoreToShow] = useState(false);
    const plugin = usePlugin();
    const loadingRef = useRef(false);

    const videosPerBatch = 20; // Number of videos to show in each batch
    const maxVideosToShow = 999; // Maximum number of videos to show in infinite scroll

    // Create a stable cache key for the playlist source
    const playlistSourceKey = useMemo(() => {
        switch (playlistSource.type) {
            case 'liked':
                return 'liked';
            case 'playlist':
                return playlistSource.playlistId;
            default:
                return 'unknown';
        }
    }, [playlistSource.type, playlistSource.type === 'playlist' ? playlistSource.playlistId : null]);

    // Debounce search term with proper cleanup
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);

        return () => {
            clearTimeout(timer);
        };
    }, [searchTerm]);

    // Reset displayed videos when search changes
    useEffect(() => {
        const filtered = getFilteredVideos();
        setDisplayedVideos(filtered.slice(0, videosPerBatch));
        setHasMoreToShow(filtered.length > videosPerBatch);
    }, [debouncedSearchTerm, allVideos]);

    // Load all videos when component mounts or playlist changes with abort controller
    useEffect(() => {
        const abortController = new AbortController();
        let isMounted = true;

        const loadVideosWithAbort = async () => {
            try {
                if (isMounted && !abortController.signal.aborted) {
                    await loadAllVideos();
                }
            } catch (error) {
                if (isMounted && !abortController.signal.aborted) {
                    console.error('Failed to load videos:', error);
                }
            }
        };

        loadVideosWithAbort();

        return () => {
            isMounted = false;
            abortController.abort();
        };
    }, [playlistSourceKey, playlistInfo.id]);

    const loadAllVideos = async (forceRefresh = false) => {
        if (!plugin?.playlistApi) {
            setError('Playlist API not available');
            return;
        }

        // Prevent duplicate calls
        if (loadingRef.current && !forceRefresh) {
            console.log('Already loading videos, skipping duplicate call');
            return;
        }

        // Check for cached data first (unless forcing refresh)
        if (!forceRefresh) {
            const cachedVideos = plugin.playlistApi.getCachedVideos(playlistSource);
            if (cachedVideos && cachedVideos.length > 0) {
                console.log(`Using ${cachedVideos.length} cached videos for playlist: ${playlistInfo.title}`);
                setAllVideos(cachedVideos);
                setError(null);
                return;
            }
        }

        loadingRef.current = true;
        setIsLoading(true);
        setError(null);

        try {
            console.log(`${forceRefresh ? 'Force refreshing' : 'Loading'} all videos for playlist: ${playlistInfo.title} (${playlistInfo.itemCount} videos)`);

            const allFetchedVideos = await plugin.playlistApi.fetchAllPlaylistVideos(playlistSource, forceRefresh);

            console.log(`Finished loading playlist videos: ${allFetchedVideos.length} total`);
            setAllVideos(allFetchedVideos);
            setError(null);

        } catch (error) {
            console.error('Failed to load playlist videos:', error);
            setError(`Failed to load videos: ${error.message || 'Unknown error'}`);
            new Notice(`Failed to load videos: ${error.message || 'Unknown error'}`);
        } finally {
            loadingRef.current = false;
            setIsLoading(false);
        }
    };

    // Filter videos based on search (extracted from useMemo for reuse)
    const getFilteredVideos = () => {
        if (!allVideos.length) return [];

        // Filter out any invalid videos (missing required properties) and cap at maxVideosToShow
        const validVideos = allVideos
            .filter(video => video && video.snippet && video.id)
            .slice(0, maxVideosToShow);

        if (!debouncedSearchTerm) return validVideos;

        const lowerSearchTerm = debouncedSearchTerm.toLowerCase();
        return validVideos.filter(video => {
            const titleMatch = video.snippet.title.toLowerCase().includes(lowerSearchTerm);
            const tagsMatch = (video.snippet.tags ?? []).some(tag => tag.toLowerCase().includes(lowerSearchTerm));
            const channelMatch = video.snippet.channelTitle.toLowerCase().includes(lowerSearchTerm);
            return titleMatch || tagsMatch || channelMatch;
        });
    };

    // Memoized filtered videos for performance
    const filteredVideos = useMemo(() => getFilteredVideos(), [allVideos, debouncedSearchTerm]);

    // Load more videos for infinite scroll
    const loadMoreVideos = () => {
        if (!hasMoreToShow || isLoadingMore) return;

        setIsLoadingMore(true);

        const filtered = getFilteredVideos();
        const currentCount = displayedVideos.length;
        const nextBatch = filtered.slice(currentCount, currentCount + videosPerBatch);

        // Simulate slight delay for better UX
        setTimeout(() => {
            setDisplayedVideos(prev => [...prev, ...nextBatch]);
            setHasMoreToShow(currentCount + nextBatch.length < filtered.length);
            setIsLoadingMore(false);
        }, 100);
    };

    // Intersection Observer for infinite scroll
    useEffect(() => {
        const sentinel = document.getElementById('scroll-sentinel');
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting && hasMoreToShow && !isLoadingMore) {
                    loadMoreVideos();
                }
            },
            {
                root: null,
                rootMargin: '100px', // Start loading 100px before reaching the sentinel
                threshold: 0.1
            }
        );

        observer.observe(sentinel);

        return () => {
            observer.disconnect();
        };
    }, [hasMoreToShow, isLoadingMore]);

    const handleRefresh = () => {
        // Reset infinite scroll state
        setDisplayedVideos([]);
        setHasMoreToShow(false);
        setIsLoadingMore(false);

        // Reset loading ref to allow the force refresh
        loadingRef.current = false;

        // Force refresh will bypass cache and fetch new data
        loadAllVideos(true);
    };

    // Loading State
    if (isLoading && allVideos.length === 0) {
        return (
            <div className="playlist-videos-view">
                <div className="video-view-header">
                    <div className="video-view-header__title">
                        <Play className="video-view-header__icon" />
                        {playlistInfo.title}
                    </div>
                </div>

                <div className="videos-loading">
                    <div className="videos-loading__spinner">
                        <Loader2 size={32} className="animate-spin" />
                    </div>
                    <div className="videos-loading__text">
                        Loading videos...
                    </div>
                </div>
            </div>
        );
    }

    // Error State
    if (error && allVideos.length === 0) {
        return (
            <div className="playlist-videos-view">
                <div className="video-view-header">
                    <div className="video-view-header__title">
                        <Play className="video-view-header__icon" />
                        {playlistInfo.title}
                    </div>
                </div>

                <div className="videos-error">
                    <div className="videos-error__icon">
                        <AlertCircle size={48} />
                    </div>
                    <div className="videos-error__title">
                        Failed to load videos
                    </div>
                    <div className="videos-error__message">
                        {error}
                    </div>
                    <button
                        className="videos-error__retry-button"
                        onClick={handleRefresh}
                    >
                        <RefreshCw size={16} />
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="playlist-videos-view">
            <div className="video-view-header">
                <div className="video-view-header__title">
                    <Play className="video-view-header__icon" />
                    {playlistInfo.title}
                    {playlistInfo.itemCount > 0 && (
                        <span className="video-count-badge">
                            {playlistInfo.itemCount} videos
                        </span>
                    )}
                </div>
                <div className="video-view-header__actions">
                    <button
                        className="refresh-button"
                        onClick={handleRefresh}
                        disabled={isLoading}
                        title="Refresh videos"
                    >
                        <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {playlistInfo.description && (
                <div className="playlist-description">
                    <p>{playlistInfo.description}</p>
                </div>
            )}

            <div className="search-bar-container">
                <div className="search-bar-wrapper">
                    <SearchBar
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                    />
                </div>
                <div className="video-count">
                    <p style={{ margin: '0' }}>
                        {allVideos.length > maxVideosToShow
                            ? `Showing ${filteredVideos.length} of first ${maxVideosToShow} videos (${allVideos.length} total)`
                            : UI_TEXT.VIDEO_COUNT_WITH_TOTAL(filteredVideos.length, allVideos.length)
                        }
                    </p>
                    {displayedVideos.length < filteredVideos.length && (
                        <p style={{ margin: '0', fontSize: '0.85em', opacity: 0.7 }}>
                            Displaying {displayedVideos.length} of {filteredVideos.length}
                        </p>
                    )}
                    {allVideos.length > maxVideosToShow && (
                        <p style={{ margin: '0', fontSize: '0.8em', opacity: 0.6, fontStyle: 'italic' }}>
                            Limited to {maxVideosToShow} videos for performance
                        </p>
                    )}
                </div>
            </div>

            {filteredVideos.length === 0 ? (
                <div className="no-videos-found">
                    <div className="no-videos-found__icon">
                        <Search size={48} />
                    </div>
                    <div className="no-videos-found__title">
                        {debouncedSearchTerm ? 'No matching videos' : 'No videos found'}
                    </div>
                    <div className="no-videos-found__text">
                        {debouncedSearchTerm
                            ? `No videos match "${debouncedSearchTerm}". Try a different search term.`
                            : 'This playlist appears to be empty.'
                        }
                    </div>
                    {debouncedSearchTerm && (
                        <button
                            className="no-videos-found__clear-button"
                            onClick={() => setSearchTerm('')}
                        >
                            Clear search
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <div className="videos-grid">
                        {displayedVideos.map((video) => (
                            <VideoCard
                                key={video.id}
                                source="playlist"
                                videoInfo={video}
                                id={video.id}
                                url={`https://www.youtube.com/watch?v=${video.id}`}
                                onUnlike={() => {
                                    // Playlist videos don't have unlike functionality
                                    console.log('Unlike not available for playlist videos');
                                }}
                                onAddToDailyNote={async (videoData, file) => {
                                    const contentToAppend = `\n${videoData}`;
                                    plugin?.app.vault.process(file, (data) => {
                                        return data + contentToAppend;
                                    });
                                }}
                                onChannelClick={(channelTitle) => {
                                    setSearchTerm(channelTitle);
                                }}
                            />
                        ))}
                    </div>

                    {/* Infinite Scroll Loading Indicator */}
                    {hasMoreToShow && (
                        <div className="infinite-scroll-loading">
                            {isLoadingMore && (
                                <div className="infinite-scroll-loading__content">
                                    <Loader2 size={24} className="animate-spin" />
                                    <span>Loading more videos...</span>
                                </div>
                            )}
                            {/* Sentinel element for intersection observer */}
                            <div id="scroll-sentinel" style={{ height: '1px', width: '100%' }} />
                        </div>
                    )}

                    {/* Show when all videos are loaded */}
                    {!hasMoreToShow && displayedVideos.length > 0 && displayedVideos.length >= filteredVideos.length && (
                        <div className="infinite-scroll-complete">
                            <p>
                                {allVideos.length > maxVideosToShow
                                    ? `All available videos loaded (limited to ${maxVideosToShow})`
                                    : 'All videos loaded'
                                }
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};