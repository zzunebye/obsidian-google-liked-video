import { Menu, TFile, moment, Notice } from "obsidian";
import { getDailyNote, getAllDailyNotes } from "obsidian-daily-notes-interface";
import { MoreHorizontal, Eye, ThumbsUp, MessageCircle, ExternalLink } from "lucide-react";
import { YouTubeVideo } from "src/types";
import { VideoInfoModal, parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { confirmUnlikeAction } from "src/utils/confirmationUtils";
import { usePlugin } from "../store/pluginContext";
import { sanitizeFileName, generateVideoNoteContent, generateUniqueFileName } from "src/utils/noteUtils";

interface VideoCardProps {
    videoInfo: YouTubeVideo;
    id: string;
    url: string;
    onUnlike: () => void;
    onAddToDailyNote: (videoData: string, file: TFile) => void;
}
export const VideoCard = ({ videoInfo, url, onUnlike, onAddToDailyNote }: VideoCardProps) => {
    const plugin = usePlugin();

    // Format duration from seconds to display format
    const formatDuration = (duration: string | undefined): string => {
        if (!duration) return '';

        const seconds = parseDurationToSeconds(duration);
        if (seconds === null || seconds === 0) return '';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    // Utility function to format large numbers
    const formatCount = (count: number | string): string => {
        const num = typeof count === 'string' ? parseInt(count) : count;
        if (isNaN(num)) return '0';

        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/plain', `\n[${videoInfo.snippet.channelTitle} - ${videoInfo.snippet.title}](${url})\n`);
        e.currentTarget.classList.add('video-card__container--dragging'); // Add class
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.classList.remove('video-card__container--dragging');
    };

    const handleExternalOpen = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(url, '_blank');
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

        menu.addItem(item => {
            item.setTitle("Create note");
            item.setIcon("file-plus");
            item.onClick(async () => {
                try {
                    const baseFileName = sanitizeFileName(videoInfo.snippet.title);
                    const customPath = plugin?.settings?.videoNotePath || '';
                    const organizeByChannel = plugin?.settings?.organizeByChannel || false;
                    const channelName = videoInfo.snippet.channelTitle;

                    const fileName = await generateUniqueFileName(
                        plugin?.app || app,
                        baseFileName,
                        customPath,
                        organizeByChannel,
                        channelName
                    );

                    const noteContent = generateVideoNoteContent(
                        videoInfo,
                        url,
                        plugin?.getCategoryDisplay.bind(plugin)
                    );

                    const file = await (plugin?.app || app).vault.create(fileName, noteContent);

                    await (plugin?.app || app).workspace.openLinkText(file.path, '', true);

                    new Notice(`Created note: ${file.basename}`);
                } catch (error) {
                    console.error('Error creating video note:', error);
                    new Notice('Failed to create video note. Check console for details.');
                }
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
                <div className="video-thumbnail-wrapper">
                    <img className="video-thumbnail" loading="lazy" decoding="async" src={videoInfo.snippet.thumbnails.medium.url} alt="Video Thumbnail" />
                    {videoInfo.contentDetails?.duration && (
                        <span className="video-duration-badge">
                            {formatDuration(videoInfo.contentDetails.duration)}
                        </span>
                    )}
                </div>
                <div className="video-details" >
                    <div className="video-details-inner">
                        <h2 className="video-title">{videoInfo.snippet.title}</h2>
                        <p className="video-channel">Channel: {videoInfo.snippet.channelTitle}</p>
                        <p className="video-date">Published: {moment(videoInfo.snippet.publishedAt).format('MMM D, YYYY')}</p>
                    </div>
                    <div className="video-bottom-row">
                        <p className="video-pulled-at">Pulled At {new Date(videoInfo.pulled_at).toLocaleDateString()}</p>
                        <div className="video-statistics">
                            <div className="video-stat">
                                <Eye size={14} className="video-stat-icon" />
                                <span className="video-stat-count">{formatCount(videoInfo.statistics.viewCount)}</span>
                            </div>
                            <div className="video-stat">
                                <ThumbsUp size={14} className="video-stat-icon" />
                                <span className="video-stat-count">{formatCount(videoInfo.statistics.likeCount)}</span>
                            </div>
                            <div className="video-stat">
                                <MessageCircle size={14} className="video-stat-icon" />
                                <span className="video-stat-count">{formatCount(videoInfo.statistics.commentCount)}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="video-card-options">
                <button
                    className="video-card-btn"
                    aria-label="Open in Browser"
                    onClick={handleExternalOpen}
                    title="Open in External Browser"
                >
                    <ExternalLink size={16} />
                </button>
                <button
                    className="video-card-btn"
                    aria-label="More options"
                    onClick={handleContextMenu}
                >
                    <MoreHorizontal size={16} />
                </button>
            </div>
        </div>
    );
};
