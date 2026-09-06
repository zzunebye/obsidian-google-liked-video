import { useContext, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
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
} from "lucide-react";
import { VideoCard } from "src/ui/VideoCard";
import { SearchBar } from "src/ui/SearchBar";
import { APP_ID } from "src/main";
import { Modal, Notice } from "obsidian";
import { VideosContext } from "src/store/videoContext";
import { UI_TEXT } from "src/constants/uiText";
import { categoriesService } from "src/categoriesService";
import { parseDurationToSeconds } from "src/ui/VideoInfoModal";
import { LikedVideoCollection } from "src/ui/LikedVideoCollection";
import { ViewHeader } from "src/ui/ViewHeader";
import { ActiveTagFilter } from "src/ui/ActiveTagFilter";
import { createNotesForNewVideos, fetchAndMergeLikedVideos } from "src/services/likedVideoFetchService";
import { appendNoteContent } from "src/utils/noteEditingUtils";
export const LikedVideoView: React.FC = () => {
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
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
	const [filtersExpanded, setFiltersExpanded] = useState(
		localStorageService.getFiltersExpanded(),
	);
	const [videos, setVideos] = useContext(VideosContext);
	const [isFetching, setIsFetching] = useState(false);
	const plugin = usePlugin();
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

			return (
				searchMatch &&
				exactTagMatch &&
				categoryMatch &&
				contentTypeMatch &&
				aiNoteMatch
			);
		});
	}, [
		videos,
		debouncedSearchTerm,
		selectedTag,
		selectedCategory,
		contentTypeSelection,
		shortVideoMaxDurationSeconds,
		videoDurations,
		showAINoteOnly,
	]);

	const sortedVideos = useMemo(() => {
		const sorted = [...filteredVideos];
		switch (sortOption) {
			case "title":
				sorted.sort((a, b) =>
					a.snippet.title.localeCompare(b.snippet.title),
				);
				break;
			case "viewCount":
				sorted.sort(
					(a, b) => b.statistics.viewCount - a.statistics.viewCount,
				);
				break;
			case "likeCount":
				sorted.sort(
					(a, b) => b.statistics.likeCount - a.statistics.likeCount,
				);
				break;
			case "commentCount":
				sorted.sort((a, b) => {
					const aCommentCount =
						parseInt(a.statistics.commentCount) || 0;
					const bCommentCount =
						parseInt(b.statistics.commentCount) || 0;
					return bCommentCount - aCommentCount;
				});
				break;
			case "likeViewRatio":
				sorted.sort(
					(a, b) =>
						b.statistics.likeCount / b.statistics.viewCount -
						a.statistics.likeCount / a.statistics.viewCount,
				);
				break;

			case "date":
				sorted.sort(
					(a, b) =>
						new Date(b.snippet.publishedAt).getTime() -
						new Date(a.snippet.publishedAt).getTime(),
				);
				break;
			case "addedDate":
				sorted.sort((a, b) => videos.indexOf(a) - videos.indexOf(b));
				break;
			case "duration":
				sorted.sort((a, b) => {
					const aDuration = videoDurations.get(a.id) || 0;
					const bDuration = videoDurations.get(b.id) || 0;
					return bDuration - aDuration;
				});
				break;
		}
		if (sortOrder === "ASC") {
			sorted.reverse();
		}
		return sorted;
	}, [filteredVideos, sortOption, videos, sortOrder, videoDurations]);

	const totalPages = Math.ceil(sortedVideos.length / videosPerPage);
	const maximumPage = Math.max(totalPages, 1);
	const browsingKey = JSON.stringify([paginationMode, debouncedSearchTerm, selectedTag, sortOption,
		sortOrder, selectedCategory, contentTypeSelection, showAINoteOnly]);

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
								{plugin.isFetching
									? "🔄 Fetching..."
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
							title={UI_TEXT.BTN_REFRESH}
							/// Refresh button to fetch recently liked videos
							className="video-view-header__refresh-button"
							disabled={isFetching || plugin.isFetching}
							onClick={() => {
								void (async () => {
									setIsFetching(true);
									try {
										const result = await fetchAndMergeLikedVideos(
											plugin.likedVideoApi,
											{
												mode: "partial",
												keepUnfetched: true,
											},
										);

										localStorageService.setLikedVideos(
											result.mergedVideos,
										);
										setVideos(result.mergedVideos);
										new Notice(
											UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(
												result.newVideos.length,
											),
										);
										await createNotesForNewVideos(
											result.newVideos,
											plugin.settings.autoCreateNoteEnabled,
											(video) =>
												plugin.automateVideoProcessing(video),
										);
									} finally {
										setIsFetching(false);
									}
								})();
							}}
						>
							<RefreshCcw size={16} />
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

			<div className="search-bar-container">
				<div className="search-bar-wrapper">
					<SearchBar
						searchTerm={searchTerm}
						onSearchTermChange={setSearchTerm}
						escapeClearsSearch
					/>
				</div>
				<button
					className={`filter-toggle-button ${filtersExpanded ? "filter-toggle-button--active" : ""}`}
					title={
						filtersExpanded
							? UI_TEXT.FILTERS_HIDE
							: UI_TEXT.FILTERS_SHOW
					}
					onClick={() => setFiltersExpanded((prev) => !prev)}
				>
					<SlidersHorizontal size={16} />
				</button>
			</div>
			{selectedTag && (
				<ActiveTagFilter
					tag={selectedTag}
					onClear={() => setSelectedTag(null)}
				/>
			)}

			<div
				className={`filters-container ${filtersExpanded ? "filters-container--expanded" : "filters-container--collapsed"}`}
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
								title={UI_TEXT.BTN_TOGGLE_SORT_ORDER}
								onClick={() =>
									setSortOrder(
										sortOrder === "ASC" ? "DESC" : "ASC",
									)
								}
								className="video-view-sort__order"
								aria-label={UI_TEXT.ARIA_TOGGLE_SORT_ORDER}
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
			</div>
			{sortedVideos.length === 0 && (
				<div className="no-videos-found">
					<div className="no-videos-found__text">
						{debouncedSearchTerm || selectedTag
							? "No videos match the active filters"
							: UI_TEXT.NO_VIDEOS_FOUND}
					</div>

					{videos.length === 0 && (
						<button
							className="no-videos-found__fetch-all-button"
							onClick={() => {
								void (async () => {
									try {
										const totalLikedVideos =
											await plugin.likedVideoApi.fetchTotalLikedVideoCount();
										new Notice(
											UI_TEXT.NOTICE_TOTAL_VIDEOS(
												totalLikedVideos ?? 0,
											),
										);

										const result = await fetchAndMergeLikedVideos(
											plugin.likedVideoApi,
											{
												mode: "full",
												keepUnfetched: false,
											},
										);
										localStorageService.setLikedVideos(
											result.mergedVideos,
										);
										setVideos(result.mergedVideos);

										new Notice(
											UI_TEXT.NOTICE_ALL_VIDEOS_SAVED(
												result.fetchedCount,
											),
										);
										await createNotesForNewVideos(
											result.newVideos,
											plugin.settings.autoCreateNoteEnabled,
											(video) =>
												plugin.automateVideoProcessing(video),
										);
									} catch (error) {
										new Modal(plugin.app)
											.setTitle(UI_TEXT.ERROR_TITLE)
											.setContent(UI_TEXT.ERROR_MESSAGE(error))
											.open();
									}
								})();
							}}
						>
							{UI_TEXT.BTN_FETCH_ALL}
						</button>
					)}
				</div>
			)}
			{/* Videos */}
			<LikedVideoCollection videos={sortedVideos} mode={paginationMode} currentPage={currentPage}
				resetKey={browsingKey} renderVideo={(video, noteExists, summaryState) => (
					<VideoCard
						{...summaryState}
						key={video.id}
						source="liked"
						id={video.id}
						url={`https://www.youtube.com/watch?v=${video.id}`}
						videoInfo={video}
						noteExists={noteExists}
						onUnlike={() => {
							void (async () => {
								const index = videos.findIndex((v) => v.id === video.id);
								const previousVideoId = index > 0 ? videos[index - 1].id : null;
								await plugin.likedVideoApi.unlikeVideo(video.id);
								const filtered = videos.filter((v) => v.id !== video.id);
								localStorageService.setLikedVideos(filtered);
								setVideos(filtered);

								const fragment = new DocumentFragment();
								fragment.createEl("span", { text: `Unliked "${video.snippet.title}" ` });
								const undoBtn = fragment.createEl("span", {
									text: "Undo",
									cls: "geulo-undo-btn",
								});
								const notice = new Notice(fragment, 5000);
								undoBtn.addEventListener("click", () => {
									void (async () => {
										try {
											await plugin.likedVideoApi.likeVideo(video.id);
											const current = localStorageService.getLikedVideos();
											const restored = [...current];
											let insertIndex = 0;
											if (previousVideoId) {
												const prevIdx = restored.findIndex((v) => v.id === previousVideoId);
												insertIndex = prevIdx >= 0 ? prevIdx + 1 : Math.min(index, restored.length);
											}
											restored.splice(insertIndex, 0, video);
											localStorageService.setLikedVideos(restored);
											setVideos(restored);
											notice.hide();
										} catch (error) {
											console.error("Failed to undo unlike:", error);
											new Notice(UI_TEXT.NOTICE_LIKE_FAILED);
										}
									})();
								}, { once: true });
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
						onChannelClick={(channelTitle) => {
							setSearchTerm(channelTitle);
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
