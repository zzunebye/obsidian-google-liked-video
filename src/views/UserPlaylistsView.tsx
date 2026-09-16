import { Menu } from "obsidian";
import { useState, useMemo, useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
	Search,
	AlertCircle,
	RefreshCw,
	Video,
	Plus,
	ListVideo,
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
} from "lucide-react";
import { UI_TEXT } from "src/constants/uiText";
import { SearchBar } from "src/ui/SearchBar";
import { localStorageService } from "src/storage";
import { PlaylistCard } from "src/ui/PlaylistCard";
import { AddPlaylistForm } from "src/ui/AddPlaylistForm";
import { ViewHeader } from "src/ui/ViewHeader";
import { PlaylistInfo } from "src/types";

interface UserPlaylistsViewProps {
	browsingState: UserPlaylistsViewState;
	onStateChange: (state: Partial<UserPlaylistsViewState>) => void;
	playlists: PlaylistInfo[];
	isLoading: boolean;
	hasLoaded: boolean;
	error: string | null;
	onPlaylistSelect: (playlist: PlaylistInfo) => void;
	onRefresh: () => void;
	onAddPlaylist: (playlistId: string) => Promise<boolean>;
	onDeletePlaylist: (playlist: PlaylistInfo) => Promise<void>;
}

const SORT_OPTIONS = [
	{ value: "title", label: "Title" },
	{ value: "itemCount", label: "Video Count" },
	{ value: "publishedAt", label: "Time Created" },
] as const;
type PlaylistSortOption = typeof SORT_OPTIONS[number]["value"];

export interface UserPlaylistsViewState {
	searchTerm: string;
	sortOption: PlaylistSortOption;
	sortOrder: "ASC" | "DESC";
}

