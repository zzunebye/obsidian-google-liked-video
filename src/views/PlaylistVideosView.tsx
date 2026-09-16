import { Menu, Notice } from "obsidian";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Play, Search, AlertCircle, RefreshCw, Trash2, Settings, ExternalLink, SlidersHorizontal, ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import type { ContentTypeSelection, DurationFilter, PlaylistInfo, PlaylistSource, PresenceFilter, PublishedDateFilter, YouTubeVideo } from "src/types";
import { UI_TEXT } from "src/constants/uiText";
import { localStorageService } from "src/storage";
import { categoriesService } from "src/categoriesService";
import { VideoCard } from "src/ui/VideoCard";
import { SearchBar } from "src/ui/SearchBar";
import { ViewHeader } from "src/ui/ViewHeader";
import { OpenYouTubeButton } from "src/ui/OpenYouTubeButton";
import { ContentTypeDropdown } from "src/ui/ContentTypeDropdown";
import { LikedVideoFilterSelect } from "src/ui/LikedVideoFilterSelect";
import { LikedVideoCollection } from "src/ui/LikedVideoCollection";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { useLikedVideoFocus } from "src/hooks/useLikedVideoFocus";
import { classifyVideoContent, getVideoLanguageLabel, matchesDurationFilter, matchesPublishedDateFilter, normalizeVideoLanguage, parseDurationToSeconds } from "src/utils/videoUtils";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { likeVideoAndPersist, unlikeVideoAndPersist } from "src/services/likedVideoMutationService";
import { debugLogger } from "src/debug";
import { usePlugin } from "../store/pluginContext";

export interface PlaylistVideosViewState {
	searchTerm: string;
	selectedTag: string | null;
	selectedCategory: string;
	sortOption: PlaylistSortOption;
	aiSummaryFilter: PresenceFilter;
	videoNoteFilter: PresenceFilter;
	durationFilter: DurationFilter;
	audioLanguageFilter: string;
	languageFilter: string;
	channelId: string;
	publishedDateFilter: PublishedDateFilter;
	contentTypes: ContentTypeSelection;
	sortOrder: "ASC" | "DESC";
	filtersExpanded: boolean;
}

interface PlaylistVideosViewProps {
	playlistSource: PlaylistSource;
	playlistInfo: PlaylistInfo;
	initialState?: Partial<PlaylistVideosViewState>;
	refreshVersion?: number;
	onStateChange?: (state: PlaylistVideosViewState) => void;
	onDeletePlaylist: () => Promise<void>;
}

const SORT_OPTIONS = [
	{ value: "playlistOrder", label: "Playlist Order" },
	{ value: "viewCount", label: UI_TEXT.SORT_BY_VIEW_COUNT },
	{ value: "averageViewsPerDay", label: UI_TEXT.SORT_BY_AVERAGE_VIEWS_PER_DAY },
	{ value: "likeCount", label: UI_TEXT.SORT_BY_LIKE_COUNT },
	{ value: "commentCount", label: UI_TEXT.SORT_BY_COMMENT_COUNT },
	{ value: "likeViewRatio", label: UI_TEXT.SORT_BY_LIKE_VIEW_RATIO },
	{ value: "date", label: UI_TEXT.SORT_BY_PUBLISHED_DATE },
	{ value: "title", label: UI_TEXT.SORT_BY_TITLE },
	{ value: "channelTitle", label: UI_TEXT.SORT_BY_CHANNEL_NAME },
	{ value: "duration", label: UI_TEXT.SORT_BY_DURATION },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const AI_SUMMARY_FILTER_OPTIONS: ReadonlyArray<{
	value: PresenceFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: "All", activeLabel: "All summaries" },
	{ value: "with", label: "Has summary", activeLabel: "Has" },
	{ value: "without", label: "No summary", activeLabel: "Missing" },
];

const PUBLISHED_DATE_FILTER_OPTIONS: ReadonlyArray<{
	value: PublishedDateFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: "Any time", activeLabel: "Any upload date" },
	{ value: "7d", label: "Past 7 days", activeLabel: "Past 7 days" },
	{ value: "30d", label: "Past 30 days", activeLabel: "Past 30 days" },
	{ value: "365d", label: "Past year", activeLabel: "Past year" },
];

