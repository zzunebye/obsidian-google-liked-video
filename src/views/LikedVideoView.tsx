import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { getFormatLocale, t } from "../i18n";
import type { KeyboardEvent, MouseEvent } from "react";
import { usePlugin } from "../store/pluginContext";
import { localStorageService } from "src/storage";
import {
	ContentTypeSelection,
	DurationFilter,
	PresenceFilter,
	PublishedDateFilter,
} from "src/types";
import {
	ThumbsUp,
	Search,
	Settings,
	RefreshCcw,
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	ArrowRight,
	ArrowRightToLine,
	ArrowLeftToLine,
	ArrowLeft,
	SlidersHorizontal,
	MoreHorizontal,
} from "lucide-react";
import { VideoCard } from "src/ui/VideoCard";
import { SearchBar } from "src/ui/SearchBar";
import { ContentTypeDropdown, formatContentTypeSelection } from "src/ui/ContentTypeDropdown";
import { LikedVideoFilterSelect } from "src/ui/LikedVideoFilterSelect";
import type { LikedVideoFetchStatus } from "src/main";
import { Menu, Notice } from "obsidian";
import { VideosContext } from "src/store/videoContext";
import { categoriesService } from "src/categoriesService";
import {
	classifyVideoContent,
	getVideoLanguageLabel,
	matchesDurationFilter,
	matchesPublishedDateFilter,
	normalizeVideoLanguage,
	parseDurationToSeconds,
} from "src/utils/videoUtils";
import {
	AI_SUMMARY_FILTER_OPTIONS,
	DURATION_FILTER_OPTIONS,
	getLanguageFilterOptions,
} from "src/utils/videoFilterOptions";
import { LikedVideoCollection } from "src/ui/LikedVideoCollection";
import { ViewHeader } from "src/ui/ViewHeader";
import { OpenYouTubeButton } from "src/ui/OpenYouTubeButton";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { useLikedVideoFocus } from "src/hooks/useLikedVideoFocus";
import { likeVideoAndPersist, unlikeVideoAndPersist } from "src/services/likedVideoMutationService";
import { CacheOwnershipError } from "src/services/youtubeAccountIdentityService";

interface ActiveChannelFilter {
	id: string;
	title: string;
}

const SORT_OPTIONS = [
	{ value: "addedDate", label: t("sort.likedOrder") },
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

const PUBLISHED_DATE_FILTER_OPTIONS: ReadonlyArray<{
	value: PublishedDateFilter;
	label: string;
	activeLabel: string;
}> = [
		{ value: "all", label: t("filter.anyTime"), activeLabel: t("filter.anyUploadDate") },
		{ value: "7d", label: t("filter.past7Days"), activeLabel: t("filter.past7Days") },
		{ value: "30d", label: t("filter.past30Days"), activeLabel: t("filter.past30Days") },
		{ value: "365d", label: t("filter.pastYear"), activeLabel: t("filter.pastYear") },
	];

const FilterChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
	<button type="button" className="active-tag-filter__chip" title={`${t("filter.clearFilter")}: ${label}`} onClick={onClear}>
		<span className="active-tag-filter__label">{label}</span>
		<span className="active-tag-filter__remove" aria-hidden="true">×</span>
	</button>
);

