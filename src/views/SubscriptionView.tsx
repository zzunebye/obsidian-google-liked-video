import { Modal, Notice } from "obsidian";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	AlertCircle,
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	Loader2,
	RefreshCw,
	Rss,
	Search,
	Settings,
	SlidersHorizontal,
	X,
} from "lucide-react";
import { SearchBar } from "src/ui/SearchBar";
import { VideoCard } from "src/ui/VideoCard";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { ViewHeader } from "src/ui/ViewHeader";
import { OpenYouTubeButton } from "src/ui/OpenYouTubeButton";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { localStorageService } from "src/storage";
import { UI_TEXT } from "src/constants/uiText";
import type { SubscriptionProgress, SubscriptionSnapshot } from "src/services/subscriptionService";
import type {
	ContentTypeOption,
	ContentTypeSelection,
	SubscriptionChannel,
	YouTubeVideo,
} from "src/types";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { usePlugin } from "../store/pluginContext";

export type SubscriptionPeriod = "all" | "day" | "week" | "month";
export type SubscriptionSortOrder = "ASC" | "DESC";

export interface SubscriptionViewState {
	searchTerm: string;
	channelId: string;
	period: SubscriptionPeriod;
	contentTypes: ContentTypeSelection;
	sortOrder: SubscriptionSortOrder;
	filtersExpanded: boolean;
	dismissedFailureUpdatedAt: number | null;
}

interface SubscriptionViewProps {
	initialState: SubscriptionViewState;
	refreshVersion: number;
	onRequestRefresh: () => void;
	onStateChange: (state: SubscriptionViewState) => void;
}

const VIDEOS_PER_BATCH = 30;

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function formatUpdatedAt(updatedAt: number): string {
	const elapsedMinutes = Math.floor((Date.now() - updatedAt) / 60000);
	if (elapsedMinutes < 1) return "Updated just now";
	if (elapsedMinutes < 60) return `Updated ${elapsedMinutes}m ago`;
	return `Updated ${new Date(updatedAt).toLocaleString()}`;
}

function getPeriodStart(period: SubscriptionPeriod): number | null {
	const now = Date.now();
	if (period === "day") return now - 24 * 60 * 60 * 1000;
	if (period === "week") return now - 7 * 24 * 60 * 60 * 1000;
	if (period === "month") return now - 30 * 24 * 60 * 60 * 1000;
	return null;
}

