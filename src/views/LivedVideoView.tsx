import { Menu } from 'obsidian';
import { useContext, useEffect, useMemo, useState } from 'react';
import { VideosContext, usePlugin } from './LikedVideoListView';
import { setLikedVideos } from 'src/storage';

export const SearchBar: React.FC<{ searchTerm: string, onSearchTermChange: (searchTerm: string) => void }> = ({ searchTerm, onSearchTermChange }) => {
    return (
        <div style={{ position: "relative", width: "100%", marginBottom: "16px" }}>
            <input
                type="text"
                placeholder="Search videos..."
                value={searchTerm}
                onChange={(e) => onSearchTermChange(e.target.value)}
                style={{
                    width: "100%",
                    padding: "12px 20px",
                    borderRadius: "8px",
                    border: "1px solid #ddd",
                    fontSize: "16px",
                    outline: "none",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                    transition: "border-color 0.3s ease, box-shadow 0.3s ease",
                }}
                onFocus={(e) => {
                    e.target.style.borderColor = "#007BFF";
                    e.target.style.boxShadow = "0 2px 8px rgba(0, 123, 255, 0.2)";
                }}
                onBlur={(e) => {
                    e.target.style.borderColor = "#ddd";
                    e.target.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.1)";
                }}
            />
            {searchTerm && (
                <button
                    onClick={() => onSearchTermChange('')}
                    style={{
                        position: "absolute",
                        right: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "16px",
                        color: "#999",
                        borderRadius: "36px",
                        transition: "color 0.3s ease",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "#666"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "#999"}
                >
                    &#x2715;
                </button>
            )}
        </div>
    );
};

export const LikedVideoView: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOption, setSortOption] = useState('addedDate');
    const [sortOrder, setSortOrder] = useState('ASC');
    const [videos, setVideos] = useContext(VideosContext);
    const plugin = usePlugin();
    const videosPerPage = 10;

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
            case 'date':
                sorted.sort((a, b) => new Date(b.snippet.publishedAt).getTime() - new Date(a.snippet.publishedAt).getTime());
                break;
            case 'addedDate':
                sorted.sort((a, b) => videos.indexOf(a) - videos.indexOf(b));
                break;
        }
        if (sortOrder === 'DESC') {
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
        <h1 style={{
            fontSize: "24px", fontWeight: "bold", marginBottom: "16px",
        }}>My Liked Videos</h1>
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
interface VideoCardProps {
    id: string;
    title: string;
    channel: string;
    date: string;
    pulledAt: string;
    thumbnail: string;
    url: string;
    tags: string[];
    onUnlike: () => void;
}
const VideoCard = (prop: VideoCardProps) => {


    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/plain', `\n[${prop.title}](${prop.url})\n`);
        e.currentTarget.style.opacity = "0.5";
        e.currentTarget.style.border = "2px dashed #000";
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('dragging');
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.border = "1px solid black";
    };

    return (
        <div
            className="video-card"
            style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                display: "flex",
                gap: "4px",
                cursor: "pointer",
                transition: "background-color 0.3s ease",
                boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)"

            }}
            onClick={() => {
                window.open(prop.url, '_blank');
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f0f0f0"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
            onContextMenu={(e) => {
                e.preventDefault();
                e.currentTarget.style.backgroundColor = "transparent";
                const menu = new Menu();
                menu.addItem(item => {
                    item.setTitle("Open in new tab");
                    item.setIcon("create-new")
                    item.onClick(() => {
                        window.open(prop.url, '_blank');
                    });
                });

                menu.addItem(item => {
                    item.setTitle("Unlike");
                    item.setIcon("heart-off")
                    item.onClick(() => {
                        prop.onUnlike();
                    });
                });

                menu.addItem(item => {
                    item.setTitle("Add to Daily Note");
                    item.onClick(() => {
                    });

                });
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            }}
            draggable
            onDragStart={(e) => handleDragStart(e)}
            onDragEnd={(e) => handleDragEnd(e)}

        >
            <div style={{
                display: "flex", gap: "16px",
                marginBlockStart: "0px", marginBlockEnd: "0px",
            }}>
                <img className="video-thumbnail" style={{
                    borderRadius: "4px",
                    width: "180px", // Set a consistent width for all thumbnails
                    height: "auto",
                }} src={prop.thumbnail} alt="Video Thumbnail" />
                <div className="video-details" style={{
                    flex: "1",
                    display: "flex", flexDirection: "column", gap: "4px"
                }}>
                    <h2 className="video-title"
                        style={{
                            marginBlockStart: "0px",
                            color: "#d4a769",
                            fontSize: "18px",
                            marginBlockEnd: "0px",
                        }}
                    >{prop.title}</h2>
                    <p className="video-channel"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                            fontSize: "14px",
                            color: "#333",
                        }}>Channel: {prop.channel}</p>
                    <p className="video-date"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                            fontSize: "14px",
                            color: "#333",
                        }}>Published: {prop.date}</p>
                    <div className="video-tags" style={{
                        display: "flex", flexWrap: "wrap",
                        fontSize: "14px",
                        color: "#333",
                    }}>
                        {prop.tags?.slice(0, 8).map((tag) => <span key={tag} style={{
                            padding: "2px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            margin: "1px",
                            border: "1px solid gray"
                        }}>{tag}</span>)}
                        {prop.tags && prop.tags.length > 10 && <span style={{
                            padding: "2px",
                            fontSize: "12px",
                            margin: "1px",
                        }}>& more</span>}
                    </div>
                    <p className="video-pulled-at"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                            fontSize: "10px",
                            alignSelf: "flex-end",
                            color: "#777",
                        }}>Pulled At {new Date(prop.pulledAt).toLocaleDateString()}</p>
                </div>
            </div>
        </div >
    );
};