const DURATION_FILTER_OPTIONS: ReadonlyArray<{
	value: DurationFilter;
	label: string;
	activeLabel: string;
}> = [
	{ value: "all", label: "Any", activeLabel: "Any duration" },
	{ value: "under5", label: "Under 5 min", activeLabel: "Under 5 min" },
	{ value: "5to20", label: "5–20 min", activeLabel: "5–20 min" },
	{ value: "20to60", label: "20–60 min", activeLabel: "20–60 min" },
	{ value: "60plus", label: "60+ min", activeLabel: "60+ min" },
];

function getLanguageFilterOptions(
	videos: readonly YouTubeVideo[],
	field: "defaultLanguage" | "defaultAudioLanguage",
	selectedLanguage: string,
): { value: string; label: string; count: number }[] {
	const counts = new Map<string, number>();
	videos.forEach((video) => {
		const language = normalizeVideoLanguage(video.snippet[field]);
		counts.set(language, (counts.get(language) ?? 0) + 1);
	});
	if (selectedLanguage !== "all" && !counts.has(selectedLanguage)) {
		counts.set(selectedLanguage, 0);
	}
	return Array.from(counts, ([value, count]) => ({
		value, count, label: getVideoLanguageLabel(value),
	})).sort((a, b) => {
		if (a.value === "unknown") return 1;
		if (b.value === "unknown") return -1;
		return a.label.localeCompare(b.label);
	});
}

const FilterChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
	<button type="button" className="active-tag-filter__chip" title={`Clear ${label}`} onClick={onClear}>
		<span className="active-tag-filter__label">{label}</span>
		<span className="active-tag-filter__remove" aria-hidden="true">×</span>
	</button>
);

type PlaylistSortOption = typeof SORT_OPTIONS[number]["value"];

