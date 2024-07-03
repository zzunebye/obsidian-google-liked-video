import { Menu, MenuItem } from 'obsidian';
import { useEffect, useMemo, useState } from 'react';
import { YouTubeVideo } from 'src/types';

interface LikedVideoViewProps {
    videos: YouTubeVideo[];
}
export const LikedVideoView: React.FC<LikedVideoViewProps> = (
    { videos }
) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const videosPerPage = 10;

    const filteredVideos = useMemo(() => {
        return videos.filter(video => {
            const titleMatch = video.snippet.title.toLowerCase().includes(searchTerm.toLowerCase());
            const tagsMatch = (video.snippet.tags ?? []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
            return titleMatch || tagsMatch;
        });
    }, [videos, searchTerm]);

    const totalPages = Math.ceil(filteredVideos.length / videosPerPage);
    const startIndex = (currentPage - 1) * videosPerPage;
    const endIndex = startIndex + videosPerPage;

    const currentVideos = useMemo(() => {
        return filteredVideos.slice(startIndex, endIndex);
    }, [filteredVideos, startIndex, endIndex]);

    // Reset currentPage to 1 when searchTerm changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

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
                padding: "8px",
                marginBottom: "16px",
                borderRadius: "4px",
                border: "1px solid #ccc"
            }}
        />
        <div>
            {/* show the number of videos */}
            <span>{filteredVideos.length} videos</span>
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
                    title={video.snippet.title}
                    channel={video.snippet.channelTitle}
                    date={new Date(video.snippet.publishedAt).toLocaleDateString()}
                    thumbnail={video.snippet.thumbnails.default.url}
                    url={`https://www.youtube.com/watch?v=${video.id}`}
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
    title: string;
    channel: string;
    date: string;
    thumbnail: string;
    url: string;
    tags: string[];
}
const VideoCard = ({ title, channel, date, thumbnail, url, tags }: VideoCardProps) => {


    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/plain', url);
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
                border: "1px solid black",
                borderRadius: "8px",
                padding: "8px",
                display: "flex",
                gap: "4px",
                cursor: "pointer",
                transition: "background-color 0.3s ease",
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
                    item.setTitle("Add to Daily Note");
                    item.onClick(() => {
                    });

                });
                menu.showAtPosition({ x: e.clientX, y: e.clientY });

                // show Obsidian Context Menu
                // const obsidianContextMenu = new ObsidianContextMenu();
                // obsidianContextMenu.show(e.clientX, e.clientY);
            }}
            draggable
            onDragStart={(e) => handleDragStart(e)}
            onDragEnd={(e) => handleDragEnd(e)}

        >
            <div style={{
                display: "flex", gap: "8px",
                marginBlockStart: "0px",
                marginBlockEnd: "0px",
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
                    <h3 className="video-title"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                        }}
                    >{title}</h3>
                    <p className="video-channel"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                        }}>Channel: {channel}</p>
                    <p className="video-date"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                        }}>Published: {date}</p>
                    <div className="video-tags" style={{ display: "flex", flexWrap: "wrap" }}>
                        {tags?.map((tag) => <span key={tag} style={{
                            padding: "2px",
                            fontSize: "12px",
                            borderRadius: "4px",
                            margin: "1px",
                            border: "1px solid gray"
                        }}>{tag}</span>)}
                    </div>
                </div>
            </div>
        </div>
    );
};
