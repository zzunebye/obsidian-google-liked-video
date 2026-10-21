import { Menu, Modal, Notice } from "obsidian";
import { getFormatLocale, t } from "../i18n";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
	AlertCircle,
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	ExternalLink,
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
import {
	classifyVideoContent,
	getVideoLanguageLabel,
	matchesDurationFilter,
	normalizeVideoLanguage,
	parseDurationToSeconds,
} from "src/utils/videoUtils";
import {
	AI_SUMMARY_FILTER_OPTIONS,
	DURATION_FILTER_OPTIONS,
	getLanguageFilterOptions,
} from "src/utils/videoFilterOptions";
import { categoriesService } from "src/categoriesService";
import { ContentTypeDropdown, formatContentTypeSelection } from "src/ui/ContentTypeDropdown";
import { LikedVideoFilterSelect } from "src/ui/LikedVideoFilterSelect";
import { LikedVideoCollection } from "src/ui/LikedVideoCollection";
import { useLikedVideoFocus } from "src/hooks/useLikedVideoFocus";
import { ViewHeader } from "src/ui/ViewHeader";
import { OpenYouTubeButton } from "src/ui/OpenYouTubeButton";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { localStorageService } from "src/storage";
import type { SubscriptionProgress, SubscriptionSnapshot } from "src/services/subscriptionService";
import type {
	DurationFilter,
	PresenceFilter,
	ContentTypeSelection,
	SubscriptionChannel,
	YouTubeVideo,
} from "src/types";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { likeVideoAndPersist, unlikeVideoAndPersist } from "src/services/likedVideoMutationService";
import { CacheOwnershipError } from "src/services/youtubeAccountIdentityService";
import { usePlugin } from "../store/pluginContext";

export type SubscriptionPeriod = "all" | "day" | "week" | "month" | "year";
export type SubscriptionSortOrder = "ASC" | "DESC";

export interface SubscriptionViewState {
	searchTerm: string;
	selectedTag: string | null;
	selectedCategory: string;
	sortOption: SubscriptionSortOption;
	aiSummaryFilter: PresenceFilter;
	videoNoteFilter: PresenceFilter;
	durationFilter: DurationFilter;
	audioLanguageFilter: string;
	languageFilter: string;
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

const SORT_OPTIONS = [
	{ value: "viewCount", label: t("sort.viewCount") },
	{ value: "averageViewsPerDay", label: t("sort.averageViewsPerDay") },
	{ value: "likeCount", label: t("sort.likeCount") },
	{ value: "commentCount", label: t("sort.commentCount") },
	{ value: "likeViewRatio", label: t("sort.likeViewRatio") },
	{ value: "date", label: t("sort.publishedDate") },
	{ value: "title", label: t("sort.title") },
	{ value: "channelTitle", label: t("sort.channel") },
	{ value: "duration", label: t("sort.duration") },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const PERIOD_FILTER_OPTIONS: ReadonlyArray<{
	value: SubscriptionPeriod;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: t("filter.anyTime"), activeLabel: t("filter.anyUploadDate") },
	{ value: "day", label: t("subscription.last24Hours"), activeLabel: t("subscription.last24Hours") },
	{ value: "week", label: t("subscription.past7Days"), activeLabel: t("subscription.past7Days") },
	{ value: "month", label: t("subscription.past30Days"), activeLabel: t("subscription.past30Days") },
	{ value: "year", label: t("filter.pastYear"), activeLabel: t("filter.pastYear") },
];

const FilterChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
	<button type="button" className="active-tag-filter__chip" title={`${t("filter.clearFilter")}: ${label}`} onClick={onClear}>
		<span className="active-tag-filter__label">{label}</span>
		<span className="active-tag-filter__remove" aria-hidden="true">×</span>
	</button>
);

export type SubscriptionSortOption = typeof SORT_OPTIONS[number]["value"];

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function formatUpdatedAt(updatedAt: number): string {
	const elapsedMinutes = Math.floor((Date.now() - updatedAt) / 60000);
	if (elapsedMinutes < 1) return t("subscription.updatedJustNow");
	if (elapsedMinutes < 60) return t("subscription.updatedMinutesAgo", { count: elapsedMinutes });
	return `${t("subscription.lastChecked")} ${new Date(updatedAt).toLocaleString(getFormatLocale())}`;
}

