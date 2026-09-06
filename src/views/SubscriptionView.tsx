import { Notice } from "obsidian";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, Rss, Search } from "lucide-react";
import { SearchBar } from "src/ui/SearchBar";
import { VideoCard } from "src/ui/VideoCard";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { ViewHeader } from "src/ui/ViewHeader";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { localStorageService } from "src/storage";
import { UI_TEXT } from "src/constants/uiText";
import type { SubscriptionProgress, SubscriptionSnapshot } from "src/services/subscriptionService";
import type { ContentTypeOption, ContentTypeSelection, YouTubeVideo } from "src/types";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { usePlugin } from "../store/pluginContext";

export type SubscriptionPeriod = "all" | "day" | "week" | "month";

export interface SubscriptionViewState {
	searchTerm: string;
	channelId: string;
	period: SubscriptionPeriod;
	contentTypes: ContentTypeSelection;
}

interface SubscriptionViewProps {
	initialState: SubscriptionViewState;
	refreshVersion: number;
	onRequestRefresh: () => void;
	onStateChange: (state: SubscriptionViewState) => void;
}

const VIDEOS_PER_BATCH = 30;
const SHORT_VIDEO_MAX_DURATION_SECONDS = 90;

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
	const cachedSnapshot = plugin.subscriptionService.getSnapshot();
	const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(cachedSnapshot);
	const [pendingSnapshot, setPendingSnapshot] = useState<SubscriptionSnapshot | null>(null);
	const [searchTerm, setSearchTerm] = useState(initialState.searchTerm);
	const [channelId, setChannelId] = useState(initialState.channelId);
	const [period, setPeriod] = useState<SubscriptionPeriod>(initialState.period);
	const [contentTypes, setContentTypes] = useState<ContentTypeSelection>(initialState.contentTypes);
	const [visibleCount, setVisibleCount] = useState(VIDEOS_PER_BATCH);
	const [progress, setProgress] = useState<SubscriptionProgress | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(
		() => new Set(localStorageService.getLikedVideos().map((video) => video.id)),
	);
	const abortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		onStateChange({ searchTerm, channelId, period, contentTypes });
		setVisibleCount(VIDEOS_PER_BATCH);
	}, [searchTerm, channelId, period, contentTypes, onStateChange]);

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
			const isShort = durationSeconds > 0 && durationSeconds <= SHORT_VIDEO_MAX_DURATION_SECONDS;
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
	}, [snapshot, searchTerm, channelId, period, contentTypes]);

	const displayedVideos = useMemo(
		() => filteredVideos.slice(0, visibleCount),
		[filteredVideos, visibleCount],
	);
	const noteExistenceMap = useNoteExistenceMap(plugin, displayedVideos);
	const newVideoCount = useMemo(() => {
		if (!snapshot || !pendingSnapshot) return 0;
		const currentIds = new Set(snapshot.videos.map((video) => video.id));
		return pendingSnapshot.videos.filter((video) => !currentIds.has(video.id)).length;
	}, [snapshot, pendingSnapshot]);

	const handleLikeVideo = async (video: YouTubeVideo): Promise<void> => {
		try {
			await plugin.likedVideoApi.likeVideo(video.id);
			localStorageService.setLikedVideos([video, ...localStorageService.getLikedVideos()]);
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
			localStorageService.setLikedVideos(
				localStorageService.getLikedVideos().filter((likedVideo) => likedVideo.id !== video.id),
			);
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

	if (!snapshot && !isLoading && !error) {
		return (
			<div className="subscription-view">
				<ViewHeader icon={<Rss className="video-view-header__icon" />} title="Subscriptions" />
				<div className="no-videos-found">
					<Rss size={48} />
					<div className="no-videos-found__title">Subscriptions are not loaded</div>
					<div className="no-videos-found__text">Load the latest 10 uploads from each subscribed channel when you are ready.</div>
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
				<ViewHeader icon={<Rss className="video-view-header__icon" />} title="Subscriptions" />
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
				<ViewHeader icon={<Rss className="video-view-header__icon" />} title="Subscriptions" />
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
					<button type="button" className="refresh-button" onClick={onRequestRefresh} disabled={isLoading} title="Refresh subscriptions">
						<RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
					</button>
				}
			/>

			<div className="subscription-status">
				<span>{snapshot ? formatUpdatedAt(snapshot.updatedAt) : "Not updated"}</span>
				<span>Latest 10 uploads per channel</span>
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

			{snapshot && snapshot.failedChannels.length > 0 && (
				<div className="subscription-warning">
					<span>{snapshot.failedChannels.length} channels could not be updated.</span>
					<button type="button" onClick={() => void retryFailedChannels()} disabled={isLoading}>Retry</button>
				</div>
			)}

			{error && snapshot && <div className="subscription-warning">{error}</div>}

			<div className="subscription-search">
				<SearchBar searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />
			</div>
			<div className="subscription-filters">
				<select value={channelId} onChange={(event) => setChannelId(event.target.value)} aria-label="Filter by channel">
					<option value="all">All channels</option>
					{(snapshot?.channels ?? []).map((channel) => (
						<option key={channel.id} value={channel.id}>{channel.title}</option>
					))}
				</select>
				<select value={period} onChange={(event) => setPeriod(event.target.value as SubscriptionPeriod)} aria-label="Filter by published date">
					<option value="all">All collected videos</option>
					<option value="day">Last 24 hours</option>
					<option value="week">Last 7 days</option>
					<option value="month">Last 30 days</option>
				</select>
				<span>{filteredVideos.length} videos</span>
			</div>
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

			{snapshot?.channels.length === 0 ? (
				<div className="no-videos-found">
					<Rss size={48} />
					<div className="no-videos-found__title">No subscriptions found</div>
					<div className="no-videos-found__text">Subscribe to channels on YouTube to see their latest videos here.</div>
				</div>
			) : filteredVideos.length === 0 ? (
				<div className="no-videos-found">
					<Search size={48} />
					<div className="no-videos-found__title">No matching videos</div>
					<div className="no-videos-found__text">No collected videos match these filters.</div>
				</div>
			) : (
				<>
					<div className="videos-grid">
						{displayedVideos.map((video) => (
							<VideoCard
								key={video.id}
								source="subscription"
								videoInfo={video}
								id={video.id}
								url={`https://www.youtube.com/watch?v=${video.id}`}
								noteExists={noteExistenceMap.get(video.id) ?? false}
								isLiked={likedVideoIds.has(video.id)}
								onLike={() => handleLikeVideo(video)}
								onUnlike={() => handleUnlikeVideo(video)}
								onChannelClick={() => setChannelId(video.snippet.channelId)}
								onTagClick={(tag) => setSearchTerm(tag)}
								onLinkClick={(url) => void openVideo(url)}
								onAddToDailyNote={async (videoData, file) => {
									await appendNoteContent(plugin.app, file, { text: `\n${videoData}` });
									await plugin.app.workspace.openLinkText(file.path, "", false);
									new Notice(`Added video to ${file.basename} and opened the note`);
								}}
							/>
						))}
					</div>
					{visibleCount < filteredVideos.length && (
						<button type="button" className="subscription-load-more" onClick={() => setVisibleCount((count) => count + VIDEOS_PER_BATCH)}>
							Show more
						</button>
					)}
				</>
			)}
		</div>
	);
};
