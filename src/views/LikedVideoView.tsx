import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { usePlugin } from "../store/pluginContext";
import { localStorageService } from "src/storage";
import {
	ContentTypeOption,
	ContentTypeSelection,
} from "src/types";
import {
	Youtube,
	Settings,
	RefreshCcw,
	Filter,
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	ArrowRight,
	ArrowRightToLine,
	ArrowLeftToLine,
	ArrowLeft,
	Bot,
	ChevronDown,
	SlidersHorizontal,
	MoreHorizontal,
} from "lucide-react";
import { VideoCard } from "src/ui/VideoCard";
import { SearchBar } from "src/ui/SearchBar";
import { APP_ID } from "src/main";
import type { LikedVideoFetchStatus } from "src/main";
import { Menu, Notice } from "obsidian";
import { VideosContext } from "src/store/videoContext";
import { UI_TEXT } from "src/constants/uiText";
import { categoriesService } from "src/categoriesService";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { LikedVideoCollection } from "src/ui/LikedVideoCollection";
import { ViewHeader } from "src/ui/ViewHeader";
import { appendNoteContent } from "src/utils/noteEditingUtils";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";

interface ActiveChannelFilter {
	id: string;
	title: string;
}

const FilterChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
	<button type="button" className="active-tag-filter__chip" title={`Clear ${label}`} onClick={onClear}>
		<span className="active-tag-filter__label">{label}</span>
		<span className="active-tag-filter__remove" aria-hidden="true">×</span>
	</button>
);