export const LikedVideoView: React.FC = () => {
	const keyboardFocus = useLikedVideoFocus();
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [selectedChannel, setSelectedChannel] = useState<ActiveChannelFilter | null>(null);
	const [currentPage, setCurrentPage] = useState(1);
	const [pageInput, setPageInput] = useState("1");
	const paginationMode = localStorageService.getLikedVideoPaginationMode();
	const [sortOption, setSortOption] = useState(
		localStorageService.getSortOption(),
	);
	const [sortOrder, setSortOrder] = useState(
		localStorageService.getSortOrder(),
	);
	const [selectedCategory, setSelectedCategory] = useState(
		localStorageService.getSelectedCategory(),
	);
	const [contentTypeSelection, setContentTypeSelection] =
		useState<ContentTypeSelection>(
			localStorageService.getContentTypeSelection(),
		);
	const [aiSummaryFilter, setAISummaryFilter] = useState<PresenceFilter>(
		localStorageService.getLikedVideoAISummaryFilter(),
	);
	const [publishedDateFilter, setPublishedDateFilter] = useState<PublishedDateFilter>(
		localStorageService.getLikedVideoPublishedDateFilter(),
	);
	const [durationFilter, setDurationFilter] = useState<DurationFilter>(
		localStorageService.getLikedVideoDurationFilter(),
	);
	const [audioLanguageFilter, setAudioLanguageFilter] = useState(
		localStorageService.getLikedVideoAudioLanguageFilter(),
	);
	const [languageFilter, setLanguageFilter] = useState(
		localStorageService.getLikedVideoLanguageFilter(),
	);
	const [videoNoteFilter, setVideoNoteFilter] = useState(
		localStorageService.getVideoNoteFilter(),
	);
	const [filtersExpanded, setFiltersExpanded] = useState(
		localStorageService.getFiltersExpanded(),
	);
	const [videos] = useContext(VideosContext);
	const [pendingUnlikeIds, setPendingUnlikeIds] = useState<ReadonlySet<string>>(new Set());
	const pendingUnlikeIdsRef = useRef(new Set<string>());
	const plugin = usePlugin();
	const [fetchStatus, setFetchStatus] = useState<LikedVideoFetchStatus>(plugin.getFetchStatus());
	const noteExistenceMap = useNoteExistenceMap(plugin, videos);
	const [summaryVersion, setSummaryVersion] = useState(0);
	const shortVideoMaxDurationSeconds = plugin.settings.shortVideoMaxDurationSeconds;
	const videosPerPage = 10;

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

	useEffect(() => {
		localStorageService.setSortOption(sortOption);
		localStorageService.setSortOrder(sortOrder);
	}, [sortOption, sortOrder]);

	useEffect(() => {
		localStorageService.setSelectedCategory(selectedCategory);
	}, [selectedCategory]);

	useEffect(() => {
		localStorageService.setContentTypeSelection(contentTypeSelection);
	}, [contentTypeSelection]);

	useEffect(() => {
		localStorageService.setLikedVideoAISummaryFilter(aiSummaryFilter);
	}, [aiSummaryFilter]);

	useEffect(() => {
		localStorageService.setLikedVideoPublishedDateFilter(publishedDateFilter);
	}, [publishedDateFilter]);

	useEffect(() => {
		localStorageService.setLikedVideoDurationFilter(durationFilter);
	}, [durationFilter]);

	useEffect(() => {
		localStorageService.setLikedVideoAudioLanguageFilter(audioLanguageFilter);
	}, [audioLanguageFilter]);

	useEffect(() => {
		localStorageService.setLikedVideoLanguageFilter(languageFilter);
	}, [languageFilter]);

	useEffect(() => {
		localStorageService.setVideoNoteFilter(videoNoteFilter);
	}, [videoNoteFilter]);

	useEffect(() => plugin.summaryStorage.subscribe(() => {
		setSummaryVersion((version) => version + 1);
	}), [plugin.summaryStorage]);

	useEffect(() => plugin.subscribeFetchStatus(setFetchStatus), [plugin]);

	useEffect(() => {
		localStorageService.setFiltersExpanded(filtersExpanded);
	}, [filtersExpanded]);

	// Debounce search term
	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDebouncedSearchTerm(searchTerm.trim());
		}, 300);

		return () => window.clearTimeout(timer);
	}, [searchTerm]);

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
			const channelMatch = selectedChannel === null ||
				video.snippet.channelId === selectedChannel.id;

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
				contentTypeSelection.length > 0 &&
				contentTypeSelection.length < 3
			) {
				contentTypeMatch = false;
				if (contentTypeSelection.includes("videos") && isRegularVideo) {
					contentTypeMatch = true;
				}
				if (contentTypeSelection.includes("shorts") && isShort) {
					contentTypeMatch = true;
				}
				if (contentTypeSelection.includes("music") && isMusic) {
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
		selectedChannel,
		selectedCategory,
		contentTypeSelection,
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
		const originalIndexes = new Map(videos.map((video, index) => [video.id, index]));
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
			case "addedDate":
				sorted.sort((a, b) =>
					(originalIndexes.get(b.id) ?? 0) - (originalIndexes.get(a.id) ?? 0));
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

	const totalPages = Math.ceil(sortedVideos.length / videosPerPage);
	const maximumPage = Math.max(totalPages, 1);
	const browsingKey = JSON.stringify([paginationMode, debouncedSearchTerm, selectedTag, selectedChannel?.id,
		sortOption, sortOrder, selectedCategory, contentTypeSelection, aiSummaryFilter, videoNoteFilter,
		publishedDateFilter, durationFilter, audioLanguageFilter, languageFilter]);
	const hasContentTypeFilter = contentTypeSelection.length > 0 && contentTypeSelection.length < 3;
	const activeFilterCount = Number(selectedTag !== null) + Number(selectedChannel !== null) +
		Number(selectedCategory !== "all") + Number(hasContentTypeFilter) + Number(aiSummaryFilter !== "all") +
		Number(videoNoteFilter !== "all") + Number(publishedDateFilter !== "all") +
		Number(durationFilter !== "all") + Number(audioLanguageFilter !== "all") + Number(languageFilter !== "all");
	const selectedCategoryTitle = availableCategories.find((category) =>
		category.id === selectedCategory)?.title ?? selectedCategory;
	const contentTypeFilterLabel = formatContentTypeSelection(contentTypeSelection);
	const aiSummaryFilterLabel = AI_SUMMARY_FILTER_OPTIONS.find((option) =>
		option.value === aiSummaryFilter)?.activeLabel ?? aiSummaryFilter;
	const publishedDateFilterLabel = PUBLISHED_DATE_FILTER_OPTIONS.find((option) =>
		option.value === publishedDateFilter)?.activeLabel ?? publishedDateFilter;
	const durationFilterLabel = DURATION_FILTER_OPTIONS.find((option) =>
		option.value === durationFilter)?.activeLabel ?? durationFilter;
	const hasActiveQuery = debouncedSearchTerm.length > 0 || activeFilterCount > 0;
	const selectedSortLabel = SORT_OPTIONS.find((option) => option.value === sortOption)?.label;
	const sortDirectionLabel = sortOption === "title" || sortOption === "channelTitle"
		? sortOrder === "ASC" ? t("sort.aToZ") : t("sort.zToA")
		: sortOption === "addedDate" || sortOption === "date"
			? sortOrder === "ASC" ? t("sort.oldestFirst") : t("sort.newestFirst")
			: sortOrder === "ASC" ? t("sort.lowestFirst") : t("sort.highestFirst");

	useEffect(() => {
		setPageInput(String(currentPage));
	}, [currentPage]);

	useEffect(() => {
		if (currentPage > maximumPage) {
			setCurrentPage(maximumPage);
		}
	}, [currentPage, maximumPage]);

	// Reset currentPage to 1 when debouncedSearchTerm, sortOption, or filters change
	useEffect(() => {
		setCurrentPage(1);
	}, [browsingKey]);

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

	const commitPageInput = () => {
		const trimmedInput = pageInput.trim();
		const requestedPage = Number(trimmedInput);

		if (!/^-?\d+$/.test(trimmedInput) || !Number.isSafeInteger(requestedPage)) {
			setPageInput(String(currentPage));
			return;
		}

		const nextPage = Math.min(Math.max(requestedPage, 1), maximumPage);
		setCurrentPage(nextPage);
		setPageInput(String(nextPage));
	};

	const clearAllFilters = (): void => {
		setSearchTerm("");
		setDebouncedSearchTerm("");
		setSelectedTag(null);
		setSelectedChannel(null);
		setSelectedCategory("all");
		setContentTypeSelection([]);
		setAISummaryFilter("all");
		setVideoNoteFilter("all");
		setPublishedDateFilter("all");
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

	const openVideoDisplaySettings = (): void => {
		if (!plugin.settingTabRef?.openVideoDisplaySettings()) {
			new Notice(t("liked.openSettingsError"));
		}
	};

	const openSyncMenu = (event: MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t("liked.fullSync"))
			.setIcon("refresh-cw")
			.setDisabled(fetchStatus !== "idle")
			.onClick(() => {
				void plugin.performAutoFetch(true, false);
			}));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(t("common.settings"))
			.setIcon("settings")
			.onClick(openVideoDisplaySettings));
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom });
	};

	return (
		<div ref={keyboardFocus.viewRef} className="liked-video-view" onKeyDown={handleViewKeyDown}>
			<ViewHeader
				icon={<ThumbsUp className="video-view-header__icon" />}
				title={
					<>
						{" "}
						{t("liked.title")}
						{plugin.settings.autoFetchEnabled && (
							<span
								className="auto-fetch-indicator"
								title={`${t("liked.autoFetchEvery")} ${plugin.settings.autoFetchInterval < 1
									? `${Math.round(plugin.settings.autoFetchInterval * 60)} ${t("liked.seconds")}`
									: `${plugin.settings.autoFetchInterval} ${t("liked.minutes")}`
									}`}
							>
								{fetchStatus !== "idle"
									? fetchStatus === "creating-notes" ? t("liked.creatingNotes") : t("liked.fetching")
									: `⏰ ${t("liked.auto")}`}
							</span>
						)}
					</>
				}
				actions={
					<>
						<button
			title={t("liked.fetchRecent")}
							/// Refresh button to fetch recently liked videos
							className="video-view-header__refresh-button"
							disabled={fetchStatus !== "idle"}
							onClick={() => {
								void plugin.performAutoFetch(false, false);
							}}
						>
							<RefreshCcw size={16} />
						</button>
						<button
							type="button"
			title={t("liked.moreSyncOptions")}
			aria-label={t("liked.moreSyncOptions")}
							disabled={fetchStatus !== "idle"}
							onClick={openSyncMenu}
						>
							<MoreHorizontal size={16} />
						</button>
						<button
							className="video-view-header__settings-button"
							title={t("common.settings")}
							onClick={openVideoDisplaySettings}
						>
							<Settings size={16} />
						</button>
					</>
				}
			/>
			<div className="liked-video-sync-status" role="status" aria-live="polite">
			{fetchStatus === "recent" && t("liked.checkingRecent")}
			{fetchStatus === "full" && t("liked.syncingAll")}
			{fetchStatus === "creating-notes" && t("liked.creatingNotesStatus")}
				{fetchStatus === "idle" && plugin.settings.lastAutoFetchTime > 0 &&
					`${t("liked.lastChecked")} ${new Date(plugin.settings.lastAutoFetchTime).toLocaleString(getFormatLocale())}`}
			</div>

			<div className="search-bar-container">
				<div className="search-bar-wrapper">
					<SearchBar
						searchTerm={searchTerm}
						onSearchTermChange={setSearchTerm}
						escapeClearsSearch
					/>
				</div>
				<button
					className={`filter-toggle-button ${activeFilterCount > 0 ? "filter-toggle-button--active" : ""}`}
					title={
						filtersExpanded
						? t("filters.hide")
							: t("filters.show")
					}
					aria-expanded={filtersExpanded}
					aria-controls="liked-video-filters"
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
					title={`${t("filter.sortedBy")}: ${selectedSortLabel}, ${sortDirectionLabel}`}
					aria-label={t("filter.sortVideos")}
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
					{selectedChannel && <FilterChip label={`${t("filter.channel")}: ${selectedChannel.title}`} onClear={() => setSelectedChannel(null)} />}
					{selectedCategory !== "all" && <FilterChip label={`${t("filter.category")}: ${selectedCategoryTitle}`} onClear={() => setSelectedCategory("all")} />}
					{hasContentTypeFilter && <FilterChip label={`${t("filter.type")}: ${contentTypeFilterLabel}`} onClear={() => setContentTypeSelection([])} />}
					{aiSummaryFilter !== "all" && (
						<FilterChip label={`${t("filter.filterBySummary")}: ${aiSummaryFilterLabel}`} onClear={() => setAISummaryFilter("all")} />
					)}
					{videoNoteFilter !== "all" && (
						<FilterChip label={videoNoteFilter === "with" ? t("filter.hasVideoNote") : t("filter.noVideoNote")} onClear={() => setVideoNoteFilter("all")} />
					)}
					{publishedDateFilter !== "all" && (
						<FilterChip label={`${t("filter.uploaded")}: ${publishedDateFilterLabel}`} onClear={() => setPublishedDateFilter("all")} />
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
				<div id="liked-video-filters" className="filters-container liked-video-filters">
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
								selection={contentTypeSelection} onChange={setContentTypeSelection}
								shortVideoMaxDurationSeconds={shortVideoMaxDurationSeconds}
							/>
							<LikedVideoFilterSelect
								label={t("filter.uploadDate")} ariaLabel={t("filter.uploadDate")}
								value={publishedDateFilter} options={PUBLISHED_DATE_FILTER_OPTIONS}
								onChange={(value) => setPublishedDateFilter(value as PublishedDateFilter)}
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
								label={t("filter.filterBySummary")} ariaLabel={t("filter.filterBySummary")}
								value={aiSummaryFilter} options={AI_SUMMARY_FILTER_OPTIONS}
								onChange={(value) => setAISummaryFilter(value as PresenceFilter)}
							/>
							<LikedVideoFilterSelect
								label={t("filter.videoNote")} ariaLabel={t("filter.videoNote")}
								value={videoNoteFilter}
								onChange={(value) => setVideoNoteFilter(value as PresenceFilter)}
								options={[
									{ value: "all", label: t("filter.all") },
									{ value: "with", label: t("filter.hasNote") },
									{ value: "without", label: t("filter.noNote") },
								]}
							/>
						</div>
					</section>
				</div>
			)}
			<div className="liked-video-result-count" aria-live="polite" aria-atomic="true">
				<span>{filteredVideos.length} {t("filter.resultRange")} {videos.length} {t("filter.resultCount")}</span>
				<span aria-hidden="true">·</span>
				<span className="liked-video-result-sort" aria-label={t("filter.sortedBy")}>
					{selectedSortLabel} <span aria-hidden="true">{sortOrder === "DESC" ? "↓" : "↑"}</span>
				</span>
			</div>
			{sortedVideos.length === 0 && (
				<div className="no-videos-found">
					<Search size={32} aria-hidden="true" />
					<div className="no-videos-found__title">
					{hasActiveQuery ? t("liked.noMatchingVideos") : t("liked.noVideosYet")}
					</div>
					<div className="no-videos-found__text">
						{hasActiveQuery
							? t("liked.noVideosMatchFilters")
						: t("videos.empty")}
					</div>
					<OpenYouTubeButton query={searchTerm} />
					{hasActiveQuery && (
						<button type="button" className="no-videos-found__clear-button" onClick={clearAllFilters}>
							{t("liked.clearSearchAndFilters")}
						</button>
					)}

					{videos.length === 0 && (
						<button
							className="no-videos-found__fetch-all-button"
							disabled={fetchStatus !== "idle"}
							onClick={() => {
								void plugin.performAutoFetch(true);
							}}
						>
							{fetchStatus === "full" ? t("liked.fetching") : t("liked.fetchAll")}
						</button>
					)}
				</div>
			)}
			{/* Videos */}
			<span ref={keyboardFocus.entryRef} tabIndex={sortedVideos.length > 0 ? 0 : -1} className="liked-video-focus-entry"
				onFocus={keyboardFocus.focusEntry}>
				{t("filter.browseVideosHelp")}
			</span>
			<LikedVideoCollection ref={keyboardFocus.collectionRef} videos={sortedVideos} mode={paginationMode} currentPage={currentPage}
				onPageChange={setCurrentPage}
				noteExistenceMap={noteExistenceMap}
				resetKey={browsingKey} renderVideo={(video, noteExists, summaryState) => (
					<VideoCard
						{...summaryState}
						key={video.id}
						source="liked"
						id={video.id}
						url={`https://www.youtube.com/watch?v=${video.id}`}
						videoInfo={video}
						sortMetric={activeSortMetric ? {
							kind: activeSortMetric,
							value: videoSortMetrics.get(video.id)?.[activeSortMetric] ?? null,
						} : undefined}
						noteExists={noteExists}
						likeActionPending={pendingUnlikeIds.has(video.id)}
						onUnlike={() => {
							if (pendingUnlikeIdsRef.current.has(video.id)) return;
							pendingUnlikeIdsRef.current.add(video.id);
							setPendingUnlikeIds(new Set(pendingUnlikeIdsRef.current));
							void (async () => {
								const index = videos.findIndex((v) => v.id === video.id);
								const previousVideoId = index > 0 ? videos[index - 1].id : null;
								try {
									await unlikeVideoAndPersist(plugin.likedVideoApi, video.id, plugin.videoNotes.captureLikedUpdate());

									const fragment = new DocumentFragment();
									fragment.createSpan({ text: `${t("liked.unlikedPrefix")} "${video.snippet.title}" ` });
									const undoBtn = fragment.createEl("button", {
									text: t("liked.undo"),
										cls: "geulo-undo-btn",
									});
									const notice = new Notice(fragment, 5000);
									undoBtn.addEventListener("click", () => {
										void (async () => {
											try {
												await likeVideoAndPersist(
													plugin.likedVideoApi,
													video,
													() => {
														const current = localStorageService.getLikedVideos();
														const previousIndex = previousVideoId
															? current.findIndex((item) => item.id === previousVideoId)
															: -1;
														return previousIndex >= 0
															? previousIndex + 1
															: Math.min(index, current.length);
													},
													plugin.videoNotes.captureLikedUpdate(),
												);
												notice.hide();
											} catch (error) {
												console.error("Failed to undo unlike:", error);
												new Notice(error instanceof CacheOwnershipError
													? error.message : t("liked.likeFailed"));
											}
										})();
									}, { once: true });
								} catch (error) {
									console.error("Failed to unlike video:", error);
									new Notice(error instanceof CacheOwnershipError
										? error.message : t("liked.unlikeFailed"));
								} finally {
									pendingUnlikeIdsRef.current.delete(video.id);
									setPendingUnlikeIds(new Set(pendingUnlikeIdsRef.current));
								}
							})();
						}}
						onAddToDailyNote={async (videoData, file) => {
							const contentToAppend = `\n${videoData}`;
							await appendNoteContent(plugin.app, file, {
								text: contentToAppend,
							});
							// Open the daily note in the main panel
							await plugin.app.workspace.openLinkText(
								file.path,
								"",
								false,
							);
							// Show success notification
							new Notice(
								`${t("notes.addedVideoToNote")}: ${file.basename}`,
							);
						}}
						onChannelClick={(channelTitle, channelId) => {
							setSelectedChannel({ id: channelId, title: channelTitle });
						}}
						onTagClick={handleTagClick}
						onLinkClick={(videoUrl) => {
							void (async () => {
								const openInObsidianWebViewer =
									plugin.settings?.openInObsidianWebViewer;

								if (openInObsidianWebViewer) {
									const leafType = plugin.settings.openWebViewerInSplitPane
										? "split"
										: "tab";
									const leaf = plugin.app.workspace.getLeaf(leafType);
									await leaf.setViewState({
										type: "webviewer",
										state: {
											url: videoUrl,
											navigate: true,
										},
										active: true,
									});
								} else {
									window.open(videoUrl, "_blank");
								}
							})();
						}}
					/>
				)} />

			{/* Pagination */}
			{paginationMode === "pagination" && <nav className="video-view__pagination" aria-label={t("filter.pagination")}>
				<div className="video-view__pagination__controls">
					{currentPage > 1 && (
						<>
							<button
								type="button"
							aria-label={t("filter.firstPage")}
							title={t("filter.firstPage")}
								onClick={() => setCurrentPage(1)}
							>
								<ArrowLeftToLine size={16} />
							</button>
							<button
								type="button"
							aria-label={t("filter.previousPage")}
							title={t("filter.previousPage")}
								onClick={() => setCurrentPage(currentPage - 1)}
							>
								<ArrowLeft size={16} />
							</button>
						</>
					)}
				</div>
				<div className="video-view__pagination__current-page">
					<input
						className="video-view__pagination__input"
						type="number"
						inputMode="numeric"
						min={1}
						max={maximumPage}
						step={1}
						value={pageInput}
						aria-label={t("filter.pageNumber", { count: maximumPage })}
						onChange={(event) => setPageInput(event.currentTarget.value)}
						onFocus={(event) => event.currentTarget.select()}
						onBlur={commitPageInput}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								event.currentTarget.blur();
							} else if (event.key === "Escape") {
								event.preventDefault();
								setPageInput(String(currentPage));
								event.currentTarget.select();
							}
						}}
					/>
					<span aria-hidden="true">/</span>
					<span aria-hidden="true">{maximumPage}</span>
				</div>
				<div className="video-view__pagination__controls">
					{currentPage < totalPages && (
						<>
							<button
								type="button"
							aria-label={t("filter.nextPage")}
							title={t("filter.nextPage")}
								onClick={() => setCurrentPage(currentPage + 1)}
							>
								<ArrowRight size={16} />
							</button>
							<button
								type="button"
							aria-label={t("filter.lastPage")}
							title={t("filter.lastPage")}
								onClick={() => setCurrentPage(totalPages)}
							>
								<ArrowRightToLine size={16} />
							</button>
						</>
					)}
				</div>
			</nav>}
			<div style={{ height: "24px" }}></div>
		</div>
	);
};
