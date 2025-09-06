import { useContext, useEffect, useMemo, useState } from 'react';
import { usePlugin } from '../store/pluginContext';
import { localStorageService } from 'src/storage';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { Youtube, Settings, RefreshCcw } from 'lucide-react';
import { VideoCard } from 'src/ui/VideoCard';
import { SearchBar } from 'src/ui/SearchBar';
import { APP_ID } from 'src/main';
import { Modal, Notice } from 'obsidian';
import { VideosContext } from 'src/store/videoContext';
import { UI_TEXT } from 'src/constants/uiText';


export const LikedVideoView: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOption, setSortOption] = useState(localStorageService.getSortOption());
    const [sortOrder, setSortOrder] = useState(localStorageService.getSortOrder());
    const [videos, setVideos] = useContext(VideosContext);
    const plugin = usePlugin();
    const videosPerPage = 10;

    useEffect(() => {
        localStorageService.setSortOption(sortOption);
        localStorageService.setSortOrder(sortOrder);
    }, [sortOption, sortOrder]);

    const filteredVideos = useMemo(() => {
        return videos.filter(video => {
            const titleMatch = video.snippet.title.toLowerCase().includes(searchTerm.toLowerCase());
            const tagsMatch = (video.snippet.tags ?? []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
            return titleMatch || tagsMatch;
        });
    }, [videos, searchTerm]);

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
            case 'likeViewRatio':
                sorted.sort((a, b) => b.statistics.likeCount / b.statistics.viewCount - a.statistics.likeCount / a.statistics.viewCount);
                break;

            case 'date':
                sorted.sort((a, b) => new Date(b.snippet.publishedAt).getTime() - new Date(a.snippet.publishedAt).getTime());
                break;
            case 'addedDate':
                sorted.sort((a, b) => videos.indexOf(a) - videos.indexOf(b));
                break;
        }
        if (sortOrder === 'ASC') {
            sorted.reverse();
        }
        return sorted;
    }, [filteredVideos, sortOption, videos, sortOrder]);

    const totalPages = Math.ceil(sortedVideos.length / videosPerPage);
    const startIndex = (currentPage - 1) * videosPerPage;
    const endIndex = startIndex + videosPerPage;

    const currentVideos = useMemo(() => {
        return sortedVideos.slice(startIndex, endIndex);
    }, [sortedVideos, startIndex, endIndex]);

    // Reset currentPage to 1 when searchTerm or sortOption changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, sortOption]);

    return <div
        className="liked-video-view">
        <div className="video-view-header">
            <div className="video-view-header__title"><Youtube className="video-view-header__icon" /> {UI_TEXT.HEADER_TITLE}</div>
            <div className="video-view-header__actions">
                <button
                    title={UI_TEXT.BTN_REFRESH}
                    /// Refresh button to fetch recently liked videos
                    className="video-view-header__refresh-button"
                    onClick={async () => {
                        let allLikedVideos: YouTubeVideo[] = [];
                        let nextPageToken: string | undefined = undefined;

                        const limit = plugin?.settings.fetchLimit;

                        const response: YouTubeVideosResponse | undefined = await plugin?.likedVideoApi.fetchLikedVideos(limit, nextPageToken);
                        if (response) {
                            allLikedVideos = allLikedVideos.concat(response.items);
                            nextPageToken = response.nextPageToken;
                        }

                        const storedLikedVideos = localStorageService.getLikedVideos();
                        const storedLikedVideoIdsSet = new Set(storedLikedVideos.map(video => video.id));

                        const newLikedVideos = allLikedVideos.filter(video => !storedLikedVideoIdsSet.has(video.id));

                        const updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos];

                        // Batch state updates to avoid unnecessary re-renders
                        localStorageService.setLikedVideos(updatedLikedVideos);
                        setVideos(updatedLikedVideos);

                        new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(newLikedVideos.length));

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
                <p>{UI_TEXT.VIDEO_COUNT(filteredVideos.length)}</p>
            </div>
        </div>
        <div className="video-view-sort">
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
                <option value="likeViewRatio">{UI_TEXT.SORT_BY_LIKE_VIEW_RATIO}</option>
                <option value="date">{UI_TEXT.SORT_BY_PUBLISHED_DATE}</option>
                <option value="title">{UI_TEXT.SORT_BY_TITLE}</option>
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