export const UserPlaylistsView: React.FC<UserPlaylistsViewProps> = ({
	browsingState,
	onStateChange,
	playlists,
	isLoading,
	hasLoaded,
	error,
	onPlaylistSelect,
	onRefresh,
	onAddPlaylist,
	onDeletePlaylist,
}) => {
	const { searchTerm, sortOption, sortOrder } = browsingState;
	const setSearchTerm = (searchTerm: string): void => onStateChange({ searchTerm });
	const [showAddForm, setShowAddForm] = useState(false);
	const [playlistIdInput, setPlaylistIdInput] = useState("");
	const [isAdding, setIsAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);

	// Component mount state for cleanup
	const isMountedRef = useRef(true);
	const isAddingRef = useRef(false);

	const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
		() => new Set(localStorageService.getPinnedPlaylistIds()),
	);

	useEffect(() => {
		const updatePinnedIds = (playlistIds: readonly string[]): void => {
			setPinnedIds(new Set(playlistIds));
		};
		const unsubscribe = localStorageService.subscribePinnedPlaylistIds(updatePinnedIds);
		updatePinnedIds(localStorageService.getPinnedPlaylistIds());
		return unsubscribe;
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	// Sort and filter playlists
	const sortedAndFilteredPlaylists = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		// First filter by search term
		const filtered = playlists.filter(
			(playlist) =>
				playlist.title
					.toLowerCase()
					.includes(query) ||
				playlist.description
					.toLowerCase()
					.includes(query),
		);

		// Then sort with pinned playlists first
		const sorted = [...filtered].sort((a, b) => {
			// Check if playlists are pinned
			const aPinned = pinnedIds.has(a.id);
			const bPinned = pinnedIds.has(b.id);

			// Pinned playlists always come first
			if (aPinned && !bPinned) return -1;
			if (!aPinned && bPinned) return 1;

			// If both are pinned or both are not pinned, sort by selected criteria
			let comparison = 0;

			switch (sortOption) {
				case "title":
					comparison = a.title.localeCompare(b.title);
					break;
				case "itemCount":
					comparison = a.itemCount - b.itemCount;
					break;

				case "publishedAt":
					if (!a.publishedAt && b.publishedAt) return 1;
					if (a.publishedAt && !b.publishedAt) return -1;
					comparison = (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "");
					break;
				default:
					comparison = a.title.localeCompare(b.title);
			}

			return sortOrder === "ASC" ? comparison : -comparison;
		});

		return sorted;
	}, [playlists, searchTerm, sortOption, sortOrder, pinnedIds]);

	// Handle sort option changes
	const handleSortOptionChange = (newSortOption: PlaylistSortOption) => {
		onStateChange({ sortOption: newSortOption });
		localStorageService.setPlaylistsSortOption(newSortOption);
	};

	const handleSortOrderChange = (newSortOrder: "ASC" | "DESC") => {
		onStateChange({ sortOrder: newSortOrder });
		localStorageService.setPlaylistsSortOrder(newSortOrder);
	};

	const selectedSortLabel = SORT_OPTIONS.find((option) => option.value === sortOption)?.label ?? "Title";
	const sortDirectionLabel = sortOrder === "ASC" ? "ascending" : "descending";
	const openSortMenu = (event: MouseEvent<HTMLButtonElement>): void => {
		const menu = new Menu().setUseNativeMenu(false);
		menu.addItem((item) => item.setTitle("Sort by").setIsLabel(true));
		SORT_OPTIONS.forEach((option) => {
			menu.addItem((item) => item
				.setTitle(option.label)
				.setChecked(sortOption === option.value)
				.onClick(() => handleSortOptionChange(option.value)));
		});
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Ascending").setChecked(sortOrder === "ASC")
			.onClick(() => handleSortOrderChange("ASC")));
		menu.addItem((item) => item.setTitle("Descending").setChecked(sortOrder === "DESC")
			.onClick(() => handleSortOrderChange("DESC")));
		const rect = event.currentTarget.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom }, event.currentTarget.ownerDocument);
	};

	// Handle pin/unpin operations
	const handleTogglePin = (playlistId: string) => {
		if (pinnedIds.has(playlistId)) {
			localStorageService.unpinPlaylist(playlistId);
		} else {
			localStorageService.pinPlaylist(playlistId);
		}
	};

	const handleAddPlaylist = async () => {
		if (isAddingRef.current) return;
		if (!playlistIdInput.trim()) {
			setAddError("Please enter a playlist ID or URL");
			return;
		}

		isAddingRef.current = true;
		setIsAdding(true);
		setAddError(null);

		try {
			const success = await onAddPlaylist(playlistIdInput.trim());

			// Check if component is still mounted before updating state
			if (!isMountedRef.current) return;

			if (success) {
				setPlaylistIdInput("");
				setShowAddForm(false);
				setAddError(null);
			} else {
				setAddError("Playlist already exists in your saved playlists");
			}
		} catch (error) {
			// Check if component is still mounted before updating state
			if (!isMountedRef.current) return;
			setAddError(error instanceof Error ? error.message : "Failed to add playlist");
		} finally {
			isAddingRef.current = false;
			// Check if component is still mounted before updating state
			if (isMountedRef.current) {
				setIsAdding(false);
			}
		}
	};

	const resetAddForm = () => {
		if (isAddingRef.current) return;
		setShowAddForm(false);
		setPlaylistIdInput("");
		setAddError(null);
		setIsAdding(false);
	};

	const handleViewKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
		if (!showAddForm && !searchTerm) return;
		event.preventDefault();
		event.stopPropagation();
		if (showAddForm) resetAddForm();
		else setSearchTerm("");
	};

	// Loading State - skeleton cards
	if (isLoading && !hasLoaded && playlists.length === 0) {
		return (
			<div className="user-playlists-view">
				<ViewHeader
					icon={<ListVideo className="video-view-header__icon" />}
					title={UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
				/>

				<div className="playlists-loading-skeleton" role="status" aria-label="Loading playlists">
					{Array.from({ length: 5 }).map((_, i) => (
						<div key={i} className="skeleton-playlist-card">
							<div className="skeleton-playlist-card__thumbnail" />
							<div className="skeleton-playlist-card__content">
								<div className="skeleton-card__line skeleton-card__line--title" />
								<div className="skeleton-card__line skeleton-card__line--channel" />
								<div className="skeleton-card__line skeleton-card__line--meta" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	// Error State
	if (error && !hasLoaded && playlists.length === 0) {
		return (
			<div className="user-playlists-view">
				<ViewHeader
					icon={<ListVideo className="video-view-header__icon" />}
					title={UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
				/>

				<div className="playlists-error" role="alert">
					<div className="playlists-error__icon">
						<AlertCircle size={48} />
					</div>
					<div className="playlists-error__title">
						Failed to load playlists
					</div>
					<div className="playlists-error__message">{error}</div>
					<button
						className="playlists-error__retry-button"
						onClick={onRefresh}
					>
						<RefreshCw size={16} />
						Try Again
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="user-playlists-view" onKeyDown={handleViewKeyDown}>
			<ViewHeader
				icon={<ListVideo className="video-view-header__icon" />}
				title={UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
				actions={
					<>
						<button
							type="button"
							className="refresh-button"
							onClick={onRefresh}
							disabled={isLoading || isAdding}
							title="Refresh playlists"
							aria-label="Refresh playlists"
						>
							<RefreshCw
								size={16}
								className={isLoading ? "animate-spin" : ""}
							/>
						</button>
						<button
							type="button"
							className="add-playlist-button"
							onClick={() => setShowAddForm(true)}
							disabled={isLoading || showAddForm}
							title="Add playlist by ID or URL"
							aria-label="Add playlist by ID or URL"
						>
							<Plus size={16} />
						</button>
					</>
				}
			/>

			{isLoading && <div className="liked-video-sync-status" role="status">Refreshing playlists...</div>}
			{error && (
				<div className="subscription-warning" role="alert">
					<span>{error}</span>
					<button type="button" onClick={onRefresh} disabled={isLoading || isAdding}>Try again</button>
				</div>
			)}

			{/* Add Playlist Form */}
			{showAddForm && (
				<AddPlaylistForm
					resetAddForm={resetAddForm}
					isAdding={isAdding}
					playlistIdInput={playlistIdInput}
					setPlaylistIdInput={setPlaylistIdInput}
					handleAddPlaylist={() => {
						void handleAddPlaylist();
					}}
					addError={addError}
				/>
			)}

			{playlists.length > 0 && (
				<div className="search-bar-container">
					<div className="search-bar-wrapper">
						<SearchBar
							searchTerm={searchTerm}
							onSearchTermChange={setSearchTerm}
							escapeClearsSearch
							ariaLabel="Search playlists"
							placeholder="Search by title or description..."
						/>
					</div>
					<button type="button" className="sort-menu-button"
						title={`Sort by: ${selectedSortLabel}, ${sortDirectionLabel}`}
						aria-label={`Sort playlists. Current: ${selectedSortLabel}, ${sortDirectionLabel}`}
						aria-haspopup="menu" onClick={openSortMenu}>
						{sortOrder === "DESC" ? (
							<ArrowDownWideNarrow size={16} aria-hidden="true" />
						) : (
							<ArrowUpNarrowWide size={16} aria-hidden="true" />
						)}
					</button>
				</div>
			)}

			{playlists.length > 0 && (
				<div className="liked-video-result-count" aria-live="polite" aria-atomic="true">
					<span>{sortedAndFilteredPlaylists.length} of {playlists.length} playlists</span>
					<span aria-hidden="true">·</span>
					<span className="liked-video-result-sort" aria-label={`Sorted by ${selectedSortLabel}, ${sortDirectionLabel}`}>
						{selectedSortLabel} <span aria-hidden="true">{sortOrder === "DESC" ? "↓" : "↑"}</span>
					</span>
				</div>
			)}

			{playlists.length === 0 ? (
				<div className="no-videos-found">
					<div className="no-videos-found__icon">
						<Video size={32} aria-hidden="true" />
					</div>
					<div className="no-videos-found__title">
						No playlists found
					</div>
					<div className="no-videos-found__text">
						Create playlists on YouTube to see them here.
					</div>
				</div>
			) : sortedAndFilteredPlaylists.length === 0 ? (
				<div className="no-videos-found">
					<div className="no-videos-found__icon">
						<Search size={32} aria-hidden="true" />
					</div>
					<div className="no-videos-found__title">
						No matching playlists
					</div>
					<div className="no-videos-found__text">
						No playlists match "{searchTerm}". Try a different
						search term.
					</div>
					<button
						type="button"
						className="no-videos-found__clear-button"
						onClick={() => setSearchTerm("")}
					>
						Clear search
					</button>
				</div>
			) : (
				<div className="playlists-grid">
					{sortedAndFilteredPlaylists.map(
						(playlist: PlaylistInfo) => (
							<PlaylistCard
								key={playlist.id}
								playlist={playlist}
								onPlaylistSelect={onPlaylistSelect}
								onTogglePin={handleTogglePin}
								onDeletePlaylist={
									playlist.isOwnedByUser === true
										? onDeletePlaylist
										: undefined
								}
								isPinned={pinnedIds.has(playlist.id)}
							/>
						),
					)}
				</div>
			)}
		</div>
	);
};
