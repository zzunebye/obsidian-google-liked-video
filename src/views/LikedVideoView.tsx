import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { usePlugin } from "../store/pluginContext";
import { localStorageService } from "src/storage";
import {
	ContentTypeSelection,
	DurationFilter,
	PresenceFilter,
	PublishedDateFilter,
	YouTubeVideo,
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
import { ContentTypeDropdown } from "src/ui/ContentTypeDropdown";
import { LikedVideoFilterSelect } from "src/ui/LikedVideoFilterSelect";
import type { LikedVideoFetchStatus } from "src/main";
import { Menu, Notice } from "obsidian";
import { VideosContext } from "src/store/videoContext";
import { UI_TEXT } from "src/constants/uiText";
import { categoriesService } from "src/categoriesService";
import {
	classifyVideoContent,
	getVideoLanguageLabel,
	matchesDurationFilter,
	matchesPublishedDateFilter,
	normalizeVideoLanguage,
	parseDurationToSeconds,
} from "src/utils/videoUtils";
import { LikedVideoCollection } from "src/ui/LikedVideoCollection";
import { ViewHeader } from "src/ui/ViewHeader";
import { OpenYouTubeButton } from "src/ui/OpenYouTubeButton";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { useLikedVideoFocus } from "src/hooks/useLikedVideoFocus";
import { likeVideoAndPersist, unlikeVideoAndPersist } from "src/services/likedVideoMutationService";

interface ActiveChannelFilter {
	id: string;
	title: string;
}

const SORT_OPTIONS = [
	{ value: "addedDate", label: UI_TEXT.SORT_BY_LIKED_ORDER },
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
	const contentTypeFilterLabel = contentTypeSelection.map((type) => type === "videos"
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
	const sortDirectionLabel = sortOption === "title" || sortOption === "channelTitle"
		? sortOrder === "ASC" ? "A to Z" : "Z to A"
		: sortOption === "addedDate" || sortOption === "date"
			? sortOrder === "ASC" ? "oldest first" : "newest first"
			: sortOrder === "ASC" ? "lowest first" : "highest first";

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

	const openVideoDisplaySettings = (): void => {
		if (!plugin.settingTabRef?.openVideoDisplaySettings()) {
			new Notice("Unable to open Geulo settings in this Obsidian version.");
		}
	};

	const openSyncMenu = (event: MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle("Full sync (replace saved list)")
			.setIcon("refresh-cw")
			.setDisabled(fetchStatus !== "idle")
			.onClick(() => {
				void plugin.performAutoFetch(true, false);
			}));
		menu.addSeparator();
		menu.addItem((item) => item
			.setTitle(UI_TEXT.BTN_SETTINGS)
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
						{UI_TEXT.HEADER_TITLE}
						{plugin.settings.autoFetchEnabled && (
							<span
								className="auto-fetch-indicator"
								title={`Auto-fetch: Every ${plugin.settings.autoFetchInterval < 1
									? `${Math.round(plugin.settings.autoFetchInterval * 60)} seconds`
									: `${plugin.settings.autoFetchInterval} minutes`
									}`}
							>
								{fetchStatus !== "idle"
									? fetchStatus === "creating-notes" ? "Creating notes..." : "Fetching..."
									: "⏰ Auto"}
							</span>
						)}
					</>
				}
				actions={
					<>
						<button
							title="Fetch the 50 most recent liked videos"
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
							title="More sync options"
							aria-label="More sync options"
							disabled={fetchStatus !== "idle"}
							onClick={openSyncMenu}
						>
							<MoreHorizontal size={16} />
						</button>
						<button
							className="video-view-header__settings-button"
							title={UI_TEXT.BTN_SETTINGS}
							onClick={openVideoDisplaySettings}
						>
							<Settings size={16} />
						</button>
					</>
				}
			/>
			<div className="liked-video-sync-status" role="status" aria-live="polite">
				{fetchStatus === "recent" && "Checking the 50 most recent liked videos..."}
				{fetchStatus === "full" && "Syncing all liked videos..."}
				{fetchStatus === "creating-notes" && "Liked videos updated. Creating notes..."}
				{fetchStatus === "idle" && plugin.settings.lastAutoFetchTime > 0 &&
					`Last checked ${new Date(plugin.settings.lastAutoFetchTime).toLocaleString()}`}
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
							? UI_TEXT.FILTERS_HIDE
							: UI_TEXT.FILTERS_SHOW
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
					{selectedChannel && <FilterChip label={`Channel: ${selectedChannel.title}`} onClear={() => setSelectedChannel(null)} />}
					{selectedCategory !== "all" && <FilterChip label={`Category: ${selectedCategoryTitle}`} onClear={() => setSelectedCategory("all")} />}
					{hasContentTypeFilter && <FilterChip label={`Type: ${contentTypeFilterLabel}`} onClear={() => setContentTypeSelection([])} />}
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
				<div id="liked-video-filters" className="filters-container liked-video-filters">
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
								selection={contentTypeSelection} onChange={setContentTypeSelection}
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
			{sortedVideos.length === 0 && (
				<div className="no-videos-found">
					<Search size={32} aria-hidden="true" />
					<div className="no-videos-found__title">
						{hasActiveQuery ? "No matching videos" : "No videos yet"}
					</div>
					<div className="no-videos-found__text">
						{hasActiveQuery
							? "No videos match the active filters"
							: UI_TEXT.NO_VIDEOS_FOUND}
					</div>
					<OpenYouTubeButton query={searchTerm} />
					{hasActiveQuery && (
						<button type="button" className="no-videos-found__clear-button" onClick={clearAllFilters}>
							Clear search and filters
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
							{fetchStatus === "full" ? "Fetching all liked videos..." : UI_TEXT.BTN_FETCH_ALL}
						</button>
					)}
				</div>
			)}
			{/* Videos */}
			<span ref={keyboardFocus.entryRef} tabIndex={sortedVideos.length > 0 ? 0 : -1} className="liked-video-focus-entry"
				onFocus={keyboardFocus.focusEntry}>
				Browse liked videos. Use Up and Down to navigate, Tab to leave the list, F2 for card controls, and Escape to return to the card.
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
									await unlikeVideoAndPersist(plugin.likedVideoApi, video.id);

									const fragment = new DocumentFragment();
									fragment.createSpan({ text: `Unliked "${video.snippet.title}" ` });
									const undoBtn = fragment.createEl("button", {
										text: "Undo",
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
												);
												notice.hide();
											} catch (error) {
												console.error("Failed to undo unlike:", error);
												new Notice(UI_TEXT.NOTICE_LIKE_FAILED);
											}
										})();
									}, { once: true });
								} catch (error) {
									console.error("Failed to unlike video:", error);
									new Notice(UI_TEXT.NOTICE_UNLIKE_FAILED);
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
								`Added video to ${file.basename} and opened the note`,
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
			{paginationMode === "pagination" && <nav className="video-view__pagination" aria-label="Pagination">
				<div className="video-view__pagination__controls">
					{currentPage > 1 && (
						<>
							<button
								type="button"
								aria-label="First page"
								title="First page"
								onClick={() => setCurrentPage(1)}
							>
								<ArrowLeftToLine size={16} />
							</button>
							<button
								type="button"
								aria-label="Previous page"
								title="Previous page"
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
						aria-label={`Page number, 1 to ${maximumPage}`}
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
								aria-label="Next page"
								title="Next page"
								onClick={() => setCurrentPage(currentPage + 1)}
							>
								<ArrowRight size={16} />
							</button>
							<button
								type="button"
								aria-label="Last page"
								title="Last page"
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