function formatSubscriptionCutoffDate(maxAgeDays: number): string {
	return new Date(Date.now() - maxAgeDays * DAY_MS).toLocaleDateString(getFormatLocale(), {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function getPeriodStart(period: SubscriptionPeriod): number | null {
	const now = Date.now();
	if (period === "day") return now - DAY_MS;
	if (period === "week") return now - 7 * DAY_MS;
	if (period === "month") return now - 30 * DAY_MS;
	if (period === "year") return now - 365 * DAY_MS;
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
	const subscriptionCutoffDate = formatSubscriptionCutoffDate(plugin.settings.subscriptionVideoMaxAgeDays);
	const cachedSnapshot = plugin.subscriptionService.getSnapshot();
	const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(cachedSnapshot);
	const [pendingSnapshot, setPendingSnapshot] = useState<SubscriptionSnapshot | null>(null);
	const keyboardFocus = useLikedVideoFocus(snapshot !== null);
	const filtersId = useId();
	const videos = useMemo(() => snapshot?.videos ?? [], [snapshot]);
	const noteExistenceMap = useNoteExistenceMap(plugin, videos);
	const [summaryVersion, setSummaryVersion] = useState(0);
	const [collectionVersion, setCollectionVersion] = useState(0);
	const [searchTerm, setSearchTerm] = useState(initialState.searchTerm);
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(initialState.searchTerm.trim());
	const [selectedTag, setSelectedTag] = useState(initialState.selectedTag ?? null);
	const [selectedCategory, setSelectedCategory] = useState(initialState.selectedCategory ?? "all");
	const [sortOption, setSortOption] = useState<SubscriptionSortOption>(initialState.sortOption ?? "date");
	const [aiSummaryFilter, setAISummaryFilter] = useState<PresenceFilter>(initialState.aiSummaryFilter ?? "all");
	const [videoNoteFilter, setVideoNoteFilter] = useState<PresenceFilter>(initialState.videoNoteFilter ?? "all");
	const [durationFilter, setDurationFilter] = useState<DurationFilter>(initialState.durationFilter ?? "all");
	const [audioLanguageFilter, setAudioLanguageFilter] = useState(initialState.audioLanguageFilter ?? "all");
	const [languageFilter, setLanguageFilter] = useState(initialState.languageFilter ?? "all");
	const [pendingLikeIds, setPendingLikeIds] = useState<ReadonlySet<string>>(new Set());
	const pendingLikeIdsRef = useRef(new Set<string>());
	const [channelId, setChannelId] = useState(initialState.channelId);
	const [period, setPeriod] = useState<SubscriptionPeriod>(initialState.period);
	const [contentTypes, setContentTypes] = useState<ContentTypeSelection>(initialState.contentTypes);
	const [sortOrder, setSortOrder] = useState<SubscriptionSortOrder>(initialState.sortOrder);
	const [filtersExpanded, setFiltersExpanded] = useState(initialState.filtersExpanded);
	const [dismissedFailureUpdatedAt, setDismissedFailureUpdatedAt] = useState(
		initialState.dismissedFailureUpdatedAt,
	);
	const [progress, setProgress] = useState<SubscriptionProgress | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isUnsubscribing, setIsUnsubscribing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(
		() => new Set(localStorageService.getLikedVideos().map((video) => video.id)),
	);
	const abortControllerRef = useRef<AbortController | null>(null);

	const openPluginSettings = (): void => {
		if (!plugin.settingTabRef?.openVideoDisplaySettings()) {
			new Notice(t("playlist.openError"));
		}
	};

	const settingsAction = (
		<button
			type="button"
			title={t("common.settings")}
			aria-label={t("common.settings")}
			onClick={openPluginSettings}
		>
			<Settings size={16} />
		</button>
	);

	useEffect(() => {
		onStateChange({
			searchTerm,
			selectedTag, selectedCategory, sortOption, aiSummaryFilter, videoNoteFilter,
			durationFilter, audioLanguageFilter, languageFilter,
			channelId,
			period,
			contentTypes,
			sortOrder,
			filtersExpanded,
			dismissedFailureUpdatedAt,
		});
	}, [
		searchTerm,
		selectedTag, selectedCategory, sortOption, aiSummaryFilter, videoNoteFilter,
		durationFilter, audioLanguageFilter, languageFilter,
		channelId,
		period,
		contentTypes,
		sortOrder,
		filtersExpanded,
		dismissedFailureUpdatedAt,
		onStateChange,
	]);

	useEffect(() => {
		const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 300);
		return () => window.clearTimeout(timer);
	}, [searchTerm]);

	useEffect(() => plugin.summaryStorage.subscribe(() => {
		setSummaryVersion((version) => version + 1);
	}), [plugin.summaryStorage]);

	useEffect(() => localStorageService.subscribeLikedVideos((likedVideos) => {
		setLikedVideoIds(new Set(likedVideos.map((video) => video.id)));
	}), []);

	const runFetch = async (stageResult: boolean): Promise<void> => {
		abortControllerRef.current?.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;
		setIsLoading(true);
		setError(null);
		setProgress(null);
		try {
			const ownership = await plugin.prepareSubscriptionSync();
			if (!ownership || controller.signal.aborted) return;
			const result = await plugin.subscriptionService.fetch({
				signal: controller.signal,
				onProgress: setProgress,
				ownerChannelId: ownership.ownerChannelId,
				replaceExisting: ownership.replaceExisting,
			});
			if (controller.signal.aborted) return;
			if (stageResult && snapshot && !ownership.replaceExisting) setPendingSnapshot(result);
			else setSnapshot(result);
		} catch (fetchError) {
			if (!isAbortError(fetchError)) {
				setError(fetchError instanceof Error ? fetchError.message : t("subscription.loadFailed"));
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

	// Get categories ready state
	const isCategoriesReady = categoriesService.isReady();

	// Get available categories for filtering
	const availableCategories = useMemo(() => {
		if (!isCategoriesReady) {
			return [];
		}

		// Get unique categories from current videos
		const videoCategories = new Set(
			videos.map((video) => video.snippet.categoryId),
		);
		const allCategories = categoriesService.getAllCategories();

		// Only show categories that exist in the current video collection
		return allCategories.filter((category) =>
			videoCategories.has(category.id),
		);
	}, [videos, isCategoriesReady]);

	// Calculate category counts
	const categoryCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		videos.forEach((video) => {
			const categoryId = video.snippet.categoryId;
			if (categoryId) {
				counts[categoryId] = (counts[categoryId] || 0) + 1;
			}
		});
		return counts;
	}, [videos]);

	const audioLanguageOptions = useMemo(() =>
		getLanguageFilterOptions(videos, "defaultAudioLanguage", audioLanguageFilter),
	[videos, audioLanguageFilter]);
	const languageOptions = useMemo(() =>
		getLanguageFilterOptions(videos, "defaultLanguage", languageFilter),
	[videos, languageFilter]);

	// Pre-process video durations once
	const videoDurations = useMemo(() => {
		const durations = new Map<string, number | null>();
		videos.forEach((video) => {
			durations.set(
				video.id,
				parseDurationToSeconds(video.contentDetails?.duration),
			);
		});
		return durations;
	}, [videos]);

	const videoSortMetrics = useMemo(() => {
		const metrics = new Map<string, {
			averageViewsPerDay: number | null;
			likeViewRatio: number | null;
		}>();
		const nowMs = Date.now();
		videos.forEach((video) => {
			// API counts may be numeric strings; missing counts must not become zero.
			const views = Number(video.statistics.viewCount ?? NaN);
			const likes = Number(video.statistics.likeCount ?? NaN);
			const hasViews = Number.isFinite(views) && views > 0;
			const publishedAtMs = Date.parse(video.snippet.publishedAt);
			const ageInDays = Math.max((nowMs - publishedAtMs) / DAY_MS, 1);
			metrics.set(video.id, {
				averageViewsPerDay: hasViews && Number.isFinite(publishedAtMs) && publishedAtMs <= nowMs
					? views / ageInDays : null,
				likeViewRatio: hasViews && Number.isFinite(likes) && likes >= 0
					? likes / views : null,
			});
		});
		return metrics;
	}, [videos]);
	const activeSortMetric = sortOption === "averageViewsPerDay" || sortOption === "likeViewRatio"
		? sortOption : undefined;


	const filteredVideos = useMemo(() => {
		// Pre-calculate lowercase search term once
		const lowerSearchTerm = debouncedSearchTerm.toLowerCase();
		const nowMs = Date.now();
		const periodStart = getPeriodStart(period);

		return videos.filter((video) => {
			// Search filter - only calculate if search term exists
			let searchMatch = true;
			if (lowerSearchTerm) {
				const titleMatch = video.snippet.title
					.toLowerCase()
					.includes(lowerSearchTerm);
				const tagsMatch = (video.snippet.tags ?? []).some((tag) =>
					tag.toLowerCase().includes(lowerSearchTerm),
				);
				const channelMatch = video.snippet.channelTitle
					.toLowerCase()
					.includes(lowerSearchTerm);
				searchMatch = titleMatch || tagsMatch || channelMatch;
			}

			const exactTagMatch =
				selectedTag === null ||
				(video.snippet.tags ?? []).some(
					(tag) => tag.toLowerCase() === selectedTag.toLowerCase(),
				);
			const channelMatch = channelId === "all" ||
				video.snippet.channelId === channelId;

			// Category filter
			const categoryMatch =
				selectedCategory === "all" ||
				video.snippet.categoryId === selectedCategory;

			// Content type filter (OR logic - show if matches ANY selected type)
			const durationSeconds = videoDurations.get(video.id) ?? null;
			const { isMusic, isShort, isRegularVideo } = classifyVideoContent(
				video,
				shortVideoMaxDurationSeconds,
				durationSeconds ?? 0,
			);

			let contentTypeMatch = true;
			// If no selection or all selected, show everything
			if (
				contentTypes.length > 0 &&
				contentTypes.length < 3
			) {
				contentTypeMatch = false;
				if (contentTypes.includes("videos") && isRegularVideo) {
					contentTypeMatch = true;
				}
				if (contentTypes.includes("shorts") && isShort) {
					contentTypeMatch = true;
				}
				if (contentTypes.includes("music") && isMusic) {
					contentTypeMatch = true;
				}
			}

			const hasAISummary = plugin.summaryStorage.hasVideoSummary(video.id);
			const aiSummaryMatch = aiSummaryFilter === "all" ||
				(aiSummaryFilter === "with" ? hasAISummary : !hasAISummary);
			const hasVideoNote = noteExistenceMap.get(video.id) ?? false;
			const videoNoteMatch = videoNoteFilter === "all" ||
				(videoNoteFilter === "with" ? hasVideoNote : !hasVideoNote);
			const publishedAt = Date.parse(video.snippet.publishedAt);
			const publishedDateMatch = periodStart === null ||
				(Number.isFinite(publishedAt) && publishedAt >= periodStart && publishedAt <= nowMs);
			const durationMatch = matchesDurationFilter(durationSeconds, durationFilter);
			const audioLanguageMatch = audioLanguageFilter === "all" ||
				normalizeVideoLanguage(video.snippet.defaultAudioLanguage) === audioLanguageFilter;
			const languageMatch = languageFilter === "all" ||
				normalizeVideoLanguage(video.snippet.defaultLanguage) === languageFilter;

			return (
				searchMatch &&
				exactTagMatch &&
				channelMatch &&
				categoryMatch &&
				contentTypeMatch &&
				aiSummaryMatch &&
				videoNoteMatch &&
				publishedDateMatch &&
				durationMatch &&
				audioLanguageMatch &&
				languageMatch
			);
		});
	}, [
		videos,
		debouncedSearchTerm,
		selectedTag,
		channelId,
		selectedCategory,
		contentTypes,
		shortVideoMaxDurationSeconds,
		videoDurations,
		aiSummaryFilter,
		period,
		durationFilter,
		audioLanguageFilter,
		languageFilter,
		videoNoteFilter,
		noteExistenceMap,
		summaryVersion,
	]);

	const sortedVideos = useMemo(() => {
		const sorted = [...filteredVideos];
		switch (sortOption) {
			case "title":
				sorted.sort((a, b) =>
					a.snippet.title.localeCompare(b.snippet.title),
				);
				break;
			case "channelTitle":
				sorted.sort((a, b) =>
					a.snippet.channelTitle.localeCompare(b.snippet.channelTitle),
				);
				break;
			case "viewCount":
				sorted.sort(
					(a, b) => a.statistics.viewCount - b.statistics.viewCount,
				);
				break;
			case "averageViewsPerDay":
				sorted.sort((a, b) =>
					(videoSortMetrics.get(a.id)?.averageViewsPerDay ?? 0) -
					(videoSortMetrics.get(b.id)?.averageViewsPerDay ?? 0));
				break;
			case "likeCount":
				sorted.sort(
					(a, b) => a.statistics.likeCount - b.statistics.likeCount,
				);
				break;
			case "commentCount":
				sorted.sort((a, b) => {
					const aCommentCount =
						parseInt(a.statistics.commentCount) || 0;
					const bCommentCount =
						parseInt(b.statistics.commentCount) || 0;
					return aCommentCount - bCommentCount;
				});
				break;
			case "likeViewRatio":
				sorted.sort((a, b) =>
					(videoSortMetrics.get(a.id)?.likeViewRatio ?? -1) -
					(videoSortMetrics.get(b.id)?.likeViewRatio ?? -1));
				break;

			case "date":
				sorted.sort(
					(a, b) =>
						new Date(a.snippet.publishedAt).getTime() -
						new Date(b.snippet.publishedAt).getTime(),
				);
				break;
			case "duration":
				sorted.sort((a, b) => {
					const aDuration = videoDurations.get(a.id) ?? 0;
					const bDuration = videoDurations.get(b.id) ?? 0;
					return aDuration - bDuration;
				});
				break;
		}
		if (sortOrder === "DESC") {
			sorted.reverse();
		}
		return sorted;
	}, [filteredVideos, sortOption, videos, sortOrder, videoDurations, videoSortMetrics]);

	const newVideoCount = useMemo(() => {
		if (!snapshot || !pendingSnapshot) return 0;
		const currentIds = new Set(snapshot.videos.map((video) => video.id));
		return pendingSnapshot.videos.filter((video) => !currentIds.has(video.id)).length;
	}, [snapshot, pendingSnapshot]);
	const hasRetryableFailures = snapshot?.failedChannels.some(
		(channel) => snapshot.failureDetails[channel.id]?.retryable !== false,
	) ?? false;
	const hasContentTypeFilter = contentTypes.length > 0 && contentTypes.length < 3;
	const activeFilterCount = Number(selectedTag !== null) + Number(channelId !== "all") +
		Number(selectedCategory !== "all") + Number(hasContentTypeFilter) + Number(aiSummaryFilter !== "all") +
		Number(videoNoteFilter !== "all") + Number(period !== "all") +
		Number(durationFilter !== "all") + Number(audioLanguageFilter !== "all") + Number(languageFilter !== "all");
	const selectedCategoryTitle = availableCategories.find((category) =>
		category.id === selectedCategory)?.title ?? selectedCategory;
	const contentTypeFilterLabel = formatContentTypeSelection(contentTypes);
	const aiSummaryFilterLabel = AI_SUMMARY_FILTER_OPTIONS.find((option) =>
		option.value === aiSummaryFilter)?.activeLabel ?? aiSummaryFilter;
	const periodLabel = PERIOD_FILTER_OPTIONS.find((option) =>
		option.value === period)?.activeLabel ?? period;
	const durationFilterLabel = DURATION_FILTER_OPTIONS.find((option) =>
		option.value === durationFilter)?.activeLabel ?? durationFilter;
	const hasActiveQuery = debouncedSearchTerm.length > 0 || activeFilterCount > 0;
	const selectedSortLabel = SORT_OPTIONS.find((option) => option.value === sortOption)?.label;
	const sortDirectionLabel = sortOption === "title" || sortOption === "channelTitle"
		? sortOrder === "ASC" ? t("sort.aToZ") : t("sort.zToA")
		: sortOption === "date"
			? sortOrder === "ASC" ? t("sort.oldestFirst") : t("sort.newestFirst")
			: sortOrder === "ASC" ? t("sort.lowestFirst") : t("sort.highestFirst");

	const browsingKey = JSON.stringify([debouncedSearchTerm, selectedTag, channelId, period,
		contentTypes, sortOption, sortOrder, selectedCategory, aiSummaryFilter, videoNoteFilter,
		durationFilter, audioLanguageFilter, languageFilter, collectionVersion]);
	const selectedChannel = snapshot?.channels.find((channel) => channel.id === channelId);

	const handleLikeVideo = async (video: YouTubeVideo): Promise<void> => {
		if (pendingLikeIdsRef.current.has(video.id)) return;
		pendingLikeIdsRef.current.add(video.id);
		setPendingLikeIds(new Set(pendingLikeIdsRef.current));
		try {
			await likeVideoAndPersist(plugin.likedVideoApi, video, 0, plugin.videoNotes.captureLikedUpdate());
			setLikedVideoIds((current) => new Set(current).add(video.id));
			new Notice(`${t("subscription.likedPrefix")} "${video.snippet.title}"`);
		} catch (likeError) {
			console.error("Failed to like subscription video:", likeError);
			new Notice(likeError instanceof CacheOwnershipError
				? likeError.message : t("subscription.likeFailed"));
		} finally {
			pendingLikeIdsRef.current.delete(video.id);
			setPendingLikeIds(new Set(pendingLikeIdsRef.current));
		}
	};

	const handleUnlikeVideo = async (video: YouTubeVideo): Promise<void> => {
		if (pendingLikeIdsRef.current.has(video.id)) return;
		pendingLikeIdsRef.current.add(video.id);
		setPendingLikeIds(new Set(pendingLikeIdsRef.current));
		try {
			const likedVideos = localStorageService.getLikedVideos();
			const index = likedVideos.findIndex((item) => item.id === video.id);
			const previousVideoId = index > 0 ? likedVideos[index - 1].id : null;
			await unlikeVideoAndPersist(plugin.likedVideoApi, video.id, plugin.videoNotes.captureLikedUpdate());
			setLikedVideoIds((current) => {
				const next = new Set(current);
				next.delete(video.id);
				return next;
			});
			const fragment = new DocumentFragment();
			fragment.createSpan({ text: `${t("subscription.unlikedPrefix")} "${video.snippet.title}" ` });
			const undoButton = fragment.createEl("button", { text: t("liked.undo"), cls: "geulo-undo-btn" });
			const notice = new Notice(fragment, 5000);
			undoButton.addEventListener("click", () => {
				if (pendingLikeIdsRef.current.has(video.id)) return;
				pendingLikeIdsRef.current.add(video.id);
				setPendingLikeIds(new Set(pendingLikeIdsRef.current));
				undoButton.disabled = true;
				void (async () => {
					try {
						await likeVideoAndPersist(plugin.likedVideoApi, video, () => {
							const current = localStorageService.getLikedVideos();
							const previousIndex = previousVideoId
								? current.findIndex((item) => item.id === previousVideoId) : -1;
							return previousIndex >= 0 ? previousIndex + 1 : Math.max(0, Math.min(index, current.length));
						}, plugin.videoNotes.captureLikedUpdate());
						setLikedVideoIds((current) => new Set(current).add(video.id));
						notice.hide();
					} catch (undoError) {
						console.error("Failed to undo subscription video unlike:", undoError);
						new Notice(undoError instanceof CacheOwnershipError
							? undoError.message : t("subscription.likeFailed"));
						undoButton.disabled = false;
					} finally {
						pendingLikeIdsRef.current.delete(video.id);
						setPendingLikeIds(new Set(pendingLikeIdsRef.current));
					}
				})();
			});
		} catch (unlikeError) {
			console.error("Failed to unlike subscription video:", unlikeError);
			new Notice(unlikeError instanceof CacheOwnershipError
				? unlikeError.message : t("subscription.unlikeFailed"));
		} finally {
			pendingLikeIdsRef.current.delete(video.id);
			setPendingLikeIds(new Set(pendingLikeIdsRef.current));
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

	const openChannel = (channel: SubscriptionChannel): void => {
		const url = `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`;
		window.open(url, "_blank");
	};

	const applyPendingSnapshot = (): void => {
		if (!pendingSnapshot) return;
		setSnapshot(pendingSnapshot);
		setPendingSnapshot(null);
		setCollectionVersion((version) => version + 1);
	};

	const retryFailedChannels = async (): Promise<void> => {
		abortControllerRef.current?.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;
		setIsLoading(true);
		setError(null);
		try {
			await plugin.requireSubscriptionCacheOwnership();
			const result = await plugin.subscriptionService.retryFailed({
				signal: controller.signal,
				onProgress: setProgress,
			});
			if (!controller.signal.aborted) setPendingSnapshot(result);
		} catch (retryError) {
			if (!isAbortError(retryError)) {
				setError(retryError instanceof Error ? retryError.message : t("subscription.retryChannelsFailed"));
			}
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null;
				setIsLoading(false);
				setProgress(null);
			}
		}
	};

	const handleTagClick = (tag: string) => {
		setSelectedTag((current) =>
			current?.toLowerCase() === tag.toLowerCase() ? null : tag,
		);
	};

	const handleViewKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		keyboardFocus.handleKeyDown(event);
		if (
			event.key !== "Escape" ||
			event.defaultPrevented ||
			searchTerm.length === 0
		) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setSearchTerm("");
	};
	const clearAllFilters = (): void => {
		setSearchTerm("");
		setDebouncedSearchTerm("");
		setSelectedTag(null);
		setChannelId("all");
		setSelectedCategory("all");
		setContentTypes([]);
		setAISummaryFilter("all");
		setVideoNoteFilter("all");
		setPeriod("all");
		setDurationFilter("all");
		setAudioLanguageFilter("all");
		setLanguageFilter("all");
	};

	const openSortMenu = (event: MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu().setUseNativeMenu(false);
		menu.addItem((item) => item.setTitle(t("liked.sortBy")).setIsLabel(true));
		SORT_OPTIONS.forEach((option) => {
			menu.addItem((item) => item
				.setTitle(option.label)
				.setChecked(sortOption === option.value)
				.onClick(() => setSortOption(option.value)));
		});
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(t("liked.ascending"))
			.setChecked(sortOrder === "ASC")
			.onClick(() => setSortOrder("ASC")));
		menu.addItem((item) => item
			.setTitle(t("liked.descending"))
			.setChecked(sortOrder === "DESC")
			.onClick(() => setSortOrder("DESC")));
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom }, event.currentTarget.ownerDocument);
	};


	const unsubscribeChannels = async (channels: SubscriptionChannel[]): Promise<void> => {
		setIsUnsubscribing(true);
		try {
			await plugin.requireSubscriptionCacheOwnership();
			const result = await plugin.subscriptionService.unsubscribeChannels(channels);
			setSnapshot(result.snapshot);
			setPendingSnapshot(null);
			if (result.succeededChannels.some((channel) => channel.id === channelId)) {
				setChannelId("all");
			}
			if (result.succeededChannels.length === 1) {
				new Notice(`${t("subscription.unsubscribedPrefix")} ${result.succeededChannels[0].title} ${t("subscription.unsubscribedSuffix")}`);
			} else if (result.succeededChannels.length > 1) {
				new Notice(t("subscription.unsubscribedMany", { count: result.succeededChannels.length }));
			}
			if (result.failedChannels.length === 1) {
				new Notice(`${t("subscription.unsubscribeFailedPrefix")} ${result.failedChannels[0].channel.title} ${t("subscription.unsubscribedFailedSuffix")}`, 8000);
			} else if (result.failedChannels.length > 1) {
				new Notice(t("subscription.unsubscribeFailedMany", { count: result.failedChannels.length }), 8000);
			}
		} catch (unsubscribeError) {
			new Notice(
				unsubscribeError instanceof Error
					? unsubscribeError.message
					: t("subscription.failedCacheUpdate"),
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
					? `${t("subscription.confirmUnsubscribeTitle")} ${singleChannel.title}?`
					: t("subscription.confirmUnsubscribeMany", { count: channels.length }),
		);
		modal.contentEl.createEl("p", {
			text: t("subscription.confirmUnsubscribeHelp"),
		});
		if (!singleChannel) {
			const channelList = modal.contentEl.createEl("ul");
			channels.forEach((channel) => channelList.createEl("li", { text: channel.title }));
		}
		modal.contentEl.createEl("p", {
				text: `${t("subscription.quota")} ${quotaUnits} ${t("subscription.quotaHelp")}`,
			cls: "subscription-unsubscribe__quota",
		});
		const actions = modal.contentEl.createDiv({ cls: "subscription-unsubscribe__actions" });
		const cancelButton = actions.createEl("button", { text: t("settings.cancel") });
		cancelButton.addEventListener("click", () => modal.close());
		const unsubscribeButton = actions.createEl("button", {
			text: t("subscription.unsubscribe"),
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
					title={t("subscription.title")}
					actions={settingsAction}
				/>
				<div className="no-videos-found">
					<Rss size={32} aria-hidden="true" />
					<div className="no-videos-found__title">{t("subscription.loadUnloaded")}</div>
					<div className="no-videos-found__text">{t("subscription.loadPromptText")}</div>
					<button type="button" className="videos-error__retry-button" onClick={() => void runFetch(false)}>
						<RefreshCw size={16} /> {t("subscription.loadButtonText")}
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
					title={t("subscription.title")}
					actions={settingsAction}
				/>
				<div className="subscription-loading">
					<Loader2 size={24} className="animate-spin" />
					<span role="status" aria-atomic="true">{t("subscription.loadingStatus")}</span>
					{progress && <span>{progress.completedChannels} / {progress.totalChannels} {t("subscription.channelsCheckedLabel")}</span>}
					<button type="button" onClick={() => abortControllerRef.current?.abort()}>{t("subscription.stop")}</button>
				</div>
			</div>
		);
	}

	if (!snapshot && error) {
		return (
			<div className="subscription-view">
				<ViewHeader
					icon={<Rss className="video-view-header__icon" />}
					title={t("subscription.title")}
					actions={settingsAction}
				/>
				<div className="videos-error" role="alert">
					<AlertCircle size={48} />
					<div className="videos-error__title">{t("subscription.loadError")}</div>
					<div className="videos-error__message">{error}</div>
					<button type="button" className="videos-error__retry-button" onClick={onRequestRefresh}>
						<RefreshCw size={16} /> {t("subscription.tryAgain")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div ref={keyboardFocus.viewRef} className="subscription-view" onKeyDown={handleViewKeyDown}>
			<ViewHeader
				icon={<Rss className="video-view-header__icon" />}
				title={t("subscription.title")}
				badge={`${snapshot?.channels.length ?? 0} ${t("subscription.channels")}`}
				actions={
					<>
						<button type="button" className="refresh-button" onClick={onRequestRefresh} disabled={isLoading} title={t("subscription.refresh")}>
							<RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
						</button>
						{settingsAction}
					</>
				}
			/>

			<div className="subscription-status">
				<span>{snapshot ? formatUpdatedAt(snapshot.updatedAt) : t("subscription.statusNotUpdated")}</span>
				<span>{t("subscription.latestUploadsStatus")} · {t("subscription.cutoffLabel")} {subscriptionCutoffDate}</span>
			</div>

			{isLoading && progress && (
				<div className="subscription-progress">
					<span>{progress.completedChannels} / {progress.totalChannels} channels checked</span>
					<progress aria-label={t("subscription.channelsCheckedLabel")} value={progress.completedChannels} max={Math.max(progress.totalChannels, 1)} />
							<button type="button" onClick={() => abortControllerRef.current?.abort()}>{t("subscription.stop")}</button>
				</div>
			)}

			{pendingSnapshot && (
				<div role="status" aria-atomic="true">
					<button type="button" className="subscription-new-videos" onClick={applyPendingSnapshot}>
						{newVideoCount > 0 ? t("subscription.showNewVideos", { count: newVideoCount }) : t("subscription.applyRefreshedVideos")}
					</button>
				</div>
			)}

			{snapshot && snapshot.failedChannels.length > 0
				&& dismissedFailureUpdatedAt !== snapshot.updatedAt && (
				<div className="subscription-warning">
					<div className="subscription-warning__header">
						<span role="status" aria-atomic="true">{t("subscription.failedChannelsCount", { count: snapshot.failedChannels.length })}</span>
						<div className="subscription-warning__actions">
							{hasRetryableFailures && (
								<button type="button" onClick={() => void retryFailedChannels()} disabled={isLoading}>{t("subscription.retry")}</button>
							)}
							<button
								type="button"
								className="subscription-warning__dismiss"
								onClick={() => setDismissedFailureUpdatedAt(snapshot.updatedAt)}
								aria-label={t("subscription.dismissFailure")}
								title={t("subscription.failureDismiss")}
							>
								<X size={16} />
							</button>
						</div>
					</div>
					<details className="subscription-warning__details">
						<summary>{t("subscription.showFailedChannels")}</summary>
						<ul>
							{snapshot.failedChannels.map((channel) => {
								const detail = snapshot.failureDetails[channel.id];
								return (
									<li key={channel.id}>
										<strong>{channel.title}</strong>
										<span>{detail?.message ?? t("subscription.failureUnrecordedHelp")}</span>
										<button
											type="button"
											className="subscription-warning__channel-link"
											onClick={() => openChannel(channel)}
											aria-label={t("subscription.openChannelOnYoutube")}
										>
											<ExternalLink size={14} aria-hidden="true" />
											<span>{t("subscription.openChannel")}</span>
										</button>
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
							{isUnsubscribing ? t("subscription.unsubscribingStatus") : t("subscription.unsubscribeSelected")}
						</button>
					</details>
				</div>
			)}

			{error && snapshot && <div className="subscription-warning" role="alert">{error}</div>}

			<div className="subscription-search search-bar-container">
				<div className="search-bar-wrapper">
					<SearchBar
						searchTerm={searchTerm}
						onSearchTermChange={setSearchTerm}
						escapeClearsSearch
						ariaLabel={t("subscription.searchLabel")}
					/>
				</div>
				<button
					type="button"
					className={`filter-toggle-button ${activeFilterCount > 0 ? "filter-toggle-button--active" : ""}`}
					title={
						filtersExpanded
							? t("filters.hide")
							: t("filters.show")
					}
					aria-expanded={filtersExpanded}
					aria-controls={filtersId}
					onClick={() => setFiltersExpanded((prev) => !prev)}
				>
					<SlidersHorizontal size={16} />
					{activeFilterCount > 0 && (
						<span className="filter-toggle-button__count">{activeFilterCount}</span>
					)}
				</button>
				<button
					type="button"
					className="sort-menu-button"
					title={`${t("liked.sortBy")}: ${selectedSortLabel}, ${sortDirectionLabel}`}
					aria-label={`${t("subscription.sortVideos")}. ${t("subscription.currentSort")}: ${selectedSortLabel}, ${sortDirectionLabel}`}
					aria-haspopup="menu"
					onClick={openSortMenu}
				>
					{sortOrder === "DESC" ? (
						<ArrowDownWideNarrow size={16} aria-hidden="true" />
					) : (
						<ArrowUpNarrowWide size={16} aria-hidden="true" />
					)}
				</button>
			</div>
			{activeFilterCount > 0 && (
				<div className="active-tag-filter active-filter-list" aria-label={t("filter.active")}>
					{selectedTag && <FilterChip label={`${t("filter.tag")}: ${selectedTag}`} onClear={() => setSelectedTag(null)} />}
					{channelId !== "all" && <FilterChip label={`${t("filter.channel")}: ${selectedChannel?.title ?? channelId}`} onClear={() => setChannelId("all")} />}
					{selectedCategory !== "all" && <FilterChip label={`${t("filter.category")}: ${selectedCategoryTitle}`} onClear={() => setSelectedCategory("all")} />}
					{hasContentTypeFilter && <FilterChip label={`${t("filter.type")}: ${contentTypeFilterLabel}`} onClear={() => setContentTypes([])} />}
					{aiSummaryFilter !== "all" && (
						<FilterChip label={`${t("filter.aiSummary")}: ${aiSummaryFilterLabel}`} onClear={() => setAISummaryFilter("all")} />
					)}
					{videoNoteFilter !== "all" && (
						<FilterChip label={videoNoteFilter === "with" ? t("filter.hasVideoNote") : t("filter.noVideoNote")} onClear={() => setVideoNoteFilter("all")} />
					)}
					{period !== "all" && (
						<FilterChip label={`${t("filter.uploadDate")}: ${periodLabel}`} onClear={() => setPeriod("all")} />
					)}
					{durationFilter !== "all" && (
						<FilterChip label={`${t("filter.duration")}: ${durationFilterLabel}`} onClear={() => setDurationFilter("all")} />
					)}
					{audioLanguageFilter !== "all" && (
						<FilterChip label={`${t("filter.audioLanguage")}: ${getVideoLanguageLabel(audioLanguageFilter)}`} onClear={() => setAudioLanguageFilter("all")} />
					)}
					{languageFilter !== "all" && (
						<FilterChip label={`${t("filter.language")}: ${getVideoLanguageLabel(languageFilter)}`} onClear={() => setLanguageFilter("all")} />
					)}
					<button type="button" className="active-filter-list__clear" onClick={clearAllFilters}>{t("filter.clearAll")}</button>
				</div>
			)}

			{filtersExpanded && (
				<div id={filtersId} className="filters-container liked-video-filters">
					<section className="liked-video-filter-group" aria-label={t("filter.channel")}>
						<h3 className="liked-video-filter-group__title">{t("filter.channel")}</h3>
						<div className="liked-video-filter-group__fields liked-video-filter-group__fields--category">
							<LikedVideoFilterSelect
								label={t("filter.channel")} ariaLabel={t("filter.channel")} showLabel={false}
								value={channelId} onChange={setChannelId}
								options={[
									{ value: "all", label: t("playlist.allChannels"), count: videos.length },
									...(snapshot?.channels ?? []).map((channel) => ({ value: channel.id, label: channel.title })),
								]}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label={t("filter.category")}>
						<h3 className="liked-video-filter-group__title">{t("filter.category")}</h3>
						<div className="liked-video-filter-group__fields liked-video-filter-group__fields--category">
							<LikedVideoFilterSelect
								label={t("filter.category")} ariaLabel={t("filter.category")} showLabel={false}
								value={selectedCategory} onChange={setSelectedCategory}
								disabled={!isCategoriesReady || availableCategories.length === 0}
								options={[
									{ value: "all", label: t("filter.all"), count: videos.length },
									...availableCategories.map((category) => ({
										value: category.id, label: category.title, count: categoryCounts[category.id] || 0,
									})),
									...(!isCategoriesReady ? [{ value: "loading", label: t("filter.loadingCategories"), disabled: true }] : []),
								]}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label={t("filter.content")}>
						<h3 className="liked-video-filter-group__title">{t("filter.content")}</h3>
						<div className="liked-video-filter-group__fields">
							<ContentTypeDropdown
								selection={contentTypes} onChange={setContentTypes}
								shortVideoMaxDurationSeconds={shortVideoMaxDurationSeconds}
							/>
							<LikedVideoFilterSelect
								label={t("filter.uploadDate")} ariaLabel={t("filter.uploadDate")}
								value={period} options={PERIOD_FILTER_OPTIONS}
								onChange={(value) => setPeriod(value as SubscriptionPeriod)}
							/>
							<LikedVideoFilterSelect
								label={t("filter.duration")} ariaLabel={t("filter.duration")}
								value={durationFilter} options={DURATION_FILTER_OPTIONS}
								onChange={(value) => setDurationFilter(value as DurationFilter)}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label={t("filter.language")}>
						<h3 className="liked-video-filter-group__title">{t("filter.language")}</h3>
						<div className="liked-video-filter-group__fields">
							<LikedVideoFilterSelect
								label={t("filter.titleDescription")} ariaLabel={t("filter.filterByLanguage")}
								description={t("filter.titleDescriptionHelp")}
								value={languageFilter} onChange={setLanguageFilter}
								options={[{ value: "all", label: t("filter.all"), count: videos.length }, ...languageOptions]}
							/>
							<LikedVideoFilterSelect
								label={t("filter.audio")} ariaLabel={t("filter.audioLanguage")}
								description={t("filter.audioHelp")}
								value={audioLanguageFilter} onChange={setAudioLanguageFilter}
								options={[{ value: "all", label: t("filter.all"), count: videos.length }, ...audioLanguageOptions]}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label={t("filter.savedState")}>
						<h3 className="liked-video-filter-group__title">{t("filter.savedState")}</h3>
						<div className="liked-video-filter-group__fields">
							<LikedVideoFilterSelect
								label={t("filter.aiSummary")} ariaLabel={t("filter.filterByAISummary")}
								value={aiSummaryFilter} options={AI_SUMMARY_FILTER_OPTIONS}
								onChange={(value) => setAISummaryFilter(value as PresenceFilter)}
							/>
							<LikedVideoFilterSelect
								label={t("filter.videoNote")} ariaLabel={t("filter.filterByVideoNote")}
								value={videoNoteFilter}
								onChange={(value) => setVideoNoteFilter(value as PresenceFilter)}
								options={[
									{ value: "all", label: t("filter.all") },
									{ value: "with", label: t("filter.hasVideoNote") },
									{ value: "without", label: t("filter.noVideoNote") },
								]}
							/>
						</div>
					</section>
				</div>
			)}
			<div className="liked-video-result-count" aria-live="polite" aria-atomic="true">
				<span>{filteredVideos.length} / {videos.length} {t("subscription.resultCount")}</span>
				<span aria-hidden="true">·</span>
				<span className="liked-video-result-sort" aria-label={`${t("subscription.sortedBy")} ${selectedSortLabel}, ${sortDirectionLabel}`}>
					{selectedSortLabel} <span aria-hidden="true">{sortOrder === "DESC" ? "↓" : "↑"}</span>
				</span>
			</div>

			{snapshot?.channels.length === 0 ? (
				<div className="no-videos-found">
					<Rss size={32} aria-hidden="true" />
					<div className="no-videos-found__title">{t("subscription.noSubscriptions")}</div>
					<div className="no-videos-found__text">{t("subscription.noSubscriptionsHelp")}</div>
				</div>
			) : filteredVideos.length === 0 ? (
				<div className="no-videos-found">
					<Search size={32} aria-hidden="true" />
					<div className="no-videos-found__title">{t("subscription.noMatchingVideos")}</div>
					<div className="no-videos-found__text">{t("subscription.noMatchingVideosHelp")}</div>
					<OpenYouTubeButton query={searchTerm} />
					{hasActiveQuery && (
						<button type="button" className="no-videos-found__clear-button" onClick={clearAllFilters}>
							{t("liked.clearSearchAndFilters")}
						</button>
					)}
				</div>
			) : null}
			<span ref={keyboardFocus.entryRef} tabIndex={sortedVideos.length > 0 ? 0 : -1} className="liked-video-focus-entry"
				onFocus={keyboardFocus.focusEntry}>
				{t("subscription.keyboardHelp")}
			</span>
			<LikedVideoCollection ref={keyboardFocus.collectionRef} videos={sortedVideos} mode="infinite"
				label={t("subscription.videosLabel")} currentPage={1} onPageChange={() => {}}
				noteExistenceMap={noteExistenceMap} resetKey={browsingKey}
				renderVideo={(video, noteExists, summaryState) => {
					const channel = snapshot?.channels.find((candidate) => candidate.id === video.snippet.channelId);
					return (
						<VideoCard
							{...summaryState}
							key={video.id}
							source="subscription"
							videoInfo={video}
							id={video.id}
							url={`https://www.youtube.com/watch?v=${video.id}`}
							noteExists={noteExists}
							sortMetric={activeSortMetric ? {
								kind: activeSortMetric,
								value: videoSortMetrics.get(video.id)?.[activeSortMetric] ?? null,
							} : undefined}
							isLiked={likedVideoIds.has(video.id)}
							likeActionPending={pendingLikeIds.has(video.id)}
							onLike={() => void handleLikeVideo(video)}
							onUnlike={() => void handleUnlikeVideo(video)}
							unsubscribeActionPending={isUnsubscribing}
							onUnsubscribeChannel={channel ? () => confirmUnsubscribeChannels([channel]) : undefined}
							onChannelClick={() => setChannelId(video.snippet.channelId)}
							onTagClick={handleTagClick}
							onLinkClick={(url) => void openVideo(url)}
							onAddToDailyNote={async (videoData, file) => {
								await appendNoteContent(plugin.app, file, { text: `\n${videoData}` });
								await plugin.app.workspace.openLinkText(file.path, "", false);
				new Notice(`${t("notes.addedVideoToNote")}: ${file.basename}`);
							}}
						/>
					);
				}}
			/>
		</div>
	);
};
