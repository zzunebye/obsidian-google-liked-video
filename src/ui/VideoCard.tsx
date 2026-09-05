import { useState } from "react";
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
	ExternalLink,
	FilePlus,
	FileCheck,
	Bot,
	ChevronDown,
} from "lucide-react";
import { YouTubeVideo } from "src/types";
import { VideoInfoModal, parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { confirmUnlikeAction } from "src/utils/confirmationUtils";
import { usePlugin } from "../store/pluginContext";
import {
	sanitizeFileName,
	generateVideoNoteContent,
	getExpectedNotePath,
	computeExpectedNotePath,
} from "src/utils/noteUtils";
import { ensureVideoNoteId, findVideoNote } from "src/utils/videoNoteUtils";
import { TemplateService } from "src/services/templateService";
import { SummarySection } from "./SummarySection";
import type { SummarySnapshot } from "./SummarySection";
import { ResponsiveVideoTags } from "./VideoTags";

interface VideoCardProps {
	source: "liked" | "playlist";
	videoInfo: YouTubeVideo;
	id: string;
	url: string;
	noteExists: boolean;
	isLiked?: boolean;
	onUnlike: () => void;
	onLike?: () => void;
	onAddToDailyNote: (videoData: string, file: TFile) => void;
	onChannelClick: (channelTitle: string) => void;
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
	url,
	noteExists,
	isLiked,
	onUnlike,
	onLike,
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
	const isAIEnabled = plugin.settings?.enableAISummary ?? false;
	const showVideoTags = plugin.settings?.showVideoTags ?? true;
	const [localSummaryExpanded, setLocalSummaryExpanded] = useState(false);
	const isSummaryExpanded = summaryExpanded ?? localSummaryExpanded;
	const setIsSummaryExpanded = (expanded: boolean) => {
		if (onSummaryExpandedChange) onSummaryExpandedChange(expanded);
		else setLocalSummaryExpanded(expanded);
	};
	const [hasSummary, setHasSummary] = useState(() =>
		plugin.summaryStorage.hasVideoSummary(videoInfo.id),
	);
	const [, setPreviewVersion] = useState(0);
	const [regenerateTrigger, setRegenerateTrigger] = useState(0);

	// Format duration from seconds to display format
	const formatDuration = (duration: string | undefined): string => {
		if (!duration) return "";

		const seconds = parseDurationToSeconds(duration);
		if (seconds === null || seconds === 0) return "";

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
		}
		return `${minutes}:${secs.toString().padStart(2, "0")}`;
	};

	// Utility function to format large numbers
	const formatCount = (count: number | string): string => {
		const num = typeof count === "string" ? parseInt(count) : count;
		if (isNaN(num)) return "0";

		if (num >= 1000000) {
			return (num / 1000000).toFixed(1) + "M";
		} else if (num >= 1000) {
			return (num / 1000).toFixed(1) + "K";
		}
		return num.toString();
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

	const handleExternalOpen = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onLinkClick(url);
	};

	const handleSummaryToggle = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsSummaryExpanded(!isSummaryExpanded);
	};

	const handleChannelClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onChannelClick(videoInfo.snippet.channelTitle);
	};
	const handleCreateVideoNote = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();

		try {
			const baseFileName = sanitizeFileName(videoInfo.snippet.title);
			const configuredPath = plugin.settings?.videoNotePath?.trim() || "";
			const customPath = configuredPath;
			const organizeByChannel =
				configuredPath.length > 0 && (plugin.settings?.organizeByChannel || false);
			const channelName = videoInfo.snippet.channelTitle;
			const appInstance = plugin.app;

			const expectedPath = computeExpectedNotePath(
				appInstance,
				baseFileName,
				customPath,
				organizeByChannel,
				channelName,
			);

			const legacyPaths = configuredPath
				? [expectedPath]
				: [
					expectedPath,
					computeExpectedNotePath(appInstance, baseFileName, "Youtube", organizeByChannel, channelName),
				];
			const existingFile = findVideoNote(appInstance, videoInfo.id, legacyPaths);

			if (!existingFile) {
				const fullPath = await getExpectedNotePath(
					appInstance,
					baseFileName,
					customPath,
					organizeByChannel,
					channelName,
				);
				const templateService = plugin.settings
					? new TemplateService(appInstance, plugin.settings)
					: undefined;

				const noteContent = await generateVideoNoteContent(
					videoInfo,
					url,
					plugin.getCategoryDisplay?.bind(plugin),
					templateService,
				);

				const newNoteFile = await appInstance.vault.create(
					fullPath,
					noteContent,
				);
				await ensureVideoNoteId(appInstance, newNoteFile, videoInfo.id);

				await appInstance.workspace.openLinkText(
					newNoteFile.path,
					"",
					true,
				);
				new Notice(`Created note: ${newNoteFile.basename}`);
			} else {
				await ensureVideoNoteId(appInstance, existingFile, videoInfo.id);
				new Notice(
					`Note already exists for this video. Opening existing note: ${existingFile.path}`,
				);
				await appInstance.workspace.openLinkText(
					existingFile.path,
					"",
					true,
				);
			}
		} catch (error) {
			console.error("Error handling video note:", error);
			new Notice(
				"Failed to create/open video note. Check console for details.",
			);
		}
	};

	const handleAddSummaryToNote = async (summaryText: string) => {
		const appInstance = plugin.app;
		const baseFileName = sanitizeFileName(videoInfo.snippet.title);
		const configuredPath = plugin.settings?.videoNotePath?.trim() || "";
		const customPath = configuredPath;
		const organizeByChannel = configuredPath.length > 0 && (plugin.settings?.organizeByChannel || false);
		const channelName = videoInfo.snippet.channelTitle;

		const expectedPath = computeExpectedNotePath(
			appInstance,
			baseFileName,
			customPath,
			organizeByChannel,
			channelName,
		);

		const legacyPaths = configuredPath
			? [expectedPath]
			: [
				expectedPath,
				computeExpectedNotePath(appInstance, baseFileName, "Youtube", organizeByChannel, channelName),
			];
		let file = findVideoNote(appInstance, videoInfo.id, legacyPaths);

		if (!file) {
			// Create the note first
			const fullPath = await getExpectedNotePath(
				appInstance,
				baseFileName,
				customPath,
				organizeByChannel,
				channelName,
			);

			const templateService = plugin.settings
				? new TemplateService(appInstance, plugin.settings)
				: undefined;

			const noteContent = await generateVideoNoteContent(
				videoInfo,
				url,
				plugin.getCategoryDisplay?.bind(plugin),
				templateService,
			);

			file = await appInstance.vault.create(fullPath, noteContent);
		}
		await ensureVideoNoteId(appInstance, file, videoInfo.id);

		// Check frontmatter for existing AI summary (with content fallback for cache staleness)
		const cache = appInstance.metadataCache.getFileCache(file);
		if (cache?.frontmatter?.ai_summary) {
			new Notice("AI Summary already exists in this note");
			await appInstance.workspace.openLinkText(file.path, "", true);
			return;
		}
		const content = await appInstance.vault.read(file);
		if (content.includes("## AI Summary")) {
			new Notice("AI Summary already exists in this note");
			await appInstance.workspace.openLinkText(file.path, "", true);
			return;
		}

		// Set frontmatter first so duplicate detection works even if append fails
		await appInstance.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				fm.ai_summary = true;
			},
		);

		// Append the summary
		await appInstance.vault.append(
			file,
			"\n\n## AI Summary\n" + summaryText,
		);

		new Notice("Summary added to video note");
		await appInstance.workspace.openLinkText(file.path, "", true);
	};

	const handleContextMenu = (e: any): void => {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Open in external browser");
			item.setIcon("create-new");
			item.onClick(() => {
				onLinkClick(url);
			});
		});

		if (source === "liked") {
			menu.addItem((item) => {
				item.setTitle("Unlike");
				item.setIcon("heart-off");
				item.onClick(() => {
					onUnlike();
				});
			});
		} else if (source === "playlist") {
			if (isLiked) {
				menu.addItem((item) => {
					item.setTitle("Unlike");
					item.setIcon("heart-off");
					item.onClick(async () => {
						const confirmed = await confirmUnlikeAction(
							plugin.app,
							videoInfo.snippet.title,
						);
						if (confirmed) {
							onUnlike();
						}
					});
				});
			} else {
				menu.addItem((item) => {
					item.setTitle("Like");
					item.setIcon("heart");
					item.onClick(() => {
						onLike?.();
					});
				});
			}
		}

		menu.addItem((item) => {
			item.setTitle("Add to daily note");
			item.onClick(async () => {
				try {
					const today = moment().startOf("day");
					const dailyNotes = getAllDailyNotes();
					let dailyNote = getDailyNote(today, dailyNotes);
					if (!dailyNote) {
						dailyNote = await createDailyNote(today);
					}

					const dataToAdd = `[${videoInfo.snippet.title} - ${videoInfo.snippet.channelTitle}](${url})`;
					onAddToDailyNote(dataToAdd, dailyNote as TFile);
				} catch (error) {
					console.error("Error adding to daily note:", error);
					new Notice(
						"Failed to add video to daily note. Check console for details.",
					);
				}
			});
		});

		menu.addItem((item) => {
			item.setTitle("Add to current note");
			item.onClick(() => {
				const activeFile = plugin.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice(
						"No active note found. Please open a note first.",
					);
					return;
				}

				const videoData = `- [${videoInfo.snippet.title}](${url}) - ${videoInfo.snippet.channelTitle}`;

				plugin.app.vault
					.process(activeFile, (data) => {
						return data + "\n" + videoData;
					})
					.then(() => {
						new Notice(`Added video to ${activeFile.basename}`);
					});
			});
		});

		menu.addItem((item) => {
			item.setTitle("Display video info");
			item.onClick(() => {
				const modal = new VideoInfoModal(
					plugin.app,
					videoInfo,
					plugin.getCategoryDisplay.bind(plugin),
				);
				modal.open();
			});
		});

		menu.addItem((item) => {
			item.setTitle(noteExists ? "Open video note" : "Create note");
			item.setIcon(noteExists ? "file-check" : "file-plus");
			item.onClick(async () => handleCreateVideoNote(e));
		});

		if (isAIEnabled) {
			menu.addItem((item) => {
				item.setTitle(
					hasSummary ? "View AI summary" : "Generate AI summary",
				);
				item.setIcon("bot");
				item.onClick(() => setIsSummaryExpanded(true));
			});

			if (hasSummary) {
				menu.addItem((item) => {
					item.setTitle("Regenerate AI summary");
					item.setIcon("refresh-cw");
					item.onClick(() => {
						setIsSummaryExpanded(true);
						setRegenerateTrigger((prev) => prev + 1);
					});
				});
			}
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
						{formatDuration(videoInfo.contentDetails.duration)}
					</span>
				)}
			</div>
			<div className="video-details">
				<div className="video-details-inner">
					<h2 className="video-title">{videoInfo.snippet.title}</h2>
					<p className="video-channel">
						Channel:{" "}
						<span
							className="video-channel-link"
							onClick={handleChannelClick}
						>
							{videoInfo.snippet.channelTitle}
						</span>
					</p>
					<p className="video-date">
						Published:{" "}
						{moment(videoInfo.snippet.publishedAt).format(
							"MMM D, YYYY",
						)}
					</p>
					{showVideoTags && videoInfo.snippet.tags?.length > 0 && (
						<ResponsiveVideoTags
							tags={videoInfo.snippet.tags}
							onTagClick={onTagClick}
						/>
					)}
				</div>
				<div className="video-bottom-row">
					<p className="video-pulled-at">
						Pulled at{" "}
						{new Date(videoInfo.pulled_at).toLocaleDateString()}
					</p>
					<div className="video-statistics">
						<div className="video-stat">
							<Eye size={16} className="video-stat-icon" />
							<span className="video-stat-count">
								{formatCount(videoInfo.statistics.viewCount)}
							</span>
						</div>
						<div
							className="video-stat video-stat--clickable"
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
							onClick={async (e) => {
								e.stopPropagation();
								if (source === "liked") {
									onUnlike();
								} else if (isLiked) {
									const confirmed = await confirmUnlikeAction(
										plugin.app,
										videoInfo.snippet.title,
									);
									if (confirmed) onUnlike();
								} else {
									onLike?.();
								}
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
								{formatCount(videoInfo.statistics.likeCount)}
							</span>
						</div>
						<div className="video-stat">
							<MessageCircle
								size={16}
								className="video-stat-icon"
							/>
							<span className="video-stat-count">
								{formatCount(videoInfo.statistics.commentCount)}
							</span>
						</div>
					</div>
				</div>
			</div>
		</>
	);

	const actionButtons = (
		<>
			<button
				className="video-card-btn"
				aria-label="Open in Browser"
				onClick={handleExternalOpen}
				title="Open in External Browser"
			>
				<ExternalLink size={16} />
			</button>
			<button
				className={`video-card-btn ${noteExists ? "video-card-btn--has-note" : ""}`}
				aria-label={
					noteExists ? "Open Video Note" : "Create Video Note"
				}
				onClick={(e) => handleCreateVideoNote(e)}
				title={
					noteExists
						? "Open existing video note"
						: "Create video note"
				}
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
				className={`video-card__container video-card__container--ai ${isSummaryExpanded ? "video-card__container--expanded" : ""}`}
				onClick={handleCardClick}
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
							className={`video-card-btn ${hasSummary ? "video-card-btn--accent" : ""}`}
							aria-label="AI Summary"
							onClick={handleSummaryToggle}
							title={
								hasSummary
									? "Show/hide AI summary"
									: "Generate AI summary"
							}
						>
							<Bot size={16} />
						</button>
						{actionButtons}
					</div>
				</div>
				{hasSummary && !isSummaryExpanded && (
					<div
						className="summary-preview"
						onClick={handleSummaryToggle}
					>
						<Bot size={12} className="summary-preview__icon" />
						<span className="summary-preview__text">
							{plugin.summaryStorage.getOneLineSummary(
								videoInfo.id,
							)}
						</span>
						<ChevronDown
							size={12}
							className="summary-preview__chevron"
						/>
					</div>
				)}
				<SummarySection
					videoId={videoInfo.id}
					videoTitle={videoInfo.snippet.title}
					channelTitle={videoInfo.snippet.channelTitle}
					channelId={videoInfo.snippet.channelId}
					isExpanded={isSummaryExpanded}
					setIsExpanded={setIsSummaryExpanded}
					onSummaryGenerated={() => setHasSummary(true)}
					onAddToNote={handleAddSummaryToNote}
					onPreviewUpdated={() => setPreviewVersion((v) => v + 1)}
					regenerateTrigger={regenerateTrigger}
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
			className="video-card__container"
			onClick={() => onLinkClick(url)}
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
