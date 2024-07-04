import { Menu, MenuItem } from 'obsidian';
import { useEffect, useMemo, useState } from 'react';
import { YouTubeVideo } from 'src/types';
import { useVideos } from './LikedVideoListView';

export const LikedVideoView: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [sortOption, setSortOption] = useState('addedDate');
    const videos = useVideos();
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
        return sorted;
    }, [filteredVideos, sortOption, videos]);

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
        }}>Liked Videos</h1>
        <input
            type="text"
            placeholder="Search videos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
                width: "100%",
                padding: "12px 20px",
                marginBottom: "16px",
                borderRadius: "16px",
                border: "1px solid #ccc",
                // boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                fontSize: "16px",
                outline: "none",
                // transition: "border-color 0.3s ease-in-out"
            }}
            onFocus={(e) => e.target.style.borderColor = "#007BFF"}
            onBlur={(e) => e.target.style.borderColor = "#ccc"}
        />
        <div>
            {/* show the number of videos */}
            <span>{filteredVideos.length} videos</span>
        </div>
        <div style={{ marginTop: "16px" }}>
            <span>Sorting by: </span>
            <select
                aria-label="Sort videos"
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                style={{
                    padding: "8px",
                    borderRadius: "4px",
                    border: "1px solid #ccc"
                }}
            >
                <option value="addedDate">Added Date</option>
                <option value="viewCount">View Count</option>
                <option value="date">Date</option>
                <option value="title">Title</option>
            </select>
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
}
const VideoCard = ({ id, title, channel, date, pulledAt, thumbnail, url, tags }: VideoCardProps) => {


    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/plain', `\n[${title}](${url})\n`);
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
                window.open(url, '_blank');
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
                        window.open(url, '_blank');
                    });
                });

                menu.addItem(item => {
                    item.setTitle("Unlike");
                    item.setIcon("heart-off")
                    item.onClick(() => {
                        api.unlikeVideo(id);
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
                }} src={thumbnail} alt="Video Thumbnail" />
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
                    >{title}</h2>
                    <p className="video-channel"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                            fontSize: "14px",
                            color: "#333",
                        }}>Channel: {channel}</p>
                    <p className="video-date"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                            fontSize: "14px",
                            color: "#333",
                        }}>Published: {date}</p>
                    <div className="video-tags" style={{
                        display: "flex", flexWrap: "wrap",
                        fontSize: "14px",
                        color: "#333",
                    }}>
                        {tags?.slice(0, 8).map((tag) => <span key={tag} style={{
                            padding: "2px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            margin: "1px",
                            border: "1px solid gray"
                        }}>{tag}</span>)}
                        {tags && tags.length > 10 && <span style={{
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
                        }}>Pulled At {new Date(pulledAt).toLocaleDateString()}</p>
                </div>
            </div>
        </div >
    );
};
