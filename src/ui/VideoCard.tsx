import { Menu, TFile, moment } from "obsidian";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { MoreHorizontal } from "lucide-react";

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
    onAddToDailyNote: (videoData: string, file: TFile) => void;
}
export const VideoCard = (prop: VideoCardProps) => {
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
                border: "0.5px solid #ddd",
                borderRadius: "8px",
                padding: "8px",
                display: "flex",
                gap: "4px",
                cursor: "pointer",
                fontFamily: "Roboto",
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
                    item.setTitle("Open in external browser");
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
                        // find a daily note
                        // add the video to the daily note
                        // create a new daily note if it doesn't exist
                        // add the video to the daily note
                        const today = moment().startOf('day');
                        const dailyNotes = getAllDailyNotes();
                        const dailyNote = getDailyNote(today, dailyNotes);

                        const videoData = `- [${prop.title}](${prop.url}) - ${prop.channel}`;
                        prop.onAddToDailyNote(videoData, dailyNote);

                    });

                });
                menu.showAtPosition({ x: e.clientX, y: e.clientY });
            }}
            draggable
            onDragStart={(e) => handleDragStart(e)}
            onDragEnd={(e) => handleDragEnd(e)}

        >
            <div
                className="video-card-inner"
                style={{
                    display: "flex",
                    position: "relative",
                    gap: "16px",
                    width: "100%",
                    marginBlockStart: "0px",
                    marginBlockEnd: "0px",
                }}>
                <img className="video-thumbnail" style={{
                    borderRadius: "4px",
                    width: "180px", // Set a consistent width for all thumbnails
                    height: "auto",
                }} src={prop.thumbnail} alt="Video Thumbnail" />
                <div className="video-details" style={{
                    flex: "1",
                    display: "flex", flexDirection: "column", gap: "4px",
                    padding: "4px",
                    justifyContent: "space-between"
                }}>
                    <div
                        style={{
                            display: "flex", flexDirection: "column", gap: "4px",
                        }}
                    >
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
                        {/* <div className="video-tags" style={{
                            display: "flex",
                            flexWrap: "wrap",
                            fontSize: "14px",
                            color: "#333",
                            maxHeight: "50px", // Limit to two lines
                            overflow: "clip",
                        }}>
                            {prop.tags?.slice(0, 4).map((tag) => {
                                const maxLength = 18;
                                const displayTag = tag.length > maxLength ? `${tag.slice(0, maxLength)}...` : tag;
                                return <span key={tag} style={{
                                    padding: "2px",
                                    fontSize: "12px",
                                    borderRadius: "4px",
                                    margin: "1px",
                                    border: "1px solid gray",
                                }}>{displayTag}</span>;
                            })}
                            {prop.tags && prop.tags.length > 10 && <span style={{
                                padding: "2px",
                                fontSize: "12px",
                                margin: "1px",
                            }}>& more</span>}
                        </div> */}
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
                <div
                    className="video-card-options"
                    style={{
                        position: "absolute",
                        right: "0",
                        top: "0",
                    }}
                >
                    <div style={{ alignSelf: "flex-end", placeSelf: "flex-start" }}>
                        <button
                            style={{
                                background: "none",
                                // border: "none",
                                cursor: "pointer",
                                padding: "0",
                                margin: "0",
                                borderRadius: "50%", // Circular border
                                width: "32px", // Set width
                                height: "32px", // Set height
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1px solid #ddd" // Optional: Add border
                            }}
                            aria-label="More options"
                        >
                            <MoreHorizontal size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};
