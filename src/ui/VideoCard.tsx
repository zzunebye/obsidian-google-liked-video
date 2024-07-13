import { Menu, Modal, Plugin, TFile, moment } from "obsidian";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { MoreHorizontal } from "lucide-react";
import { YouTubeVideo } from "src/types";

interface VideoCardProps {
    videoInfo: YouTubeVideo;
    id: string;
    url: string;
    onUnlike: () => void;
    onAddToDailyNote: (videoData: string, file: TFile) => void;
}
export const VideoCard = ({ videoInfo, url, onUnlike, onAddToDailyNote }: VideoCardProps) => {
    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/plain', `\n[${videoInfo.snippet.title}](${url})\n`);
        e.currentTarget.style.opacity = "0.5";
        e.currentTarget.style.border = "2px dashed #000";
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('dragging');
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.border = "1px solid black";
    };

    const handleContextMenu = (e: any): void => {
        e.preventDefault();
        e.stopPropagation();
        const menu = new Menu();
        menu.addItem(item => {
            item.setTitle("Open in external browser");
            item.setIcon("create-new")
            item.onClick(() => {
                window.open(url, '_blank');
            });
        });

        menu.addItem(item => {
            item.setTitle("Unlike");
            item.setIcon("heart-off")
            item.onClick(() => {
                onUnlike();
            });
        });

        menu.addItem(item => {
            item.setTitle("Add to Daily Note");
            item.onClick(() => {
                // find a daily note and add the video to the daily note
                // create a new daily note if it doesn't exist
                const today = moment().startOf('day');
                const dailyNotes = getAllDailyNotes();
                const dailyNote = getDailyNote(today, dailyNotes);

                const videoData = `- [${videoInfo.snippet.title}](${url}) - ${videoInfo.snippet.channelTitle}`;
                onAddToDailyNote(videoData, dailyNote);

            });

        });

        menu.addItem(item => {
            item.setTitle("Display Video Info");
            item.onClick(() => {
                const modal = document.createElement('div');
                modal.style.position = 'fixed';
                modal.style.top = '0';
                modal.style.left = '0';
                modal.style.width = '100%';
                modal.style.height = '100%';
                modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                modal.style.display = 'flex';
                modal.style.justifyContent = 'center';
                modal.style.alignItems = 'center';
                modal.style.zIndex = '1000';

                const modalContentWrapper = document.createElement('div');
                modalContentWrapper.style.backgroundColor = 'white';
                modalContentWrapper.style.padding = '20px';
                modalContentWrapper.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
                modalContentWrapper.style.maxHeight = '90%';
                modalContentWrapper.style.maxWidth = '90%';
                modalContentWrapper.style.overflowY = 'auto';
                modalContentWrapper.style.position = 'relative';
                modalContentWrapper.style.border = '1px solid var(--background-modifier-border)';
                modalContentWrapper.style.borderRadius = '16px';

                const closeButton = document.createElement('button');
                closeButton.innerText = 'X';
                closeButton.style.position = 'absolute';
                closeButton.style.top = '10px';
                closeButton.style.right = '10px';

                closeButton.onclick = () => {
                    document.body.removeChild(modal);
                };
                modalContentWrapper.appendChild(closeButton);

                const modalTitle = document.createElement('h2');
                modalTitle.innerText = 'Video Info';
                modalContentWrapper.appendChild(modalTitle);

                const modalContent = document.createElement('div');
                modalContent.style.display = 'grid';
                modalContent.style.gridTemplateColumns = '1fr 2fr'; // More space for right pane
                modalContent.style.gap = '20px'; // Increased gap for better readability
                modalContent.style.padding = '20px'; // Added padding for better spacing

                Object.entries(videoInfo.snippet).forEach(([key, value]) => {
                    if (key === 'thumbnails') return; // Exclude thumbnails
                    if (key === 'localized') return; // Exclude localized
                    if (key === 'tags' && Array.isArray(value)) value = value.join(', ');
                    // tidy up tags

                    const keyElement = document.createElement('div');
                    keyElement.style.fontWeight = 'bold';
                    keyElement.style.textTransform = 'capitalize';
                    keyElement.style.fontSize = '16px'; // Increased font size for better readability
                    keyElement.style.color = '#333'; // Darker color for better contrast
                    keyElement.innerText = key.replace(/([A-Z])/g, ' $1').trim() + ':';

                    const valueElement = document.createElement('div');
                    valueElement.style.fontSize = '16px'; // Increased font size for better readability
                    valueElement.style.color = '#555'; // Slightly lighter color for better contrast
                    valueElement.innerText = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;

                    modalContent.appendChild(keyElement);
                    modalContent.appendChild(valueElement);
                });
                modalContentWrapper.appendChild(modalContent);

                modal.appendChild(modalContentWrapper);
                document.body.appendChild(modal);

                // Close modal if user clicks outside modalContentWrapper
                modal.addEventListener('click', (event) => {
                    if (event.target === modal) {
                        document.body.removeChild(modal);
                    }
                });

                // Close modal if user presses esc key
                const handleKeydown = (event: { key: string; keyCode: number; }) => {
                    if (event.key === 'Escape' || event.key === "Esc" || event.keyCode === 27) {
                        if (document.body.contains(modal)) {
                            document.body.removeChild(modal);
                        }
                        window.removeEventListener('keydown', handleKeydown);
                    }
                };

                window.addEventListener('keydown', handleKeydown);
            });
        });

        menu.showAtPosition({ x: e.clientX, y: e.clientY });
    }

    return (
        <div
            className="video-card__container"
            onClick={() => {
                window.open(url, '_blank');
            }}
            onContextMenu={handleContextMenu}
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
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}>
                <img className="video-thumbnail" style={{
                    borderRadius: "4px",
                    minWidth: "180px", // Set a consistent width for all thumbnails
                    height: "auto",
                }} src={videoInfo.snippet.thumbnails.default.url} alt="Video Thumbnail" />
                <div className="video-details" style={{
                    flex: "1",
                    display: "flex", flexDirection: "column", gap: "4px",
                    padding: "4px",
                    justifyContent: "space-between",
                    overflow: "hidden",
                }}>
                    <div
                        style={{
                            display: "flex", flexDirection: "column", gap: "4px",
                        }}
                    >
                        <h2 className="video-title" style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}>{videoInfo.snippet.title}</h2>
                        <p className="video-channel">Channel: {videoInfo.snippet.channelTitle}</p>
                        <p className="video-date">Published: {videoInfo.snippet.publishedAt}</p>
                        </div> */}
                    </div>
                    <p className="video-pulled-at"
                        style={{
                            marginBlockStart: "0px",
                            marginBlockEnd: "0px",
                            fontSize: "10px",
                            alignSelf: "flex-end",
                            color: "#777",
                        }}>Pulled At {new Date(videoInfo.pulled_at).toLocaleDateString()}</p>
                </div>
                <div className="video-card-options">
                    <div style={{ alignSelf: "flex-end", placeSelf: "flex-start" }}>
                        <button
                            aria-label="More options"
                            onClick={handleContextMenu}
                        >
                            <MoreHorizontal size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};
