import { useContext, useEffect, useMemo, useState } from 'react';
import { usePlugin } from '../store/pluginContext';
import { localStorageService } from 'src/storage';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { Youtube, Settings, RefreshCcw, Filter } from 'lucide-react';
import { VideoCard } from 'src/ui/VideoCard';
import { SearchBar } from 'src/ui/SearchBar';
import { APP_ID } from 'src/main';
import { Modal, Notice } from 'obsidian';
import { VideosContext } from 'src/store/videoContext';
import { UI_TEXT } from 'src/constants/uiText';
import { categoriesService } from 'src/categoriesService';
import { parseDurationToSeconds } from 'src/ui/VideoInfoModal';


export const LikedVideoView: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOption, setSortOption] = useState(localStorageService.getSortOption());
    const [sortOrder, setSortOrder] = useState(localStorageService.getSortOrder());
    const [selectedCategory, setSelectedCategory] = useState(localStorageService.getSelectedCategory());
    const [musicFilterEnabled, setMusicFilterEnabled] = useState(localStorageService.getMusicFilterEnabled());
    const [shortVideosFilterEnabled, setShortVideosFilterEnabled] = useState(localStorageService.getShortVideosFilterEnabled());
    const [videos, setVideos] = useContext(VideosContext);
    const [isFetching, setIsFetching] = useState(false);
    const plugin = usePlugin();
    const videosPerPage = 10;

    // Get categories ready state
    const isCategoriesReady = categoriesService.isReady();

    // Get available categories for filtering
    const availableCategories = useMemo(() => {
        if (!isCategoriesReady) {
            return [];
        }

        // Get unique categories from current videos
        const videoCategories = new Set(videos.map(video => video.snippet.categoryId));
        const allCategories = categoriesService.getAllCategories();

        // Only show categories that exist in the current video collection
        return allCategories.filter(category => videoCategories.has(category.id));
    }, [videos, isCategoriesReady]);

    // Calculate category counts
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        videos.forEach(video => {
            const categoryId = video.snippet.categoryId;
            if (categoryId) {
                counts[categoryId] = (counts[categoryId] || 0) + 1;
            }
        });
        return counts;
    }, [videos]);

    // Pre-process video durations once
    const videoDurations = useMemo(() => {
        const durations = new Map<string, number>();
        videos.forEach(video => {
            if (video.contentDetails?.duration) {
                const seconds = parseDurationToSeconds(video.contentDetails.duration);
                // Use 0 as fallback if parsing fails
                durations.set(video.id, seconds ?? 0);
            } else {
                // Set 0 for videos without duration info
                durations.set(video.id, 0);
            }
        });
        return durations;
    }, [videos]);

    useEffect(() => {
        localStorageService.setSortOption(sortOption);
        localStorageService.setSortOrder(sortOrder);
    }, [sortOption, sortOrder]);

    useEffect(() => {
        localStorageService.setSelectedCategory(selectedCategory);
    }, [selectedCategory]);

    useEffect(() => {
        localStorageService.setMusicFilterEnabled(musicFilterEnabled);
    }, [musicFilterEnabled]);

    useEffect(() => {
        localStorageService.setShortVideosFilterEnabled(shortVideosFilterEnabled);
    }, [shortVideosFilterEnabled]);

    // Debounce search term
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);

        return () => clearTimeout(timer);
    }, [searchTerm]);

    const filteredVideos = useMemo(() => {
        // Pre-calculate lowercase search term once
        const lowerSearchTerm = debouncedSearchTerm.toLowerCase();

        return videos.filter(video => {
            // Search filter - only calculate if search term exists
            let searchMatch = true;
            if (lowerSearchTerm) {
                const titleMatch = video.snippet.title.toLowerCase().includes(lowerSearchTerm);
                const tagsMatch = (video.snippet.tags ?? []).some(tag => tag.toLowerCase().includes(lowerSearchTerm));
                const channelMatch = video.snippet.channelTitle.toLowerCase().includes(lowerSearchTerm);
                searchMatch = titleMatch || tagsMatch || channelMatch;
            }

            // Category filter
            const categoryMatch = selectedCategory === 'all' || video.snippet.categoryId === selectedCategory;

            // Music filter (exclude music videos when filter is enabled)
            const musicMatch = !musicFilterEnabled || video.snippet.categoryId !== '10';

            // Short videos filter (exclude videos ≤ 90 seconds when filter is enabled)
            const durationInSeconds = videoDurations.get(video.id) || 0;
            const shortVideoMatch = !shortVideosFilterEnabled || durationInSeconds > 90;

            return searchMatch && categoryMatch && musicMatch && shortVideoMatch;
        });
    }, [videos, debouncedSearchTerm, selectedCategory, musicFilterEnabled, shortVideosFilterEnabled, videoDurations]);

    const sortedVideos = useMemo(() => {
        const sorted = [...filteredVideos];
        switch (sortOption) {
            case 'title':
                sorted.sort((a, b) => a.snippet.title.localeCompare(b.snippet.title));
                break;
            case 'viewCount':
                sorted.sort((a, b) => b.statistics.viewCount - a.statistics.viewCount);
                break;
            case 'likeCount':
                sorted.sort((a, b) => b.statistics.likeCount - a.statistics.likeCount);
                break;
            case 'commentCount':
                sorted.sort((a, b) => {
                    const aCommentCount = parseInt(a.statistics.commentCount) || 0;
                    const bCommentCount = parseInt(b.statistics.commentCount) || 0;
                    return bCommentCount - aCommentCount;
                });
                break;
            case 'likeViewRatio':
                sorted.sort((a, b) => b.statistics.likeCount / b.statistics.viewCount - a.statistics.likeCount / a.statistics.viewCount);
                break;

            case 'date':
                sorted.sort((a, b) => new Date(b.snippet.publishedAt).getTime() - new Date(a.snippet.publishedAt).getTime());
                break;
            case 'addedDate':
                sorted.sort((a, b) => videos.indexOf(a) - videos.indexOf(b));
                break;
            case 'duration':
                sorted.sort((a, b) => {
                    const aDuration = videoDurations.get(a.id) || 0;
                    const bDuration = videoDurations.get(b.id) || 0;
                    return bDuration - aDuration;
                });
                break;
        }
        if (sortOrder === 'ASC') {
            sorted.reverse();
        }
        return sorted;
    }, [filteredVideos, sortOption, videos, sortOrder, videoDurations]);

    const totalPages = Math.ceil(sortedVideos.length / videosPerPage);
    const startIndex = (currentPage - 1) * videosPerPage;
    const endIndex = startIndex + videosPerPage;

    const currentVideos = useMemo(() => {
        return sortedVideos.slice(startIndex, endIndex);
    }, [sortedVideos, startIndex, endIndex]);

    // Reset currentPage to 1 when debouncedSearchTerm, sortOption, or filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [debouncedSearchTerm, sortOption, selectedCategory, musicFilterEnabled, shortVideosFilterEnabled]);

    return <div
        className="liked-video-view">
        <div className="video-view-header">
            <div className="video-view-header__title"><Youtube className="video-view-header__icon" /> {UI_TEXT.HEADER_TITLE}
                {plugin?.settings.autoFetchEnabled && (
                    <span className="auto-fetch-indicator" title={`Auto-fetch: Every ${plugin.settings.autoFetchInterval < 1
                        ? `${Math.round(plugin.settings.autoFetchInterval * 60)} seconds`
                        : `${plugin.settings.autoFetchInterval} minutes`
                        }`}>
                        {plugin?.isFetching ? '🔄 Fetching...' : '⏰ Auto'}
                    </span>
                )}
            </div>
            <div className="video-view-header__actions">
                <button
                    title={UI_TEXT.BTN_REFRESH}
                    /// Refresh button to fetch recently liked videos
                    className="video-view-header__refresh-button"
                    disabled={isFetching || plugin?.isFetching}
                    onClick={async () => {
                        setIsFetching(true);
                        let fetchedLikedVideos: YouTubeVideo[] = [];
                        let nextPageToken: string | undefined = undefined;

                        const limit = plugin?.settings.fetchLimit;

                        const response: YouTubeVideosResponse | undefined = await plugin?.likedVideoApi.fetchLikedVideos(limit, nextPageToken);

                        if (response) {
                            fetchedLikedVideos = fetchedLikedVideos.concat(response.items);
                            nextPageToken = response.nextPageToken;
                        }

                        const storedLikedVideos = localStorageService.getLikedVideos();
                        const storedLikedVideoIdsSet = new Set(storedLikedVideos.map(video => video.id));

                        const newLikedVideos = fetchedLikedVideos.filter(video => !storedLikedVideoIdsSet.has(video.id));

                        const updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos];

                        // Batch state updates to avoid unnecessary re-renders
                        localStorageService.setLikedVideos(updatedLikedVideos);
                        setVideos(updatedLikedVideos);

                        new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(newLikedVideos.length));
                        setIsFetching(false);
                    }}
                ><RefreshCcw size={16} /></button>
                <button
                    title={UI_TEXT.BTN_SETTINGS}
                    onClick={() => {
                        // Open Plugin Setting.
                        const setting = (plugin?.app as any).setting;
                        setting.open();
                        setting.openTabById(APP_ID);
                    }}
                ><Settings size={16} /></button>
            </div>
        </div>
        <div className="search-bar-container">
            <div className="search-bar-wrapper">
                <SearchBar
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                />
            </div>
            <div className="video-count">
                <p>{UI_TEXT.VIDEO_COUNT_WITH_TOTAL(filteredVideos.length, videos.length)}</p>
            </div>
        </div>
        <div className="video-view-sort">
            <div className="video-view-sort-left-group">
                <div className="category-filter">
                    <Filter size={14} className="category-filter-icon" />
                    <select
                        className="category-filter-select"
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        disabled={!isCategoriesReady || availableCategories.length === 0}
                    >
                        <option value="all">
                            All Categories ({videos.length})
                        </option>
                        {availableCategories.map(category => (
                            <option key={category.id} value={category.id}>
                                {category.title} ({categoryCounts[category.id] || 0})
                            </option>
                        ))}
                        {!isCategoriesReady && (
                            <option value="loading" disabled>
                                Loading categories...
                            </option>
                        )}
                    </select>
                </div>
                <div className="music-filter-checkbox">
                    <label className="music-filter-label">
                        <input
                            type="checkbox"
                            className="music-filter-input"
                            checked={musicFilterEnabled}
                            onChange={(e) => setMusicFilterEnabled(e.target.checked)}
                            title={musicFilterEnabled ? "Exclude music" : "Exclude music"}
                        />
                        <span className="music-filter-text">Exclude Music</span>
                    </label>
                </div>
                <div className="short-videos-filter-checkbox">
                    <label className="short-videos-filter-label">
                        <input
                            type="checkbox"
                            className="short-videos-filter-input"
                            checked={shortVideosFilterEnabled}
                            onChange={(e) => setShortVideosFilterEnabled(e.target.checked)}
                            title={shortVideosFilterEnabled ? "Exclude short videos" : "Exclude short videos (≤1.5 min)"}
                        />
                        <span className="short-videos-filter-text">Exclude Short videos (≤1.5 min)</span>
                    </label>
                </div>
            </div>
            <div className="sort-controls">
                <label htmlFor="sort-video-select">{UI_TEXT.SORT_LABEL}</label>
                <select
                    id="sort-video-select"
                    className="video-view-sort__select"
                    aria-label={UI_TEXT.ARIA_SORT_VIDEOS}
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value)}
                >
                    <option value="addedDate">{UI_TEXT.SORT_BY_LIKED_ORDER}</option>
                    <option value="viewCount">{UI_TEXT.SORT_BY_VIEW_COUNT}</option>
                    <option value="likeCount">{UI_TEXT.SORT_BY_LIKE_COUNT}</option>
                    <option value="commentCount">{UI_TEXT.SORT_BY_COMMENT_COUNT}</option>
                    <option value="likeViewRatio">{UI_TEXT.SORT_BY_LIKE_VIEW_RATIO}</option>
                    <option value="date">{UI_TEXT.SORT_BY_PUBLISHED_DATE}</option>
                    <option value="title">{UI_TEXT.SORT_BY_TITLE}</option>
                    <option value="duration">{UI_TEXT.SORT_BY_DURATION}</option>
                </select>
                <button
                    title={UI_TEXT.BTN_TOGGLE_SORT_ORDER}
                    onClick={() => setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC')}
                    className="video-view-sort__order"
                    aria-label={UI_TEXT.ARIA_TOGGLE_SORT_ORDER}
                >
                    {sortOrder === 'ASC' ? UI_TEXT.SORT_ASC : UI_TEXT.SORT_DESC}
                </button>
            </div>
        </div>
        {currentVideos.length === 0 && <div className="no-videos-found">
            <div className="no-videos-found__text">{UI_TEXT.NO_VIDEOS_FOUND}</div>

            <button
                className="no-videos-found__fetch-all-button"
                onClick={async () => {
                    try {
                        /// get number of the videos in the liked videos
                        const totalLikedVideos = await plugin?.likedVideoApi.fetchTotalLikedVideoCount();
                        new Notice(UI_TEXT.NOTICE_TOTAL_VIDEOS(totalLikedVideos ?? 0));

                        // repeat fetching liked videos
                        // this works based on nextPageToken. If the fetched result has nextPageToken, fetch the next page.
                        // If the fetched result has no nextPageToken, that means we have fetched all the liked videos.
                        // Then, merge the fetched videos data and save to LocalStorage.
                        let allLikedVideos: YouTubeVideo[] = [];
                        let nextPageToken: string | undefined = undefined;

                        do {
                            const response: YouTubeVideosResponse | undefined = await plugin?.likedVideoApi.fetchLikedVideos(plugin?.settings.fullFetchLimit, nextPageToken);
                            allLikedVideos = allLikedVideos.concat(response?.items || []);
                            if (response?.nextPageToken === undefined || response?.nextPageToken === '' || response?.nextPageToken === null) {
                                break;
                            } else {
                                nextPageToken = response?.nextPageToken;
                            }
                        } while (nextPageToken !== undefined);

                        // Save the fetched videos to LocalStorage
                        localStorageService.setLikedVideos(allLikedVideos);
                        setVideos(allLikedVideos);

                        new Notice(UI_TEXT.NOTICE_ALL_VIDEOS_SAVED(allLikedVideos.length));

                    } catch (error) {
                        if (plugin?.app) {
                            new Modal(plugin?.app).setTitle(UI_TEXT.ERROR_TITLE).setContent(UI_TEXT.ERROR_MESSAGE(error)).open();
                        }
                    }
                }}
            >
                {UI_TEXT.BTN_FETCH_ALL}
            </button>
        </div>}
        {/* Videos */}
        <div className="video-view__video-grid">
            {currentVideos.map((video) => (
                <VideoCard
                    key={video.id}
                    id={video.id}
                    url={`https://www.youtube.com/watch?v=${video.id}`}
                    videoInfo={video}
                    onUnlike={async () => {
                        await plugin?.likedVideoApi.unlikeVideo(video.id);
                        localStorageService.setLikedVideos(videos.filter(v => v.id !== video.id));
                        setVideos(videos.filter(v => v.id !== video.id));
                    }}
                    onAddToDailyNote={async (videoData, file) => {

                        const contentToAppend = `\n${videoData}`;

                        plugin?.app.vault.process(file,
                            (data) => {
                                return data + contentToAppend;
                            }
                        )
                    }}
                    onChannelClick={(channelTitle) => {
                        setSearchTerm(channelTitle);
                    }}
                />
            ))}
        </div>

        {/* Pagination */}
        <div className="video-view__pagination">
            <div className="video-view__pagination__controls">
                {currentPage > 1 && (
                    <>
                        <button onClick={() => setCurrentPage(1)}>
                            {UI_TEXT.PAGE_FIRST}
                        </button>
                        <button onClick={() => setCurrentPage(currentPage - 1)}>
                            {UI_TEXT.PAGE_PREV}
                        </button>
                    </>
                )}
            </div>
            <button disabled>
                {currentPage}
            </button>
            <div className="video-view__pagination__controls">
                {currentPage < totalPages && (
                    <>
                        <button type="button" onClick={() => setCurrentPage(currentPage + 1)}>
                            {UI_TEXT.PAGE_NEXT}
                        </button>
                        <button type="button" onClick={() => setCurrentPage(totalPages)}>
                            {UI_TEXT.PAGE_LAST}
                        </button>
                    </>
                )}
            </div>
        </div>
    </div >;
};