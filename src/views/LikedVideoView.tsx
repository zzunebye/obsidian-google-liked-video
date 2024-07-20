import { useContext, useEffect, useMemo, useState } from 'react';
import { VideosContext, usePlugin } from './LikedVideoListPane';
import { localStorageService, setLikedVideos } from 'src/storage';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { Youtube, Settings, RefreshCcw } from 'lucide-react';
import { VideoCard } from 'src/ui/VideoCard';
import { SearchBar } from 'src/ui/SearchBar';
import { APP_ID } from 'src/main';
import { Modal, Notice } from 'obsidian';


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
            <div className="video-view-header__title"><Youtube style={{ width: "1.5em", height: "1.5em" }} /> My Liked videos</div>
            <div className="video-view-header__actions">
                <button
                    style={{ paddingLeft: "24px", paddingRight: "24px" }}
                    /// Refresh button to fetch recently liked videos
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
                        setLikedVideos(updatedLikedVideos);
                        setVideos(updatedLikedVideos);

                        new Notice(`New liked videos from Youtube are fetched and added - ${newLikedVideos.length} new videos.`);

                    }}
                ><RefreshCcw size={16} /></button>
                <button
                    title="Settings"
                    onClick={() => {
                        // Open Plugin Setting.
                        const setting = (plugin?.app as any).setting;
                        setting.open();
                        setting.openTabById(APP_ID);
                    }}
                ><Settings size={16} /></button>
            </div>
        </div>
        <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: "8px",
            marginBottom: "8px"
        }}>
            <div style={{ flex: "1" }}>
                <SearchBar
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                />
            </div>
            <div style={{
                fontSize: "16px", color: "#555",
                width: "96px"
            }}>
                <p>{filteredVideos.length} videos</p>
            </div>
        </div>
        <div className="video-view-sort">
            <label htmlFor="sort-video-select">Sort by:</label>
            <select
                id="sort-video-select"
                className="video-view-sort__select"
                aria-label="Sort videos"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
            >
                <option value="addedDate">By Liked Date</option>
                <option value="viewCount">By View Count</option>
                <option value="likeCount">By Like Count</option>
                <option value="likeViewRatio">By Like/View Ratio</option>
                <option value="date">By Posted Date</option>
                <option value="title">By Title</option>
            </select>
            <button
                title="Toggle sort order"
                onClick={() => setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC')}
                className="video-view-sort__order"
                aria-label="Toggle sort order"
            >
                {sortOrder === 'ASC' ? '🔼' : '🔽'}
            </button>
        </div>
        {currentVideos.length === 0 && <div
            style={{
                display: "flex",
                paddingTop: "32px",
                flex: "1",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                height: "100%"
            }}
        >
            <div
                style={{
                    fontSize: "16px", color: "#555"
                }}
            >No videos found
            </div>
            <button
                onClick={async () => {
                    try {
                        /// get number of the videos in the liked videos
                        const totalLikedVideos = await plugin?.likedVideoApi.fetchTotalLikedVideoCount();
                        new Notice(`${totalLikedVideos} videos in total`);

                        // repeat fetching liked videos
                        // this works based on nextPageToken. If the fetched result has nextPageToken, fetch the next page.
                        // If the fetched result has no nextPageToken, that means we have fetched all the liked videos.
                        // Then, merge the fetched videos data and save to LocalStorage.
                        let allLikedVideos: YouTubeVideo[] = [];
                        let nextPageToken: string | undefined = undefined;

                        do {
                            const response: YouTubeVideosResponse | undefined = await plugin?.likedVideoApi.fetchLikedVideos(50, nextPageToken);
                            allLikedVideos = allLikedVideos.concat(response?.items || []);
                            if (response?.nextPageToken === undefined || response?.nextPageToken === '' || response?.nextPageToken === null) {
                                break;
                            } else {
                                nextPageToken = response?.nextPageToken;
                            }
                        } while (nextPageToken !== undefined);

                        // Save the fetched videos to LocalStorage
                        setLikedVideos(allLikedVideos);
                        setVideos(allLikedVideos);

                        new Notice(`All liked videos have been fetched and saved to LocalStorage - ${allLikedVideos.length} videos`);

                    } catch (error) {
                        if (plugin?.app) {
                            new Modal(plugin?.app).setTitle('error').setContent("error: " + error).open();
                        }
                    }
                }}
                style={{
                    padding: "8px 16px",
                    fontSize: "16px",
                    cursor: "pointer",
                    backgroundColor: "#007bff",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    marginTop: "16px"
                }}
            >
                Fetch all liked videos
            </button>
        </div>}
        {/* Videos */}
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(500px, 1fr))",
            gridAutoRows: "1fr",
            gridTemplateRows: "repeat(2, 1fr)",
            gap: "16px",
            paddingTop: "16px",
            paddingBottom: "16px"
        }}>

            {currentVideos.map((video) => (
                <VideoCard
                    key={video.id}
                    id={video.id}
                    url={`https://www.youtube.com/watch?v=${video.id}`}
                    videoInfo={video}
                    onUnlike={async () => {
                        await plugin?.likedVideoApi.unlikeVideo(video.id);
                        setLikedVideos(videos.filter(v => v.id !== video.id));
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
        <div style={{
            display: "flex",
            justifyContent: "center",
            gap: "8px",
            marginTop: "16px"
        }}>
            <div style={{ minWidth: "80px", textAlign: "center" }}>
                {currentPage > 1 && (
                    <>
                        <button onClick={() => setCurrentPage(1)}>
                            &lt;--
                        </button>
                        <button onClick={() => setCurrentPage(currentPage - 1)}>
                            &lt;-
                        </button>
                    </>
                )}
            </div>
            <button disabled>
                {currentPage}
            </button>
            <div style={{ minWidth: "80px", textAlign: "center" }}>
                {currentPage < totalPages && (
                    <>
                        <button onClick={() => setCurrentPage(currentPage + 1)}>
                            -&gt;
                        </button>
                        <button onClick={() => setCurrentPage(totalPages)}>
                            --&gt;
                        </button>
                    </>
                )}
            </div>
        </div>
    </div >;
};