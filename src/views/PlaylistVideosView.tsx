import { useEffect, useMemo, useState } from 'react';
import { usePlugin } from '../store/pluginContext';
import { Play, Search, Loader2, AlertCircle, RefreshCw, ArrowLeft, ArrowRight } from 'lucide-react';
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
    const [currentPage, setCurrentPage] = useState(1);
    const [allVideos, setAllVideos] = useState<YouTubeVideo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const plugin = usePlugin();

    const videosPerPage = 10;

    // Debounce search term with proper cleanup
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);

        return () => {
            clearTimeout(timer);
        };
    }, [searchTerm]);

    // Reset current page when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm]);

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
    }, [playlistSource.playlistId, playlistInfo.id]);

    const loadAllVideos = async (forceRefresh = false) => {
        if (!plugin?.playlistApi) {
            setError('Playlist API not available');
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
            setIsLoading(false);
        }
    };

    // Filter videos based on search
    const filteredVideos = useMemo(() => {
        if (!allVideos.length) return [];

        // Filter out any invalid videos (missing required properties)
        const validVideos = allVideos.filter(video =>
            video && video.snippet && video.id
        );

        if (!debouncedSearchTerm) return validVideos;

        const lowerSearchTerm = debouncedSearchTerm.toLowerCase();
        return validVideos.filter(video => {
            const titleMatch = video.snippet.title.toLowerCase().includes(lowerSearchTerm);
            const tagsMatch = (video.snippet.tags ?? []).some(tag => tag.toLowerCase().includes(lowerSearchTerm));
            const channelMatch = video.snippet.channelTitle.toLowerCase().includes(lowerSearchTerm);
            return titleMatch || tagsMatch || channelMatch;
        });
    }, [allVideos, debouncedSearchTerm]);

    // Client-side pagination
    const totalPages = Math.ceil(filteredVideos.length / videosPerPage);
    const startIndex = (currentPage - 1) * videosPerPage;
    const endIndex = startIndex + videosPerPage;
    const currentVideos = filteredVideos.slice(startIndex, endIndex);

    const handleRefresh = () => {
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
                    <p style={{ margin: '0' }}>{UI_TEXT.VIDEO_COUNT_WITH_TOTAL(filteredVideos.length, allVideos.length)}</p>
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
                        {currentVideos.map((video) => (
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

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="pagination">
                            <div className="pagination__info">
                                Page {currentPage} of {totalPages}
                                <span className="pagination__total">
                                    ({filteredVideos.length}
                                    {debouncedSearchTerm ? ` matching "${debouncedSearchTerm}"` : ''} videos)
                                </span>
                            </div>
                            <div className="pagination__controls">
                                <button
                                    className="pagination__button"
                                    onClick={() => setCurrentPage(currentPage - 1)}
                                    disabled={currentPage <= 1 || isLoading}
                                >
                                    <ArrowLeft size={16} />
                                    Previous
                                </button>
                                <button
                                    className="pagination__button"
                                    onClick={() => setCurrentPage(currentPage + 1)}
                                    disabled={currentPage >= totalPages || isLoading}
                                >
                                    Next
                                    <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};