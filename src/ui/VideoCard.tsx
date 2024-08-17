import { Menu, TFile, moment } from "obsidian";
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
        e.currentTarget.classList.add('video-card__container--dragging'); // Add class
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('video-card__container--dragging');
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
            item.setTitle("Add to daily note");
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
            item.setTitle("Display video info");
            item.onClick(() => {
                const modal = document.createElement('div');
                modal.className = 'geulo-modal__overlay';

                const modalContentWrapper = document.createElement('div');
                modalContentWrapper.className = 'geulo-modal__content-wrapper';

                const closeButton = document.createElement('button');
                closeButton.innerText = 'X';
                closeButton.className = 'geulo-modal__close-button';

                closeButton.onclick = () => {
                    document.body.removeChild(modal);
                };
                modalContentWrapper.appendChild(closeButton);

                const modalTitle = document.createElement('h2');
                modalTitle.innerText = 'Video Info';
                modalContentWrapper.appendChild(modalTitle);

                const modalContent = document.createElement('div');
                modalContent.className = 'geulo-modal__content';

                Object.entries(videoInfo.snippet).forEach(([key, value]) => {
                    if (key === 'thumbnails') return; // Exclude thumbnails
                    if (key === 'localized') return; // Exclude localized
                    if (key === 'tags' && Array.isArray(value)) value = value.join(', ');
                    // tidy up tags

                    const labelElement = document.createElement('div');
                    labelElement.className = 'geulo-modal__key';
                    labelElement.innerText = key.replace(/([A-Z])/g, ' $1').trim() + ':';

                    const infoValueElement = document.createElement('div');
                    infoValueElement.className = 'geulo-modal__value';
                    infoValueElement.innerText = typeof value === 'object' ? JSON.stringify(value, null, 2) : value;

                    modalContent.appendChild(labelElement);
                    modalContent.appendChild(infoValueElement);
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

            >
                <img className="video-thumbnail" src={videoInfo.snippet.thumbnails.default.url} alt="Video Thumbnail" />
                <div className="video-details" >
                    <div className="video-details-inner">
                        <h2 className="video-title">{videoInfo.snippet.title}</h2>
                        <p className="video-channel">Channel: {videoInfo.snippet.channelTitle}</p>
                        <p className="video-date">Published: {videoInfo.snippet.publishedAt}</p>
                    </div>
                </div>
                <p className="video-pulled-at">Pulled At {new Date(videoInfo.pulled_at).toLocaleDateString()}</p>
            </div>
            <div className="video-card-options">
                <div>
                    <button
                        aria-label="More options"
                        onClick={handleContextMenu}
                    >
                        <MoreHorizontal size={16} />
                    </button>
                </div>
            </div>
        </div >
    );
};
