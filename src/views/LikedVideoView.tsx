import { useContext, useEffect, useMemo, useState } from 'react';
import { VideosContext, usePlugin } from './LikedVideoListView';
import { localStorageService, setLikedVideos } from 'src/storage';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { Youtube } from 'lucide-react';
import { VideoCard } from 'src/ui/VideoCard';
import { SearchBar } from 'src/ui/SearchBar';


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

    return <div>
        <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "16px"
        }}>
            <div className="liked-videos-view__title">My Liked Videos <Youtube style={{ width: "1.5em", height: "1.5em" }} /></div>

            <button
                onClick={async () => {
                    let allLikedVideos: YouTubeVideo[] = [];
                    let nextPageToken: string | undefined = undefined;
                    const response: YouTubeVideosResponse | undefined = await plugin?.likedVideoApi.fetchLikedVideos(20, nextPageToken);
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
                }}
                style={{
                    padding: "4px",
                    borderRadius: "4px",
                }}
            >Refresh 🔃</button>
        </div>
        <SearchBar
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
        />
        <div>
            {/* show the number of videos */}
            <span>{filteredVideos.length} videos</span>
        </div>
        <div style={{ marginTop: "16px", display: "flex", alignItems: "center" }}>
            <span style={{ marginRight: "8px" }}>Sort by: </span>
            <select
                aria-label="Sort videos"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                style={{
                    padding: "4px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                }}
            >
                <option value="addedDate">By Liked Date</option>
                <option value="viewCount">By View Count</option>
                <option value="likeCount">By Like Count</option>
                <option value="likeViewRatio">By Like/View Ratio</option>
                <option value="date">By Date</option>
                <option value="title">By Title</option>
            </select>
            <button
                onClick={() => setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC')}
                style={{
                    marginLeft: "8px",
                    padding: "4px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                    backgroundColor: sortOrder === 'ASC' ? '#f0f0f0' : '#d0d0d0',
                }}
                aria-label="Toggle sort order"
            >
                {sortOrder === 'ASC' ? '🔼' : '🔽'}
            </button>
        </div>

        {/* Videos */}
        <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            paddingTop: "16px",
            paddingBottom: "16px"
        }}>
            {currentVideos.map((video) => (
                <VideoCard
                    key={video.id}
                    id={video.id}
                    title={video.snippet.title}
                    channel={video.snippet.channelTitle}
                    date={new Date(video.snippet.publishedAt).toLocaleDateString()}
                    thumbnail={video.snippet.thumbnails.default.url}
                    url={`https://www.youtube.com/watch?v=${video.id}`}
                    pulledAt={video.pulled_at}
                    tags={video.snippet.tags}
                    onUnlike={async () => {
                        await plugin?.likedVideoApi.unlikeVideo(video.id);
                        setLikedVideos(videos.filter(v => v.id !== video.id));
                        setVideos(videos.filter(v => v.id !== video.id));
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
    </div>;
};