export const SubscriptionView: React.FC<SubscriptionViewProps> = ({
	initialState,
	refreshVersion,
	onRequestRefresh,
	onStateChange,
}) => {
	const plugin = usePlugin();
	const shortVideoMaxDurationSeconds = plugin.settings.shortVideoMaxDurationSeconds;
	const cachedSnapshot = plugin.subscriptionService.getSnapshot();
	const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(cachedSnapshot);
	const [pendingSnapshot, setPendingSnapshot] = useState<SubscriptionSnapshot | null>(null);
	const [searchTerm, setSearchTerm] = useState(initialState.searchTerm);
	const [channelId, setChannelId] = useState(initialState.channelId);
	const [period, setPeriod] = useState<SubscriptionPeriod>(initialState.period);
	const [contentTypes, setContentTypes] = useState<ContentTypeSelection>(initialState.contentTypes);
	const [sortOrder, setSortOrder] = useState<SubscriptionSortOrder>(initialState.sortOrder);
	const [filtersExpanded, setFiltersExpanded] = useState(initialState.filtersExpanded);
	const [dismissedFailureUpdatedAt, setDismissedFailureUpdatedAt] = useState(
		initialState.dismissedFailureUpdatedAt,
	);
	const [visibleCount, setVisibleCount] = useState(VIDEOS_PER_BATCH);
	const [progress, setProgress] = useState<SubscriptionProgress | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isUnsubscribing, setIsUnsubscribing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(
		() => new Set(localStorageService.getLikedVideos().map((video) => video.id)),
	);
	const abortControllerRef = useRef<AbortController | null>(null);
	const endRef = useRef<HTMLParagraphElement>(null);

	const openPluginSettings = (): void => {
		if (!plugin.settingTabRef?.openVideoDisplaySettings()) {
			new Notice("Unable to open Geulo settings in this Obsidian version.");
		}
	};

	const settingsAction = (
		<button
			type="button"
			title={UI_TEXT.BTN_SETTINGS}
			aria-label={UI_TEXT.BTN_SETTINGS}
			onClick={openPluginSettings}
		>
			<Settings size={16} />
		</button>
	);

	useEffect(() => {
		onStateChange({
			searchTerm,
			channelId,
			period,
			contentTypes,
			sortOrder,
			filtersExpanded,
			dismissedFailureUpdatedAt,
		});
	}, [
		searchTerm,
		channelId,
		period,
		contentTypes,
		sortOrder,
		filtersExpanded,
		dismissedFailureUpdatedAt,
		onStateChange,
	]);

	useEffect(() => {
		setVisibleCount(VIDEOS_PER_BATCH);
	}, [searchTerm, channelId, period, contentTypes, sortOrder]);

	const runFetch = async (stageResult: boolean): Promise<void> => {
		abortControllerRef.current?.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;
		setIsLoading(true);
		setError(null);
		setProgress(null);
		try {
			const result = await plugin.subscriptionService.fetch({
				signal: controller.signal,
				onProgress: setProgress,
			});
			if (controller.signal.aborted) return;
			if (stageResult && snapshot) setPendingSnapshot(result);
			else setSnapshot(result);
		} catch (fetchError) {
			if (!isAbortError(fetchError)) {
				setError(fetchError instanceof Error ? fetchError.message : "Failed to load subscriptions");
			}
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null;
				setIsLoading(false);
				setProgress(null);
			}
		}
	};

	useEffect(() => () => abortControllerRef.current?.abort(), []);

	useEffect(() => {
		if (refreshVersion === 0) return;
		void runFetch(snapshot !== null);
	}, [refreshVersion]);

	const filteredVideos = useMemo(() => {
		const normalizedSearch = searchTerm.trim().toLowerCase();
		const periodStart = getPeriodStart(period);
		return (snapshot?.videos ?? []).filter((video) => {
			if (channelId !== "all" && video.snippet.channelId !== channelId) return false;
			if (periodStart !== null && Date.parse(video.snippet.publishedAt) < periodStart) return false;

			const durationSeconds = parseDurationToSeconds(video.contentDetails?.duration) ?? 0;
			const isShort = durationSeconds > 0 && durationSeconds <= shortVideoMaxDurationSeconds;
			const isMusic = video.snippet.categoryId === "10";
			const isRegularVideo = !isShort && !isMusic;
			if (contentTypes.length > 0 && contentTypes.length < 3) {
				const contentTypeMatch = (contentTypes.includes("videos") && isRegularVideo)
					|| (contentTypes.includes("shorts") && isShort)
					|| (contentTypes.includes("music") && isMusic);
				if (!contentTypeMatch) return false;
			}

			if (!normalizedSearch) return true;
			return video.snippet.title.toLowerCase().includes(normalizedSearch)
				|| video.snippet.channelTitle.toLowerCase().includes(normalizedSearch)
				|| video.snippet.tags?.some((tag) => tag.toLowerCase().includes(normalizedSearch));
		});
	}, [snapshot, searchTerm, channelId, period, contentTypes, shortVideoMaxDurationSeconds]);
	const sortedVideos = useMemo(
		() => [...filteredVideos].sort((left, right) => (
			sortOrder === "ASC"
				? left.snippet.publishedAt.localeCompare(right.snippet.publishedAt)
				: right.snippet.publishedAt.localeCompare(left.snippet.publishedAt)
		)),
		[filteredVideos, sortOrder],
	);

	const displayedVideos = useMemo(
		() => sortedVideos.slice(0, visibleCount),
		[sortedVideos, visibleCount],
	);

	useEffect(() => {
		const end = endRef.current;
		const scrollElement = end?.closest<HTMLElement>(".view-content");
		const ownerWindow = end?.ownerDocument.defaultView;
		if (!end || !scrollElement || !ownerWindow || visibleCount >= filteredVideos.length) return;

		const observer = new ownerWindow.IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setVisibleCount((count) => Math.min(count + VIDEOS_PER_BATCH, filteredVideos.length));
			}
		}, { root: scrollElement, rootMargin: "0px 0px 600px 0px" });
		observer.observe(end);

		return () => observer.disconnect();
	}, [filteredVideos.length, visibleCount]);

	const noteExistenceMap = useNoteExistenceMap(plugin, displayedVideos);
	const newVideoCount = useMemo(() => {
		if (!snapshot || !pendingSnapshot) return 0;
		const currentIds = new Set(snapshot.videos.map((video) => video.id));
		return pendingSnapshot.videos.filter((video) => !currentIds.has(video.id)).length;
	}, [snapshot, pendingSnapshot]);
	const hasRetryableFailures = snapshot?.failedChannels.some(
		(channel) => snapshot.failureDetails[channel.id]?.retryable !== false,
	) ?? false;
	const hasContentTypeFilter = contentTypes.length > 0 && contentTypes.length < 3;
	const activeFilterCount = Number(period !== "all") + Number(hasContentTypeFilter);
	const sortDirectionLabel = sortOrder === "DESC" ? "newest first" : "oldest first";

	const handleLikeVideo = async (video: YouTubeVideo): Promise<void> => {
		try {
			await plugin.likedVideoApi.likeVideo(video.id);
				localStorageService.restoreLikedVideo(video);
			setLikedVideoIds((current) => new Set(current).add(video.id));
			new Notice(UI_TEXT.NOTICE_VIDEO_LIKED(video.snippet.title));
		} catch (likeError) {
			console.error("Failed to like subscription video:", likeError);
			new Notice(UI_TEXT.NOTICE_LIKE_FAILED);
		}
	};

	const handleUnlikeVideo = async (video: YouTubeVideo): Promise<void> => {
		try {
			await plugin.likedVideoApi.unlikeVideo(video.id);
				localStorageService.removeLikedVideo(video.id);
			setLikedVideoIds((current) => {
				const next = new Set(current);
				next.delete(video.id);
				return next;
			});
			new Notice(UI_TEXT.NOTICE_VIDEO_UNLIKED(video.snippet.title));
		} catch (unlikeError) {
			console.error("Failed to unlike subscription video:", unlikeError);
			new Notice(UI_TEXT.NOTICE_UNLIKE_FAILED);
		}
	};

	const openVideo = async (url: string): Promise<void> => {
		if (!plugin.settings.openInObsidianWebViewer) {
			window.open(url, "_blank");
			return;
		}
		const leaf = plugin.app.workspace.getLeaf(
			plugin.settings.openWebViewerInSplitPane ? "split" : "tab",
		);
		await leaf.setViewState({
			type: "webviewer",
			state: { url, navigate: true },
			active: true,
		});
	};

	const applyPendingSnapshot = (): void => {
		if (!pendingSnapshot) return;
		setSnapshot(pendingSnapshot);
		setPendingSnapshot(null);
		setVisibleCount(VIDEOS_PER_BATCH);
	};

	const retryFailedChannels = async (): Promise<void> => {
		abortControllerRef.current?.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;
		setIsLoading(true);
		setError(null);
		try {
			const result = await plugin.subscriptionService.retryFailed({
				signal: controller.signal,
				onProgress: setProgress,
			});
			if (!controller.signal.aborted) setPendingSnapshot(result);
		} catch (retryError) {
			if (!isAbortError(retryError)) {
				setError(retryError instanceof Error ? retryError.message : "Failed to retry channels");
			}
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null;
				setIsLoading(false);
				setProgress(null);
			}
		}
	};

	const toggleContentType = (type: ContentTypeOption): void => {
		setContentTypes((current) =>
			current.includes(type)
				? current.filter((currentType) => currentType !== type)
				: [...current, type],
		);
	};

	const unsubscribeChannels = async (channels: SubscriptionChannel[]): Promise<void> => {
		setIsUnsubscribing(true);
		try {
			const result = await plugin.subscriptionService.unsubscribeChannels(channels);
			setSnapshot(result.snapshot);
			setPendingSnapshot(null);
			if (result.succeededChannels.some((channel) => channel.id === channelId)) {
				setChannelId("all");
			}
			if (result.succeededChannels.length === 1) {
				new Notice(`Unsubscribed from ${result.succeededChannels[0].title}.`);
			} else if (result.succeededChannels.length > 1) {
				new Notice(`Unsubscribed from ${result.succeededChannels.length} channel(s).`);
			}
			if (result.failedChannels.length === 1) {
				new Notice(`Could not unsubscribe from ${result.failedChannels[0].channel.title}.`, 8000);
			} else if (result.failedChannels.length > 1) {
				new Notice(`Could not unsubscribe from ${result.failedChannels.length} channel(s).`, 8000);
			}
		} catch (unsubscribeError) {
			new Notice(
				unsubscribeError instanceof Error
					? unsubscribeError.message
					: "Failed to update the subscription cache.",
				8000,
			);
		} finally {
			setIsUnsubscribing(false);
		}
	};

	const confirmUnsubscribeChannels = (channels: SubscriptionChannel[]): void => {
		const subscriptionLookupCount = channels.filter((channel) => !channel.subscriptionId).length;
		const quotaUnits = channels.length * 50 + subscriptionLookupCount;
		const singleChannel = channels.length === 1 ? channels[0] : null;
		const modal = new Modal(plugin.app);
		modal.setTitle(
			singleChannel
				? `Unsubscribe from ${singleChannel.title}?`
				: `Unsubscribe from ${channels.length} channels?`,
		);
		modal.contentEl.createEl("p", {
			text: "This removes the subscriptions from your YouTube account and removes their cached videos from this view.",
		});
		if (!singleChannel) {
			const channelList = modal.contentEl.createEl("ul");
			channels.forEach((channel) => channelList.createEl("li", { text: channel.title }));
		}
		modal.contentEl.createEl("p", {
				text: `YouTube API quota: ${quotaUnits} units (YouTube sets each subscription change at a fixed 50 units).`,
			cls: "subscription-unsubscribe__quota",
		});
		const actions = modal.contentEl.createDiv({ cls: "subscription-unsubscribe__actions" });
		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => modal.close());
		const unsubscribeButton = actions.createEl("button", {
			text: "Unsubscribe",
			cls: "mod-warning",
		});
		unsubscribeButton.addEventListener("click", () => {
			modal.close();
			void unsubscribeChannels(channels);
		});
		modal.open();
	};

	if (!snapshot && !isLoading && !error) {
		return (
			<div className="subscription-view">
				<ViewHeader
					icon={<Rss className="video-view-header__icon" />}
					title="Subscriptions"
					actions={settingsAction}
				/>
				<div className="no-videos-found">
					<Rss size={32} aria-hidden="true" />
					<div className="no-videos-found__title">Subscriptions are not loaded</div>
					<div className="no-videos-found__text">Load the latest 5 uploads from each subscribed channel when you are ready.</div>
					<button type="button" className="videos-error__retry-button" onClick={() => void runFetch(false)}>
						<RefreshCw size={16} /> Load subscriptions
					</button>
				</div>
			</div>
		);
	}

	if (!snapshot && isLoading) {
		return (
			<div className="subscription-view">
				<ViewHeader
					icon={<Rss className="video-view-header__icon" />}
					title="Subscriptions"
					actions={settingsAction}
				/>
				<div className="subscription-loading">
					<Loader2 size={24} className="animate-spin" />
					<span>{progress ? `${progress.completedChannels} / ${progress.totalChannels} channels checked` : "Loading subscriptions…"}</span>
					<button type="button" onClick={() => abortControllerRef.current?.abort()}>Stop</button>
				</div>
			</div>
		);
	}

	if (!snapshot && error) {
		return (
			<div className="subscription-view">
				<ViewHeader
					icon={<Rss className="video-view-header__icon" />}
					title="Subscriptions"
					actions={settingsAction}
				/>
				<div className="videos-error">
					<AlertCircle size={48} />
					<div className="videos-error__title">Failed to load subscriptions</div>
					<div className="videos-error__message">{error}</div>
					<button type="button" className="videos-error__retry-button" onClick={onRequestRefresh}>
						<RefreshCw size={16} /> Try again
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="subscription-view">
			<ViewHeader
				icon={<Rss className="video-view-header__icon" />}
				title="Subscriptions"
				badge={`${snapshot?.channels.length ?? 0} channels`}
				actions={
					<>
						<button type="button" className="refresh-button" onClick={onRequestRefresh} disabled={isLoading} title="Refresh subscriptions">
							<RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
						</button>
						{settingsAction}
					</>
				}
			/>

			<div className="subscription-status">
				<span>{snapshot ? formatUpdatedAt(snapshot.updatedAt) : "Not updated"}</span>
				<span>Latest 5 uploads per channel</span>
			</div>

			{isLoading && progress && (
				<div className="subscription-progress">
					<span>{progress.completedChannels} / {progress.totalChannels} channels checked</span>
					<progress value={progress.completedChannels} max={Math.max(progress.totalChannels, 1)} />
					<button type="button" onClick={() => abortControllerRef.current?.abort()}>Stop</button>
				</div>
			)}

			{pendingSnapshot && (
				<button type="button" className="subscription-new-videos" onClick={applyPendingSnapshot}>
					{newVideoCount > 0 ? `Show ${newVideoCount} new videos` : "Apply refreshed videos"}
				</button>
			)}

			{snapshot && snapshot.failedChannels.length > 0
				&& dismissedFailureUpdatedAt !== snapshot.updatedAt && (
				<div className="subscription-warning">
					<div className="subscription-warning__header">
						<span>{snapshot.failedChannels.length} channels could not be updated. Previous videos were kept.</span>
						<div className="subscription-warning__actions">
							{hasRetryableFailures && (
								<button type="button" onClick={() => void retryFailedChannels()} disabled={isLoading}>Retry</button>
							)}
							<button
								type="button"
								className="subscription-warning__dismiss"
								onClick={() => setDismissedFailureUpdatedAt(snapshot.updatedAt)}
								aria-label="Dismiss failed channel notice"
								title="Dismiss"
							>
								<X size={16} />
							</button>
						</div>
					</div>
					<details className="subscription-warning__details">
						<summary>Show failed channels</summary>
						<ul>
							{snapshot.failedChannels.map((channel) => {
								const detail = snapshot.failureDetails[channel.id];
								return (
									<li key={channel.id}>
										<strong>{channel.title}</strong>
										<span>{detail?.message ?? "Failure reason was not recorded. Retry once to check it."}</span>
									</li>
								);
							})}
						</ul>
						<button
							type="button"
							className="subscription-unsubscribe"
							onClick={() => confirmUnsubscribeChannels(snapshot.failedChannels)}
							disabled={isLoading || isUnsubscribing}
						>
							{isUnsubscribing ? "Unsubscribing…" : "Unsubscribe the channel(s)"}
						</button>
					</details>
				</div>
			)}

			{error && snapshot && <div className="subscription-warning">{error}</div>}

			<div className="subscription-search search-bar-container">
				<div className="search-bar-wrapper">
					<SearchBar searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />
				</div>
				<button
					type="button"
					className={`filter-toggle-button ${activeFilterCount > 0 ? "filter-toggle-button--active" : ""}`}
					title={filtersExpanded ? UI_TEXT.FILTERS_HIDE : UI_TEXT.FILTERS_SHOW}
					aria-expanded={filtersExpanded}
					aria-controls="subscription-filter-options"
					onClick={() => setFiltersExpanded((current) => !current)}
				>
					<SlidersHorizontal size={16} />
					{activeFilterCount > 0 && (
						<span className="filter-toggle-button__count">{activeFilterCount}</span>
					)}
				</button>
			</div>
			<div className="subscription-filters">
				<select value={channelId} onChange={(event) => setChannelId(event.target.value)} aria-label="Filter by channel">
					<option value="all">All channels</option>
					{(snapshot?.channels ?? []).map((channel) => (
						<option key={channel.id} value={channel.id}>{channel.title}</option>
					))}
				</select>
				<span>{filteredVideos.length} videos</span>
			</div>
			{filtersExpanded && (
				<div
					id="subscription-filter-options"
					className="filters-container filters-container--expanded"
				>
					<div className="video-view-sort-left-group subscription-filter-options">
						<select
							value={period}
							onChange={(event) => setPeriod(event.target.value as SubscriptionPeriod)}
							aria-label="Filter by published date"
						>
							<option value="all">All collected videos</option>
							<option value="day">Last 24 hours</option>
							<option value="week">Last 7 days</option>
							<option value="month">Last 30 days</option>
						</select>
						<div className="content-type-filter" role="group" aria-label="Filter by content type">
							{(["videos", "shorts", "music"] as ContentTypeOption[]).map((option) => (
								<label
									key={option}
									className={`content-type-filter__option ${contentTypes.includes(option) ? "content-type-filter__option--selected" : ""}`}
								>
									<input
										type="checkbox"
										checked={contentTypes.includes(option)}
										onChange={() => toggleContentType(option)}
										className="content-type-filter__input"
									/>
									<span className="content-type-filter__text">
										{option === "videos" ? "Videos" : option === "shorts" ? "Shorts" : "Music"}
									</span>
								</label>
							))}
						</div>
						<div className="filters-divider" />
						<button
							type="button"
							title={`Current order: ${sortDirectionLabel}`}
							aria-label={`Change sort order. Current order: ${sortDirectionLabel}`}
							className="video-view-sort__order"
							onClick={() => setSortOrder((current) => current === "ASC" ? "DESC" : "ASC")}
						>
							{sortOrder === "DESC"
								? <ArrowDownWideNarrow size={16} />
								: <ArrowUpNarrowWide size={16} />}
						</button>
					</div>
				</div>
			)}

			{snapshot?.channels.length === 0 ? (
				<div className="no-videos-found">
					<Rss size={32} aria-hidden="true" />
					<div className="no-videos-found__title">No subscriptions found</div>
					<div className="no-videos-found__text">Subscribe to channels on YouTube to see their latest videos here.</div>
				</div>
			) : filteredVideos.length === 0 ? (
				<div className="no-videos-found">
					<Search size={32} aria-hidden="true" />
					<div className="no-videos-found__title">No matching videos</div>
					<div className="no-videos-found__text">No collected videos match these filters.</div>
					<OpenYouTubeButton query={searchTerm} />
				</div>
			) : (
				<>
					<div className="videos-grid">
						{displayedVideos.map((video) => {
							const channel = snapshot?.channels.find(
								(candidate) => candidate.id === video.snippet.channelId,
							);
							return (
								<VideoCard
								key={video.id}
								source="subscription"
								videoInfo={video}
								id={video.id}
								url={`https://www.youtube.com/watch?v=${video.id}`}
								noteExists={noteExistenceMap.get(video.id) ?? false}
								isLiked={likedVideoIds.has(video.id)}
								onLike={() => {
									void handleLikeVideo(video);
								}}
								onUnlike={() => {
									void handleUnlikeVideo(video);
								}}
								unsubscribeActionPending={isUnsubscribing}
								onUnsubscribeChannel={channel
									? () => confirmUnsubscribeChannels([channel])
									: undefined}
								onChannelClick={() => setChannelId(video.snippet.channelId)}
								onTagClick={(tag) => setSearchTerm(tag)}
								onLinkClick={(url) => void openVideo(url)}
								onAddToDailyNote={async (videoData, file) => {
									await appendNoteContent(plugin.app, file, { text: `\n${videoData}` });
									await plugin.app.workspace.openLinkText(file.path, "", false);
									new Notice(`Added video to ${file.basename} and opened the note`);
								}}
								/>
							);
						})}
					</div>
					<p ref={endRef} className="liked-video-list-end">
						{visibleCount < filteredVideos.length
							? `${Math.min(visibleCount, filteredVideos.length)} of ${filteredVideos.length} videos`
							: `End of ${filteredVideos.length} ${filteredVideos.length === 1 ? "video" : "videos"}`}
					</p>
				</>
			)}
		</div>
	);
};