export const LikedVideoView: React.FC = () => {
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
	const [showAINoteOnly, setShowAINoteOnly] = useState(
		localStorageService.getAINoteFilter(),
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

	// Pre-process video durations once
	const videoDurations = useMemo(() => {
		const durations = new Map<string, number>();
		videos.forEach((video) => {
			if (video.contentDetails?.duration) {
				const seconds = parseDurationToSeconds(
					video.contentDetails.duration,
				);
				// Use 0 as fallback if parsing fails
				durations.set(video.id, seconds ?? 0);
			} else {
				// Set 0 for videos without duration info
				durations.set(video.id, 0);
			}
		});
		return durations;
	}, [videos]);

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
		localStorageService.setAINoteFilter(showAINoteOnly);
	}, [showAINoteOnly]);

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
			setDebouncedSearchTerm(searchTerm);
		}, 300);

		return () => window.clearTimeout(timer);
	}, [searchTerm]);

	const filteredVideos = useMemo(() => {
		// Pre-calculate lowercase search term once
		const lowerSearchTerm = debouncedSearchTerm.toLowerCase();

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
			const durationInSeconds = videoDurations.get(video.id) || 0;
			const isMusic = video.snippet.categoryId === "10";
			const isShort =
				durationInSeconds > 0 &&
				durationInSeconds <= shortVideoMaxDurationSeconds;
			const isRegularVideo = !isShort && !isMusic;

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

			// AI Note filter
			const aiNoteMatch =
				!showAINoteOnly ||
				plugin.summaryStorage.hasVideoSummary(video.id);
			const hasVideoNote = noteExistenceMap.get(video.id) ?? false;
			const videoNoteMatch = videoNoteFilter === "all" ||
				(videoNoteFilter === "with" ? hasVideoNote : !hasVideoNote);

			return (
				searchMatch &&
				exactTagMatch &&
				channelMatch &&
				categoryMatch &&
				contentTypeMatch &&
				aiNoteMatch &&
				videoNoteMatch
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
		showAINoteOnly,
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
			case "viewCount":
				sorted.sort(
					(a, b) => a.statistics.viewCount - b.statistics.viewCount,
				);
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
				sorted.sort((a, b) => {
					const aRatio = a.statistics.viewCount > 0
						? a.statistics.likeCount / a.statistics.viewCount
						: -1;
					const bRatio = b.statistics.viewCount > 0
						? b.statistics.likeCount / b.statistics.viewCount
						: -1;
					return aRatio - bRatio;
				});
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
					const aDuration = videoDurations.get(a.id) || 0;
					const bDuration = videoDurations.get(b.id) || 0;
					return aDuration - bDuration;
				});
				break;
		}
		if (sortOrder === "DESC") {
			sorted.reverse();
		}
		return sorted;
	}, [filteredVideos, sortOption, videos, sortOrder, videoDurations]);

	const totalPages = Math.ceil(sortedVideos.length / videosPerPage);
	const maximumPage = Math.max(totalPages, 1);
	const browsingKey = JSON.stringify([paginationMode, debouncedSearchTerm, selectedTag, selectedChannel?.id,
		sortOption, sortOrder, selectedCategory, contentTypeSelection, showAINoteOnly, videoNoteFilter]);
	const hasContentTypeFilter = contentTypeSelection.length > 0 && contentTypeSelection.length < 3;
	const activeFilterCount = Number(selectedTag !== null) + Number(selectedChannel !== null) +
		Number(selectedCategory !== "all") + Number(hasContentTypeFilter) + Number(showAINoteOnly) +
		Number(videoNoteFilter !== "all");
	const selectedCategoryTitle = availableCategories.find((category) =>
		category.id === selectedCategory)?.title ?? selectedCategory;
	const contentTypeFilterLabel = contentTypeSelection.map((type) => type === "videos"
		? UI_TEXT.CONTENT_TYPE_VIDEOS
		: type === "shorts" ? UI_TEXT.CONTENT_TYPE_SHORTS : UI_TEXT.CONTENT_TYPE_MUSIC).join(", ");
	const hasActiveQuery = debouncedSearchTerm.length > 0 || activeFilterCount > 0;
	const sortDirectionLabel = sortOption === "title"
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

	const getContentTypeLabel = (type: ContentTypeOption): string => {
		switch (type) {
			case "videos":
				return UI_TEXT.CONTENT_TYPE_VIDEOS;
			case "shorts":
				return UI_TEXT.CONTENT_TYPE_SHORTS;
			case "music":
				return UI_TEXT.CONTENT_TYPE_MUSIC;
		}
	};

	const getContentTypeTooltip = (type: ContentTypeOption): string => {
		switch (type) {
			case "videos":
				return UI_TEXT.TOOLTIP_VIDEOS(shortVideoMaxDurationSeconds);
			case "shorts":
				return UI_TEXT.TOOLTIP_SHORTS(shortVideoMaxDurationSeconds);
			case "music":
				return UI_TEXT.TOOLTIP_MUSIC;
		}
	};

	const toggleContentType = (type: ContentTypeOption) => {
		setContentTypeSelection((prev) =>
			prev.includes(type)
				? prev.filter((t) => t !== type)
				: [...prev, type],
		);
	};

	const clearAllFilters = (): void => {
		setSearchTerm("");
		setDebouncedSearchTerm("");
		setSelectedTag(null);
		setSelectedChannel(null);
		setSelectedCategory("all");
		setContentTypeSelection([]);
		setShowAINoteOnly(false);
		setVideoNoteFilter("all");
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
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.right, y: rect.bottom });
	};

	return (
		<div className="liked-video-view" onKeyDown={handleViewKeyDown}>
			<ViewHeader
				icon={<Youtube className="video-view-header__icon" />}
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
				badge={UI_TEXT.VIDEO_COUNT_WITH_TOTAL(
					filteredVideos.length,
					videos.length,
				)}
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
							title={UI_TEXT.BTN_SETTINGS}
							onClick={() => {
								// Open Plugin Setting.
								const setting = Reflect.get(plugin.app, "setting");
								if (
									typeof setting === "object" &&
									setting !== null &&
									"open" in setting &&
									typeof setting.open === "function" &&
									"openTabById" in setting &&
									typeof setting.openTabById === "function"
								) {
									setting.open();
									setting.openTabById(APP_ID);
								} else {
									new Notice("Unable to open Geulo settings in this Obsidian version.");
								}
							}}
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
			</div>
			{activeFilterCount > 0 && (
				<div className="active-tag-filter active-filter-list" aria-label="Active filters">
					{selectedTag && <FilterChip label={`Tag: ${selectedTag}`} onClear={() => setSelectedTag(null)} />}
					{selectedChannel && <FilterChip label={`Channel: ${selectedChannel.title}`} onClear={() => setSelectedChannel(null)} />}
					{selectedCategory !== "all" && <FilterChip label={`Category: ${selectedCategoryTitle}`} onClear={() => setSelectedCategory("all")} />}
					{hasContentTypeFilter && <FilterChip label={`Type: ${contentTypeFilterLabel}`} onClear={() => setContentTypeSelection([])} />}
					{showAINoteOnly && <FilterChip label="AI summary" onClear={() => setShowAINoteOnly(false)} />}
					{videoNoteFilter !== "all" && (
						<FilterChip label={videoNoteFilter === "with" ? "Has video note" : "No video note"} onClear={() => setVideoNoteFilter("all")} />
					)}
					<button type="button" className="active-filter-list__clear" onClick={clearAllFilters}>Clear all</button>
				</div>
			)}

			{filtersExpanded && <div
				id="liked-video-filters"
				className="filters-container filters-container--expanded"
			>
				<div className="video-view-sort">
					<div className="video-view-sort-left-group">
						<div className="category-filter">
							<Filter
								size={14}
								className="category-filter-icon"
							/>
							<select
								className="category-filter-select"
								value={selectedCategory}
								onChange={(e) =>
									setSelectedCategory(e.target.value)
								}
								disabled={
									!isCategoriesReady ||
									availableCategories.length === 0
								}
							>
								<option value="all">
									All Categories ({videos.length})
								</option>
								{availableCategories.map((category) => (
									<option
										key={category.id}
										value={category.id}
									>
										{category.title} (
										{categoryCounts[category.id] || 0})
									</option>
								))}
								{!isCategoriesReady && (
									<option value="loading" disabled>
										Loading categories...
									</option>
								)}
							</select>
						</div>
						<div
							className="content-type-filter"
							role="group"
							aria-label="Filter by content type"
						>
							{(
								[
									"videos",
									"shorts",
									"music",
								] as ContentTypeOption[]
							).map((option) => (
								<label
									key={option}
									className={`content-type-filter__option ${contentTypeSelection.includes(option) ? "content-type-filter__option--selected" : ""}`}
								>
									<input
										type="checkbox"
										checked={contentTypeSelection.includes(
											option,
										)}
										onChange={() =>
											toggleContentType(option)
										}
										className="content-type-filter__input"
									/>
									<span className="content-type-filter__text">
										{getContentTypeLabel(option)}
									</span>
									<span className="content-type-filter__tooltip">
										{getContentTypeTooltip(option)}
									</span>
								</label>
							))}
						</div>
						<div className="filters-divider" />
						<label
							className={`content-type-filter__option ${showAINoteOnly ? "content-type-filter__option--selected" : ""}`}
							title={UI_TEXT.AI_NOTE_FILTER_TOOLTIP}
						>
							<input
								type="checkbox"
								checked={showAINoteOnly}
								onChange={() =>
									setShowAINoteOnly((prev) => !prev)
								}
								className="content-type-filter__input"
							/>
							<Bot size={14} />
							<span className="content-type-filter__text">
								{UI_TEXT.AI_NOTE_FILTER_LABEL}
							</span>
						</label>
						<div className="filters-divider" />
						<div className="video-view-sort__select-wrapper">
							<select
								className="video-view-sort__select"
								aria-label="Filter by video note"
								value={videoNoteFilter}
								onChange={(event) => setVideoNoteFilter(event.target.value as "all" | "with" | "without")}
							>
								<option value="all">All note states</option>
								<option value="with">Has video note</option>
								<option value="without">No video note</option>
							</select>
							<ChevronDown className="video-view-sort__select-icon" size={16} aria-hidden="true" />
						</div>
						<div className="filters-divider" />
						<div className="sort-controls-inline">
							<div className="video-view-sort__select-wrapper">
								<select
									id="sort-video-select"
									className="video-view-sort__select"
									aria-label={UI_TEXT.ARIA_SORT_VIDEOS}
									value={sortOption}
									onChange={(e) => setSortOption(e.target.value)}
								>
									<option value="addedDate">
										{UI_TEXT.SORT_BY_LIKED_ORDER}
									</option>
									<option value="viewCount">
										{UI_TEXT.SORT_BY_VIEW_COUNT}
									</option>
									<option value="likeCount">
										{UI_TEXT.SORT_BY_LIKE_COUNT}
									</option>
									<option value="commentCount">
										{UI_TEXT.SORT_BY_COMMENT_COUNT}
									</option>
									<option value="likeViewRatio">
										{UI_TEXT.SORT_BY_LIKE_VIEW_RATIO}
									</option>
									<option value="date">
										{UI_TEXT.SORT_BY_PUBLISHED_DATE}
									</option>
									<option value="title">
										{UI_TEXT.SORT_BY_TITLE}
									</option>
									<option value="duration">
										{UI_TEXT.SORT_BY_DURATION}
									</option>
								</select>
								<ChevronDown
									className="video-view-sort__select-icon"
									size={16}
									aria-hidden="true"
								/>
							</div>
							<button
								title={`Current order: ${sortDirectionLabel}`}
								onClick={() =>
									setSortOrder(
										sortOrder === "ASC" ? "DESC" : "ASC",
									)
								}
								className="video-view-sort__order"
								aria-label={`Change sort order. Current order: ${sortDirectionLabel}`}
							>
								{sortOrder === "DESC" ? (
									<ArrowDownWideNarrow size={16} />
								) : (
									<ArrowUpNarrowWide size={16} />
								)}
							</button>
						</div>
					</div>
				</div>
			</div>}
			{sortedVideos.length === 0 && (
				<div className="no-videos-found">
					<div className="no-videos-found__text">
						{hasActiveQuery
							? "No videos match the active filters"
							: UI_TEXT.NO_VIDEOS_FOUND}
					</div>
					{hasActiveQuery && (
						<button type="button" className="no-videos-found__fetch-all-button" onClick={clearAllFilters}>
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
			<LikedVideoCollection videos={sortedVideos} mode={paginationMode} currentPage={currentPage}
				noteExistenceMap={noteExistenceMap}
				resetKey={browsingKey} renderVideo={(video, noteExists, summaryState) => (
					<VideoCard
						{...summaryState}
						key={video.id}
						source="liked"
						id={video.id}
						url={`https://www.youtube.com/watch?v=${video.id}`}
						videoInfo={video}
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
									await plugin.likedVideoApi.unlikeVideo(video.id);
									localStorageService.removeLikedVideo(video.id);

									const fragment = new DocumentFragment();
									fragment.createEl("span", { text: `Unliked "${video.snippet.title}" ` });
									const undoBtn = fragment.createEl("button", {
										text: "Undo",
										cls: "geulo-undo-btn",
									});
									const notice = new Notice(fragment, 5000);
									undoBtn.addEventListener("click", () => {
										void (async () => {
											try {
												await plugin.likedVideoApi.likeVideo(video.id);
												const current = localStorageService.getLikedVideos();
												const previousIndex = previousVideoId
													? current.findIndex((item) => item.id === previousVideoId)
													: -1;
												const insertIndex = previousIndex >= 0
													? previousIndex + 1
													: Math.min(index, current.length);
												localStorageService.restoreLikedVideo(video, insertIndex);
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
