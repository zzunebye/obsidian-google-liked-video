import { Menu, TFile, moment, Notice, App } from "obsidian";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { MoreHorizontal } from "lucide-react";
import { YouTubeVideo } from "src/types";
import { VideoInfoModal } from "src/ui/VideoInfoModal";
import { confirmUnlikeAction } from "src/utils/confirmationUtils";
import { usePlugin } from "../store/pluginContext";

interface VideoCardProps {
    videoInfo: YouTubeVideo;
    id: string;
    url: string;
    onUnlike: () => void;
    onAddToDailyNote: (videoData: string, file: TFile) => void;
}
export const VideoCard = ({ videoInfo, url, onUnlike, onAddToDailyNote }: VideoCardProps) => {
    const plugin = usePlugin();

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/plain', `\n[${videoInfo.snippet.channelTitle} - ${videoInfo.snippet.title}](${url})\n`);
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
            item.onClick(async () => {
                const confirmed = await confirmUnlikeAction(
                    plugin?.app || app,
                    videoInfo.snippet.title
                );

                if (confirmed) {
                    onUnlike();
                }
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
            item.setTitle("Add to current note");
            item.onClick(() => {
                // Get the currently active file
                const activeFile = app.workspace.getActiveFile();
                if (!activeFile) {
                    new Notice("No active note found. Please open a note first.");
                    return;
                }

                const videoData = `- [${videoInfo.snippet.title}](${url}) - ${videoInfo.snippet.channelTitle}`;

                // Append to the current note
                app.vault.process(activeFile, (data) => {
                    return data + '\n' + videoData;
                }).then(() => {
                    new Notice(`Added video to ${activeFile.basename}`);
                });
            });
        });

        menu.addItem(item => {
            item.setTitle("Display video info");
            item.onClick(() => {
                const modal = new VideoInfoModal(
                    plugin?.app || app,
                    videoInfo,
                    plugin?.getCategoryDisplay.bind(plugin)
                );
                modal.open();
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
                <img className="video-thumbnail" src={videoInfo.snippet.thumbnails.medium.url} alt="Video Thumbnail" />
                <div className="video-details" >
                    <div className="video-details-inner">
                        <h2 className="video-title">{videoInfo.snippet.title}</h2>
                        <p className="video-channel">Channel: {videoInfo.snippet.channelTitle}</p>
                        <p className="video-date">Published: {moment(videoInfo.snippet.publishedAt).format('MMM D, YYYY')}</p>
                    </div>
                    <p className="video-pulled-at">Pulled At {new Date(videoInfo.pulled_at).toLocaleDateString()}</p>
                </div>
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
