import { useCallback, useState, useSyncExternalStore } from "react";
import { Menu, TFile, moment, Notice } from "obsidian";
import {
	getDailyNote,
	getAllDailyNotes,
	createDailyNote,
} from "obsidian-daily-notes-interface";
import {
	MoreHorizontal,
	Eye,
	ThumbsUp,
	MessageCircle,
	FilePlus,
	FileCheck,
	Bot,
	Check,
	Captions,
} from "lucide-react";
import { YouTubeVideo } from "src/types";
import { saveSummaryToNote } from "src/services/summaryNoteService";
import { VideoInfoModal } from "src/ui/VideoInfoModal";
import { usePlugin } from "../store/pluginContext";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { SummarySection } from "./SummarySection";
import type { SummarySnapshot } from "./SummarySection";
import { ResponsiveVideoTags } from "./VideoTags";
import { debugLogger } from "../debug";
import { VideoCommentsModal } from "./VideoCommentsModal";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { useTranscriptWorkspace } from "./TranscriptWorkspace";
import { formatVideoCount, formatVideoDuration } from "src/utils/videoUtils";
import type { TranscriptReaderMode } from "src/utils/transcriptUtils";

interface VideoCardProps {
	source: "liked" | "playlist" | "subscription";
	videoInfo: YouTubeVideo;
	sortMetric?: {
		kind: "averageViewsPerDay" | "likeViewRatio";
		value: number | null;
	};
	id: string;
	url: string;
	noteExists: boolean;
	likeActionPending?: boolean;
	isLiked?: boolean;
	onUnlike: () => void;
	onLike?: () => void;
	unsubscribeActionPending?: boolean;
	onUnsubscribeChannel?: () => void;
	onAddToDailyNote: (videoData: string, file: TFile) => Promise<void>;
	onChannelClick: (channelTitle: string, channelId: string) => void;
	onTagClick: (tag: string) => void;
	onLinkClick: (url: string) => void;
	summaryExpanded?: boolean;
	onSummaryExpandedChange?: (expanded: boolean) => void;
	onSummaryBusyChange?: (busy: boolean) => void;
	summarySnapshot?: SummarySnapshot;
	onSummarySnapshotChange?: (snapshot: SummarySnapshot) => void;
}