export const PlaylistVideosView: React.FC<PlaylistVideosViewProps> = ({
	playlistSource,
	playlistInfo,
	initialState = {},
	refreshVersion = 0,
	onStateChange,
	onDeletePlaylist,
}) => {
	const plugin = usePlugin();
	const shortVideoMaxDurationSeconds = plugin.settings.shortVideoMaxDurationSeconds;
	const [allVideos, setAllVideos] = useState<YouTubeVideo[]>(() => plugin.playlistApi?.getCachedVideos(playlistSource) ?? []);
	const [isLoading, setIsLoading] = useState(allVideos.length === 0);
	const [error, setError] = useState<string | null>(null);
	const [reloadVersion, setReloadVersion] = useState(0);
	const pendingLoadRef = useRef<{ key: string; promise: Promise<YouTubeVideo[]> } | null>(null);
	const playlistId = playlistSource.type === "playlist" ? playlistSource.playlistId : null;
	const playlistSourceKey = playlistId === null ? "liked" : `playlist:${playlistId}`;
	const videoKeys = useRef(new WeakMap<YouTubeVideo, string>());
	const videos = useMemo(() => allVideos
		.filter((video) => video && video.snippet && video.id)
		.map((video, index) => {
			// Keep repeated entries distinct and retain keys while an old card is busy.
			const entry = { ...video };
			videoKeys.current.set(entry, `${video.id}:${index}`);
			return entry;
		}), [allVideos]);
	const getVideoKey = useCallback((video: YouTubeVideo) => videoKeys.current.get(video) ?? video.id, []);
	const keyboardFocus = useLikedVideoFocus(!(allVideos.length === 0 && (isLoading || error !== null)));
	const filtersId = useId();
	const noteExistenceMap = useNoteExistenceMap(plugin, videos);
	const [summaryVersion, setSummaryVersion] = useState(0);
	const [collectionVersion, setCollectionVersion] = useState(0);
	const [searchTerm, setSearchTerm] = useState(initialState.searchTerm ?? "");
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(initialState.searchTerm?.trim() ?? "");
	const [selectedTag, setSelectedTag] = useState(initialState.selectedTag ?? null);
	const [selectedCategory, setSelectedCategory] = useState(initialState.selectedCategory ?? "all");
	const [sortOption, setSortOption] = useState<PlaylistSortOption>(initialState.sortOption ?? "playlistOrder");
	const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">(initialState.sortOrder ?? "ASC");
	const [aiSummaryFilter, setAISummaryFilter] = useState<PresenceFilter>(
		initialState.aiSummaryFilter ?? (localStorageService.getAINoteFilter() ? "with" : "all"),
	);
	const [videoNoteFilter, setVideoNoteFilter] = useState<PresenceFilter>(initialState.videoNoteFilter ?? "all");
	const [durationFilter, setDurationFilter] = useState<DurationFilter>(initialState.durationFilter ?? "all");
	const [audioLanguageFilter, setAudioLanguageFilter] = useState(initialState.audioLanguageFilter ?? "all");
	const [languageFilter, setLanguageFilter] = useState(initialState.languageFilter ?? "all");
	const [channelId, setChannelId] = useState(initialState.channelId ?? "all");
	const [publishedDateFilter, setPublishedDateFilter] = useState<PublishedDateFilter>(initialState.publishedDateFilter ?? "all");
	const [contentTypes, setContentTypes] = useState<ContentTypeSelection>(initialState.contentTypes ?? []);
	const [filtersExpanded, setFiltersExpanded] = useState(initialState.filtersExpanded ?? false);
	const [pendingLikeIds, setPendingLikeIds] = useState<ReadonlySet<string>>(new Set());
	const pendingLikeIdsRef = useRef(new Set<string>());
	const [likedVideoIds, setLikedVideoIds] = useState<Set<string>>(
		() => new Set(localStorageService.getLikedVideos().map((video) => video.id)),
	);
	const channels = useMemo(() => Array.from(new Map(videos.map((video) =>
		[video.snippet.channelId, { id: video.snippet.channelId, title: video.snippet.channelTitle }],
	)).values()).sort((a, b) => a.title.localeCompare(b.title)), [videos]);

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
		onStateChange?.({
			searchTerm,
			selectedTag, selectedCategory, sortOption, aiSummaryFilter, videoNoteFilter,
			durationFilter, audioLanguageFilter, languageFilter,
			channelId,
			publishedDateFilter,
			contentTypes,
			sortOrder,
			filtersExpanded,
		});
	}, [
		searchTerm,
		selectedTag, selectedCategory, sortOption, aiSummaryFilter, videoNoteFilter,
		durationFilter, audioLanguageFilter, languageFilter,
		channelId,
		publishedDateFilter,
		contentTypes,
		sortOrder,
		filtersExpanded,
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

	useEffect(() => {
		let cancelled = false;
		const source: PlaylistSource = playlistId === null ? { type: "liked" } : { type: "playlist", playlistId };
		const loadVideos = async (): Promise<void> => {
			if (!plugin.playlistApi) {
				setError("Playlist API not available");
				setIsLoading(false);
				return;
			}
			const forceRefresh = refreshVersion > 0 || reloadVersion > 0;
			const cached = forceRefresh ? null : plugin.playlistApi.getCachedVideos(source);
			if (cached) {
				setAllVideos(cached);
				setError(null);
				setIsLoading(false);
				return;
			}
			setIsLoading(true);
			setError(null);
			try {
				const key = JSON.stringify([playlistSourceKey, refreshVersion, reloadVersion]);
				if (pendingLoadRef.current?.key !== key) {
					pendingLoadRef.current = {
						key,
						promise: plugin.playlistApi.fetchAllPlaylistVideos(source, forceRefresh),
					};
				}
				const fetchedVideos = await pendingLoadRef.current.promise;
				if (cancelled) return;
				setAllVideos(fetchedVideos);
				if (forceRefresh) setCollectionVersion((version) => version + 1);
			} catch (loadError) {
				if (cancelled) return;
				debugLogger.error("Failed to load playlist videos", loadError);
				const message = `Failed to load videos: ${loadError instanceof Error ? loadError.message : "Unknown error"}`;
				setError(message);
				new Notice(message);
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		};
		void loadVideos();
		return () => { cancelled = true; };
	}, [plugin.playlistApi, playlistId, playlistSourceKey, refreshVersion, reloadVersion]);

	const handleRefresh = (): void => setReloadVersion((version) => version + 1);

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
			const publishedDateMatch = matchesPublishedDateFilter(
				video.snippet.publishedAt,
				publishedDateFilter,
				nowMs,
			);
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
		publishedDateFilter,
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
			case "playlistOrder":
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

	const hasContentTypeFilter = contentTypes.length > 0 && contentTypes.length < 3;
	const activeFilterCount = Number(selectedTag !== null) + Number(channelId !== "all") +
		Number(selectedCategory !== "all") + Number(hasContentTypeFilter) + Number(aiSummaryFilter !== "all") +
		Number(videoNoteFilter !== "all") + Number(publishedDateFilter !== "all") +
		Number(durationFilter !== "all") + Number(audioLanguageFilter !== "all") + Number(languageFilter !== "all");
	const selectedCategoryTitle = availableCategories.find((category) =>
		category.id === selectedCategory)?.title ?? selectedCategory;
	const contentTypeFilterLabel = contentTypes.map((type) => type === "videos"
		? UI_TEXT.CONTENT_TYPE_VIDEOS
		: type === "shorts" ? UI_TEXT.CONTENT_TYPE_SHORTS : UI_TEXT.CONTENT_TYPE_MUSIC).join(", ");
	const aiSummaryFilterLabel = AI_SUMMARY_FILTER_OPTIONS.find((option) =>
		option.value === aiSummaryFilter)?.activeLabel ?? aiSummaryFilter;
	const publishedDateFilterLabel = PUBLISHED_DATE_FILTER_OPTIONS.find((option) =>
		option.value === publishedDateFilter)?.activeLabel ?? publishedDateFilter;
	const durationFilterLabel = DURATION_FILTER_OPTIONS.find((option) =>
		option.value === durationFilter)?.activeLabel ?? durationFilter;
	const hasActiveQuery = debouncedSearchTerm.length > 0 || activeFilterCount > 0;
	const selectedSortLabel = SORT_OPTIONS.find((option) => option.value === sortOption)?.label;
	const sortDirectionLabel = sortOption === "playlistOrder"
		? sortOrder === "ASC" ? "first to last" : "last to first"
		: sortOption === "title" || sortOption === "channelTitle"
		? sortOrder === "ASC" ? "A to Z" : "Z to A"
		: sortOption === "date"
			? sortOrder === "ASC" ? "oldest first" : "newest first"
			: sortOrder === "ASC" ? "lowest first" : "highest first";

	const browsingKey = JSON.stringify([playlistSourceKey, debouncedSearchTerm, selectedTag, channelId, publishedDateFilter,
		contentTypes, sortOption, sortOrder, selectedCategory, aiSummaryFilter, videoNoteFilter,
		durationFilter, audioLanguageFilter, languageFilter, collectionVersion]);
	const selectedChannel = channels.find((channel) => channel.id === channelId);

	const handleLikeVideo = async (video: YouTubeVideo): Promise<void> => {
		if (pendingLikeIdsRef.current.has(video.id)) return;
		pendingLikeIdsRef.current.add(video.id);
		setPendingLikeIds(new Set(pendingLikeIdsRef.current));
		try {
			await likeVideoAndPersist(plugin.likedVideoApi, video);
			setLikedVideoIds((current) => new Set(current).add(video.id));
			new Notice(UI_TEXT.NOTICE_VIDEO_LIKED(video.snippet.title));
		} catch (likeError) {
			console.error("Failed to like playlist video:", likeError);
			new Notice(UI_TEXT.NOTICE_LIKE_FAILED);
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
			await unlikeVideoAndPersist(plugin.likedVideoApi, video.id);
			setLikedVideoIds((current) => {
				const next = new Set(current);
				next.delete(video.id);
				return next;
			});
			const fragment = new DocumentFragment();
			fragment.createSpan({ text: `Unliked "${video.snippet.title}" ` });
			const undoButton = fragment.createEl("button", { text: "Undo", cls: "geulo-undo-btn" });
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
						});
						setLikedVideoIds((current) => new Set(current).add(video.id));
						notice.hide();
					} catch (undoError) {
						console.error("Failed to undo playlist video unlike:", undoError);
						new Notice(UI_TEXT.NOTICE_LIKE_FAILED);
						undoButton.disabled = false;
					} finally {
						pendingLikeIdsRef.current.delete(video.id);
						setPendingLikeIds(new Set(pendingLikeIdsRef.current));
					}
				})();
			});
		} catch (unlikeError) {
			console.error("Failed to unlike playlist video:", unlikeError);
			new Notice(UI_TEXT.NOTICE_UNLIKE_FAILED);
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

	const openPlaylistAction = (
		<button
			type="button"
			aria-label="Open playlist on YouTube"
			onClick={() => {
				const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId ?? "LL")}`;
				void openVideo(url).catch((error: unknown) => {
					debugLogger.error("Failed to open YouTube playlist:", error);
					new Notice("Unable to open YouTube playlist. Please try again.");
				});
			}}
		>
			<ExternalLink size={16} aria-hidden="true" />
		</button>
	);

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
		setPublishedDateFilter("all");
		setDurationFilter("all");
		setAudioLanguageFilter("all");
		setLanguageFilter("all");
	};

	const openSortMenu = (event: MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu().setUseNativeMenu(false);
		menu.addItem((item) => item.setTitle("Sort by").setIsLabel(true));
		SORT_OPTIONS.forEach((option) => {
			menu.addItem((item) => item
				.setTitle(option.label)
				.setChecked(sortOption === option.value)
				.onClick(() => setSortOption(option.value)));
		});
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle("Ascending")
			.setChecked(sortOrder === "ASC")
			.onClick(() => setSortOrder("ASC")));
		menu.addItem((item) => item
			.setTitle("Descending")
			.setChecked(sortOrder === "DESC")
			.onClick(() => setSortOrder("DESC")));
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom }, event.currentTarget.ownerDocument);
	};

	// Loading State - skeleton cards
	if (isLoading && allVideos.length === 0) {
		return (
			<div className="playlist-videos-view">
				<ViewHeader
					icon={<Play className="video-view-header__icon" />}
					title={playlistInfo.title}
					actions={openPlaylistAction}
				/>

				<div className="videos-loading-skeleton">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i} className="skeleton-card">
							<div className="skeleton-card__inner">
								<div className="skeleton-card__thumbnail" />
								<div className="skeleton-card__info">
									<div className="skeleton-card__line skeleton-card__line--title" />
									<div className="skeleton-card__line skeleton-card__line--channel" />
									<div className="skeleton-card__line skeleton-card__line--meta" />
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	// Error State
	if (error && allVideos.length === 0) {
		return (
			<div className="playlist-videos-view">
				<ViewHeader
					icon={<Play className="video-view-header__icon" />}
					title={playlistInfo.title}
					actions={openPlaylistAction}
				/>

				<div className="videos-error">
					<div className="videos-error__icon">
						<AlertCircle size={48} />
					</div>
					<div className="videos-error__title">
						Failed to load videos
					</div>
					<div className="videos-error__message">{error}</div>
					<button
						className="videos-error__retry-button"
						onClick={handleRefresh}
					>
						<RefreshCw size={16} />
						Try Again
					</button>
				</div>
			</div>
		);
	}

	return (
		<div ref={keyboardFocus.viewRef} className="playlist-videos-view" onKeyDown={handleViewKeyDown}>
			<ViewHeader
				icon={<Play className="video-view-header__icon" />}
				title={playlistInfo.title}
				actions={
					<>
						<button
							className="refresh-button"
							onClick={handleRefresh}
							disabled={isLoading}
							title="Refresh videos"
						>
							<RefreshCw
								size={16}
								className={isLoading ? "animate-spin" : ""}
							/>
						</button>
						{playlistInfo.isOwnedByUser === true && (
							<button
								className="playlist-delete-button"
								onClick={() => {
									void onDeletePlaylist();
								}}
								title="Delete playlist"
								aria-label="Delete playlist"
							>
								<Trash2 size={16} />
							</button>
						)}
						{settingsAction}
						{openPlaylistAction}
					</>
				}
			/>

			{playlistInfo.description && (
				<div className="playlist-description">
					<p>{playlistInfo.description}</p>
				</div>
			)}

			{error && <div className="subscription-warning" role="alert">{error}</div>}

			<div className="search-bar-container">
				<div className="search-bar-wrapper">
					<SearchBar
						searchTerm={searchTerm}
						onSearchTermChange={setSearchTerm}
						escapeClearsSearch
						ariaLabel="Search playlist videos"
					/>
				</div>
				<button
					type="button"
					className={`filter-toggle-button ${activeFilterCount > 0 ? "filter-toggle-button--active" : ""}`}
					title={
						filtersExpanded
							? UI_TEXT.FILTERS_HIDE
							: UI_TEXT.FILTERS_SHOW
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
					title={`Sort by: ${selectedSortLabel}, ${sortDirectionLabel}`}
					aria-label={`Sort videos. Current: ${selectedSortLabel}, ${sortDirectionLabel}`}
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
				<div className="active-tag-filter active-filter-list" aria-label="Active filters">
					{selectedTag && <FilterChip label={`Tag: ${selectedTag}`} onClear={() => setSelectedTag(null)} />}
					{channelId !== "all" && <FilterChip label={`Channel: ${selectedChannel?.title ?? channelId}`} onClear={() => setChannelId("all")} />}
					{selectedCategory !== "all" && <FilterChip label={`Category: ${selectedCategoryTitle}`} onClear={() => setSelectedCategory("all")} />}
					{hasContentTypeFilter && <FilterChip label={`Type: ${contentTypeFilterLabel}`} onClear={() => setContentTypes([])} />}
					{aiSummaryFilter !== "all" && (
						<FilterChip label={`AI summary: ${aiSummaryFilterLabel}`} onClear={() => setAISummaryFilter("all")} />
					)}
					{videoNoteFilter !== "all" && (
						<FilterChip label={videoNoteFilter === "with" ? "Has video note" : "No video note"} onClear={() => setVideoNoteFilter("all")} />
					)}
					{publishedDateFilter !== "all" && (
						<FilterChip label={`Uploaded: ${publishedDateFilterLabel}`} onClear={() => setPublishedDateFilter("all")} />
					)}
					{durationFilter !== "all" && (
						<FilterChip label={`Duration: ${durationFilterLabel}`} onClear={() => setDurationFilter("all")} />
					)}
					{audioLanguageFilter !== "all" && (
						<FilterChip label={`Audio language: ${getVideoLanguageLabel(audioLanguageFilter)}`} onClear={() => setAudioLanguageFilter("all")} />
					)}
					{languageFilter !== "all" && (
						<FilterChip label={`Language: ${getVideoLanguageLabel(languageFilter)}`} onClear={() => setLanguageFilter("all")} />
					)}
					<button type="button" className="active-filter-list__clear" onClick={clearAllFilters}>Clear all</button>
				</div>
			)}

			{filtersExpanded && (
				<div id={filtersId} className="filters-container liked-video-filters">
					<section className="liked-video-filter-group" aria-label="Channel">
						<h3 className="liked-video-filter-group__title">Channel</h3>
						<div className="liked-video-filter-group__fields liked-video-filter-group__fields--category">
							<LikedVideoFilterSelect
								label="Channel" ariaLabel="Filter by channel" showLabel={false}
								value={channelId} onChange={setChannelId}
								options={[
									{ value: "all", label: "All channels", count: videos.length },
									...channels.map((channel) => ({ value: channel.id, label: channel.title })),
								]}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label="Category">
						<h3 className="liked-video-filter-group__title">Category</h3>
						<div className="liked-video-filter-group__fields liked-video-filter-group__fields--category">
							<LikedVideoFilterSelect
								label="Category" ariaLabel="Filter by category" showLabel={false}
								value={selectedCategory} onChange={setSelectedCategory}
								disabled={!isCategoriesReady || availableCategories.length === 0}
								options={[
									{ value: "all", label: "All", count: videos.length },
									...availableCategories.map((category) => ({
										value: category.id, label: category.title, count: categoryCounts[category.id] || 0,
									})),
									...(!isCategoriesReady ? [{ value: "loading", label: "Loading categories...", disabled: true }] : []),
								]}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label="Content">
						<h3 className="liked-video-filter-group__title">Content</h3>
						<div className="liked-video-filter-group__fields">
							<ContentTypeDropdown
								selection={contentTypes} onChange={setContentTypes}
								shortVideoMaxDurationSeconds={shortVideoMaxDurationSeconds}
							/>
							<LikedVideoFilterSelect
								label="Upload date" ariaLabel="Filter by upload date"
								value={publishedDateFilter} options={PUBLISHED_DATE_FILTER_OPTIONS}
								onChange={(value) => setPublishedDateFilter(value as PublishedDateFilter)}
							/>
							<LikedVideoFilterSelect
								label="Duration" ariaLabel="Filter by duration"
								value={durationFilter} options={DURATION_FILTER_OPTIONS}
								onChange={(value) => setDurationFilter(value as DurationFilter)}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label="Language">
						<h3 className="liked-video-filter-group__title">Language</h3>
						<div className="liked-video-filter-group__fields">
							<LikedVideoFilterSelect
								label="Title & description" ariaLabel="Filter by language"
								description="Language of the video's title and description. Videos without language information appear under Unknown."
								value={languageFilter} onChange={setLanguageFilter}
								options={[{ value: "all", label: "All", count: videos.length }, ...languageOptions]}
							/>
							<LikedVideoFilterSelect
								label="Audio" ariaLabel="Filter by audio language"
								description="Audio language of the default track. Videos without language information appear under Unknown."
								value={audioLanguageFilter} onChange={setAudioLanguageFilter}
								options={[{ value: "all", label: "All", count: videos.length }, ...audioLanguageOptions]}
							/>
						</div>
					</section>
					<section className="liked-video-filter-group" aria-label="Saved state">
						<h3 className="liked-video-filter-group__title">Saved state</h3>
						<div className="liked-video-filter-group__fields">
							<LikedVideoFilterSelect
								label="AI summary" ariaLabel="Filter by AI summary"
								value={aiSummaryFilter} options={AI_SUMMARY_FILTER_OPTIONS}
								onChange={(value) => setAISummaryFilter(value as PresenceFilter)}
							/>
							<LikedVideoFilterSelect
								label="Video note" ariaLabel="Filter by video note"
								value={videoNoteFilter}
								onChange={(value) => setVideoNoteFilter(value as PresenceFilter)}
								options={[
									{ value: "all", label: "All" },
									{ value: "with", label: "Has note" },
									{ value: "without", label: "No note" },
								]}
							/>
						</div>
					</section>
				</div>
			)}
			<div className="liked-video-result-count" aria-live="polite" aria-atomic="true">
				<span>{filteredVideos.length} of {videos.length} videos</span>
				<span aria-hidden="true">·</span>
				<span className="liked-video-result-sort" aria-label={`Sorted by ${selectedSortLabel}, ${sortDirectionLabel}`}>
					{selectedSortLabel} <span aria-hidden="true">{sortOrder === "DESC" ? "↓" : "↑"}</span>
				</span>
			</div>
			{filteredVideos.length === 0 && (
				<div className="no-videos-found">
					<Search size={32} aria-hidden="true" />
					<div className="no-videos-found__title">{hasActiveQuery ? "No matching videos" : "No videos yet"}</div>
					<div className="no-videos-found__text">
						{hasActiveQuery ? "No videos match the active filters." : "This playlist appears to be empty."}
					</div>
					<OpenYouTubeButton query={searchTerm} />
					{hasActiveQuery && (
						<button type="button" className="no-videos-found__clear-button" onClick={clearAllFilters}>
							Clear search and filters
						</button>
					)}
				</div>
			)}
			<span ref={keyboardFocus.entryRef} tabIndex={sortedVideos.length > 0 ? 0 : -1} className="liked-video-focus-entry"
				onFocus={keyboardFocus.focusEntry}>
				Browse playlist videos. Use Up and Down to navigate, Tab to leave the list, F2 for card controls, and Escape to return to the card.
			</span>
			<LikedVideoCollection ref={keyboardFocus.collectionRef} videos={sortedVideos} mode="infinite"
				label="Playlist videos" getVideoKey={getVideoKey} currentPage={1} onPageChange={() => {}}
				noteExistenceMap={noteExistenceMap} resetKey={browsingKey}
				renderVideo={(video, noteExists, summaryState) => {
					return (
						<VideoCard
							{...summaryState}
							key={video.id}
							source="playlist"
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
							onChannelClick={() => setChannelId(video.snippet.channelId)}
							onTagClick={handleTagClick}
							onLinkClick={(url) => void openVideo(url)}
							onAddToDailyNote={async (videoData, file) => {
								await appendNoteContent(plugin.app, file, { text: `\n${videoData}` });
								await plugin.app.workspace.openLinkText(file.path, "", false);
								new Notice(`Added video to ${file.basename} and opened the note`);
							}}
						/>
					);
				}}
			/>
		</div>
	);
};