export const VideoCard = ({
	source,
	videoInfo,
	sortMetric,
	url,
	noteExists,
	likeActionPending = false,
	isLiked,
	onUnlike,
	onLike,
	unsubscribeActionPending = false,
	onUnsubscribeChannel,
	onAddToDailyNote,
	onChannelClick,
	onTagClick,
	onLinkClick,
	summaryExpanded,
	onSummaryExpandedChange,
	onSummaryBusyChange,
	summarySnapshot,
	onSummarySnapshotChange,
}: VideoCardProps) => {
	const plugin = usePlugin();
	const transcriptWorkspace = useTranscriptWorkspace();
	const isAIEnabled = plugin.settings?.enableAISummary ?? false;
	const showVideoTags = plugin.settings?.showVideoTags ?? true;
	const [localSummaryExpanded, setLocalSummaryExpanded] = useState(false);
	const isSummaryExpanded = summaryExpanded ?? localSummaryExpanded;
	const setIsSummaryExpanded = (expanded: boolean) => {
		if (onSummaryExpandedChange) onSummaryExpandedChange(expanded);
		else setLocalSummaryExpanded(expanded);
	};
	const subscribeToSummaries = useCallback(
		(listener: () => void) => plugin.summaryStorage.subscribe(listener),
		[plugin],
	);
	const summaryPreview = useSyncExternalStore(
		subscribeToSummaries,
		() => plugin.summaryStorage.getOneLineSummary(videoInfo.id),
	);
	const hasSummary = summaryPreview !== null;
	const isAverageViews = sortMetric?.kind === "averageViewsPerDay";
	const metricValue = sortMetric?.value;
	const metricText = metricValue == null ? "—"
		: isAverageViews
			? metricValue > 0 && metricValue < 0.1 ? "<0.1" : formatVideoCount(Math.round(metricValue * 10) / 10)
			: metricValue > 0 && metricValue < 0.0001 ? "<0.01%" : `${(metricValue * 100).toFixed(2)}%`;
	const metricTooltip = isAverageViews
		? metricValue == null
			? "Average views/day unavailable: no views or a missing/invalid upload date."
			: `Average views/day since upload: ${metricValue.toLocaleString(undefined, { maximumFractionDigits: 6 })}. Based on saved views; minimum age is 1 day.`
		: metricValue == null
			? "Like/View Ratio unavailable: no views or missing like count."
			: `${Number(videoInfo.statistics.likeCount).toLocaleString()} likes ÷ ${Number(videoInfo.statistics.viewCount).toLocaleString()} views × 100 = ${(metricValue * 100).toLocaleString(undefined, { maximumFractionDigits: 6 })}%.`;
	const openTranscript = (trigger: HTMLElement, mode: TranscriptReaderMode = "paragraphs"): void => {
		if (transcriptWorkspace) transcriptWorkspace.openTranscript(videoInfo, trigger, mode);
		else void plugin.openTranscriptPane(videoInfo, undefined, mode).catch(error => {
			debugLogger.error("[Transcript] Could not open pane", error);
			new Notice("Could not open the transcript pane.");
		});
	};

	const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
		e.dataTransfer.setData(
			"text/plain",
			`\n[${videoInfo.snippet.channelTitle} - ${videoInfo.snippet.title}](${url})\n`,
		);
		e.currentTarget.classList.add("video-card__container--dragging");
	};

	const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
		e.currentTarget.classList.remove("video-card__container--dragging");
	};

	const handleChannelClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onChannelClick(videoInfo.snippet.channelTitle, videoInfo.snippet.channelId);
	};
	const handleCreateVideoNote = async (e: React.MouseEvent): Promise<void> => {
		e.preventDefault();
		e.stopPropagation();
		try {
			const { file, created } = await plugin.videoNotes.getOrCreate(videoInfo, url);
			await plugin.app.workspace.openLinkText(file.path, "", true);
			new Notice(created ? `Created note: ${file.basename}` : `Opening existing note: ${file.path}`);
		} catch (error) {
			debugLogger.error("Error handling video note:", error);
			new Notice("Failed to create/open video note. Check console for details.");
		}
	};

	const handleContextMenu = (e: React.MouseEvent<HTMLElement>): void => {
		e.preventDefault();
		e.stopPropagation();
		const trigger = e.currentTarget;
		const activeFile = plugin.app.workspace.getActiveFile()
			?? plugin.app.workspace.activeEditor?.file;
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Open video");
			item.setIcon("create-new");
			item.onClick(() => {
				onLinkClick(url);
			});
		});
		if (source === "subscription") {
			menu.addItem((item) => {
				item.setTitle("Open channel page in YouTube");
				item.setIcon("user");
				item.onClick(() => {
					window.open(`https://www.youtube.com/channel/${encodeURIComponent(videoInfo.snippet.channelId)}`, "_blank");
				});
			});
		}

		menu.addItem((item) => {
			item.setTitle("Read transcript");
			item.setIcon("captions");
			item.onClick(() => openTranscript(trigger));
		});

		if (isAIEnabled) {
			menu.addItem((item) => {
				item.setTitle(
					hasSummary ? "View AI summary" : "Generate AI summary",
				);
				item.setIcon("bot");
				item.onClick(() => openTranscript(trigger, "ai"));
			});
		}

		menu.addItem((item) => {
			item.setTitle("View video details");
			item.onClick(() => {
				const modal = new VideoInfoModal(
					plugin.app,
					videoInfo,
					plugin.getCategoryDisplay.bind(plugin),
				);
				modal.open();
			});
		});

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle(noteExists ? "Open video note" : "Create video note");
			item.setIcon(noteExists ? "file-check" : "file-plus");
			item.onClick(async () => handleCreateVideoNote(e));
		});

		menu.addItem((item) => {
			item.setTitle("Add link to current note");
			item.setDisabled(activeFile?.extension !== "md");
			item.onClick(async () => {
				if (!activeFile || activeFile.extension !== "md") {
					new Notice(
						"No active note found. Please open a note first.",
					);
					return;
				}

				const videoData = `- [${videoInfo.snippet.title}](${url}) - ${videoInfo.snippet.channelTitle}`;

				try {
					await appendNoteContent(plugin.app, activeFile, {
						text: "\n" + videoData,
					});
					new Notice(`Added video to ${activeFile.basename}`);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					debugLogger.error("Failed to add video to the active note:", message);
					new Notice("Failed to add video to the active note");
				}
			});
		});

		menu.addItem((item) => {
			item.setTitle("Add link to daily note");
			item.onClick(async () => {
				try {
					const today = moment().startOf("day");
					const dailyNotes = getAllDailyNotes();
					let dailyNote = getDailyNote(today, dailyNotes);
					if (!dailyNote) {
						dailyNote = await createDailyNote(today);
					}

					const dailyNoteFile = plugin.app.vault.getFileByPath(dailyNote.path);
					if (dailyNoteFile === null) {
						throw new Error(`Daily note is unavailable in the current vault: ${dailyNote.path}`);
					}
					const dataToAdd = `[${videoInfo.snippet.title} - ${videoInfo.snippet.channelTitle}](${url})`;
					await onAddToDailyNote(dataToAdd, dailyNoteFile);
				} catch (error) {
					console.error("Error adding to daily note:", error);
					new Notice(
						"Failed to add video to daily note. Check console for details.",
					);
				}
			});
		});

		if (source === "liked") {
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("Add to playlist…");
				item.setIcon("list-plus");
				item.onClick(() => {
					new AddToPlaylistModal(plugin.app, plugin.playlistApi, videoInfo.id, videoInfo.snippet.title).open();
				});
			});
		}

		menu.addSeparator();

		if (source === "liked" || isLiked) {
			menu.addItem((item) => {
				item.setTitle("Unlike");
				item.setIcon("heart-off");
				item.setDisabled(likeActionPending);
				item.onClick(() => {
					onUnlike();
				});
			});
		} else {
			menu.addItem((item) => {
				item.setTitle("Like");
				item.setIcon("heart");
				item.setDisabled(likeActionPending);
				item.onClick(() => onLike?.());
			});
		}

		if (source === "subscription" && onUnsubscribeChannel) {
			menu.addItem((item) => {
				item.setTitle("Unsubscribe channel");
				item.setIcon("user-minus");
				item.setDisabled(unsubscribeActionPending);
				item.onClick(onUnsubscribeChannel);
			});
		}

		menu.showAtPosition({ x: e.clientX, y: e.clientY });
	};

	const thumbnailAndDetails = (
		<>
			<div className="video-thumbnail-wrapper">
				<img
					className="video-thumbnail"
					loading="lazy"
					decoding="async"
					src={videoInfo.snippet.thumbnails.medium.url}
					alt="Video Thumbnail"
					width={320}
					height={180}
				/>
				{videoInfo.contentDetails?.duration && (
					<span className="video-duration-badge">
						{formatVideoDuration(videoInfo.contentDetails.duration)}
					</span>
				)}
			</div>
			<div className="video-details">
				<div className="video-details-inner">
					<h2 className="video-title">{videoInfo.snippet.title}</h2>
					<p className="video-channel">
						<span className="video-metadata-label">Channel:</span>{" "}
						<button
							type="button"
							className="video-channel-link"
							onClick={handleChannelClick}
						>
							{videoInfo.snippet.channelTitle}
						</button>
					</p>
					<p className="video-date">
						<span className="video-metadata-label">Published:</span>{" "}
						<span className="video-metadata-value">
							{moment(videoInfo.snippet.publishedAt).format("ll")}
						</span>
					</p>
					{showVideoTags && videoInfo.snippet.tags?.length > 0 && (
						<ResponsiveVideoTags
							tags={videoInfo.snippet.tags}
							onTagClick={onTagClick}
						/>
					)}
				</div>
				<div className="video-bottom-row">
					<div className="video-statistics">
						<div className={`video-stat${sortMetric ? " video-stat--views-with-metric" : ""}`}>
							<span className="video-stat-views">
								<Eye size={16} className="video-stat-icon" />
								<span className="video-stat-count">
									{formatVideoCount(videoInfo.statistics.viewCount, false)}
								</span>
							</span>
							{sortMetric && (
								<span className="video-sort-metric" title={metricTooltip}>
									<span className="video-sort-metric__separator" aria-hidden="true">·</span>
									<span className="video-sort-metric__value">{metricText}</span>
									<span className="video-sort-metric__unit">{isAverageViews ? "/day" : " Like/View"}</span>
								</span>
							)}
						</div>
						<div className="video-stat-actions">
							<button
								type="button"
								className="video-stat video-stat--clickable video-stat--button"
								disabled={likeActionPending}
								aria-label={
									source === "liked"
										? "Unlike"
										: isLiked
											? "Unlike"
											: "Like"
								}
								title={
									source === "liked"
										? "Unlike"
										: isLiked
											? "Unlike"
											: "Like"
								}
								onClick={(e) => {
									e.stopPropagation();
									if (source === "liked" || isLiked) onUnlike();
									else onLike?.();
								}}
							>
								<ThumbsUp
									size={16}
									fill={
										source === "liked" || isLiked
											? "currentColor"
											: "none"
									}
									className={`video-stat-icon${source === "liked" || isLiked ? " video-stat-icon--liked" : ""}`}
								/>
								<span className="video-stat-count">
									{formatVideoCount(videoInfo.statistics.likeCount, false)}
								</span>
							</button>
							<button
								type="button"
								className="video-stat video-stat--clickable video-stat--button video-stat--comment"
								aria-label={`Show comments for ${videoInfo.snippet.title}`}
								title="Show comments"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									const trigger = e.currentTarget;
									const modal = new VideoCommentsModal(
										plugin.app,
										videoInfo.id,
										videoInfo.snippet.title,
										plugin.commentService,
										() => {
											if (trigger.isConnected) trigger.focus({ preventScroll: true });
										},
									);
									modal.open();
								}}
							>
								<MessageCircle
									size={16}
									className="video-stat-icon"
								/>
								<span className="video-stat-count">
									{formatVideoCount(videoInfo.statistics.commentCount, false)}
								</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		</>
	);

	const actionButtons = (
		<>
			<button
				type="button"
				className="video-card-btn"
				aria-label="Read transcript"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					openTranscript(event.currentTarget);
				}}
			>
				<Captions size={16} />
			</button>
			<button
				className={`video-card-btn ${noteExists ? "video-card-btn--has-note" : ""}`}
				aria-label={
					noteExists ? "Open Video Note" : "Create Video Note"
				}
				onClick={(e) => {
					void handleCreateVideoNote(e);
				}}
			>
				{noteExists ? <FileCheck size={16} /> : <FilePlus size={16} />}
			</button>
			<button
				className="video-card-btn"
				aria-label="More options"
				onClick={handleContextMenu}
			>
				<MoreHorizontal size={16} />
			</button>
		</>
	);

	const handleCardClick = () => {
		if (!isSummaryExpanded) {
			onLinkClick(url);
		}
	};

	if (isAIEnabled) {
		return (
			<div
				className={`video-card__container video-card__container--ai ${isSummaryExpanded ? "video-card__container--expanded" : ""}${transcriptWorkspace?.selectedVideoId === videoInfo.id ? " video-card__container--transcript-selected" : ""}`}
				onClick={handleCardClick}
				tabIndex={0}
				aria-label={`Open ${videoInfo.snippet.title}`}
				onKeyDown={(event) => {
					if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
						event.preventDefault();
						handleCardClick();
					}
				}}
				onContextMenu={handleContextMenu}
				draggable
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="video-card__main">
					<div className="video-card-inner">
						{thumbnailAndDetails}
					</div>
					<div className="video-card-options">
						<button
							className={`video-card-btn video-card-btn--ai ${hasSummary ? "video-card-btn--accent" : ""}`}
							aria-label={hasSummary ? "Open AI summary" : "Generate AI summary"}
							onClick={event => { event.preventDefault(); event.stopPropagation(); openTranscript(event.currentTarget, "ai"); }}
						>
							<Bot size={16} aria-hidden="true" />
							{hasSummary && <Check size={10} className="video-card-btn__summary-check" aria-hidden="true" />}
						</button>
						{actionButtons}
					</div>
				</div>
				{hasSummary && !isSummaryExpanded && (
					<div
						className="summary-preview"
						onClick={event => event.stopPropagation()}
					>
						<Bot size={12} className="summary-preview__icon" aria-hidden="true" />
						<span className="summary-preview__text">
							{summaryPreview}
						</span>
					</div>
				)}
				<SummarySection
					videoId={videoInfo.id}
					videoTitle={videoInfo.snippet.title}
					channelTitle={videoInfo.snippet.channelTitle}
					channelId={videoInfo.snippet.channelId}
					isExpanded={isSummaryExpanded}
					setIsExpanded={setIsSummaryExpanded}
					onAddToNote={summary => saveSummaryToNote(plugin, videoInfo, summary)}
					videoDuration={videoInfo.contentDetails?.duration}
					onBusyChange={onSummaryBusyChange}
					initialSnapshot={summarySnapshot}
					onSnapshotChange={onSummarySnapshotChange}
				/>
			</div>
		);
	}

	return (
		<div
			className={`video-card__container${transcriptWorkspace?.selectedVideoId === videoInfo.id ? " video-card__container--transcript-selected" : ""}`}
			onClick={() => onLinkClick(url)}
			tabIndex={0}
			aria-label={`Open ${videoInfo.snippet.title}`}
			onKeyDown={(event) => {
				if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
					event.preventDefault();
					onLinkClick(url);
				}
			}}
			onContextMenu={handleContextMenu}
			draggable
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div className="video-card-inner">{thumbnailAndDetails}</div>
			<div className="video-card-options">{actionButtons}</div>
		</div>
	);
};
