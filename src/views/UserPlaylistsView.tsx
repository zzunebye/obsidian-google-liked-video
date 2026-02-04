import { useState, useMemo, useEffect, useRef } from "react";
import { PlaylistInfo } from "src/api";
import {
	Search,
	AlertCircle,
	RefreshCw,
	Video,
	Plus,
	Youtube,
} from "lucide-react";
import { UI_TEXT } from "src/constants/uiText";
import { SearchBar } from "src/ui/SearchBar";
import { localStorageService } from "src/storage";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { PlaylistCard } from "src/ui/PlaylistCard";
import { AddPlaylistForm } from "src/ui/AddPlaylistForm";
import { ViewHeader } from "src/ui/ViewHeader";

interface UserPlaylistsViewProps {
	playlists: PlaylistInfo[];
	isLoading: boolean;
	error: string | null;
	onPlaylistSelect: (playlist: PlaylistInfo) => void;
	onRetry: () => void;
	onAddPlaylist: (playlistId: string) => Promise<boolean>;
}

export const UserPlaylistsView: React.FC<UserPlaylistsViewProps> = ({
	playlists,
	isLoading,
	error,
	onPlaylistSelect,
	onRetry,
	onAddPlaylist,
}) => {
	const [searchTerm, setSearchTerm] = useState("");
	const [showAddForm, setShowAddForm] = useState(false);
	const [playlistIdInput, setPlaylistIdInput] = useState("");
	const [isAdding, setIsAdding] = useState(false);
	const [addError, setAddError] = useState<string | null>(null);

	// Component mount state for cleanup
	const isMountedRef = useRef(true);

	// Sort state
	const [sortOption, setSortOption] = useState(() =>
		localStorageService.getPlaylistsSortOption(),
	);
	const [sortOrder, setSortOrder] = useState(() =>
		localStorageService.getPlaylistsSortOrder(),
	);

	// Force re-render state for pin changes
	const [forceUpdateFlag, setForceUpdateFlag] = useState(0);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	// Sort and filter playlists
	const sortedAndFilteredPlaylists = useMemo(() => {
		// First filter by search term
		const filtered = playlists.filter(
			(playlist) =>
				playlist.title
					.toLowerCase()
					.includes(searchTerm.toLowerCase()) ||
				playlist.description
					.toLowerCase()
					.includes(searchTerm.toLowerCase()),
		);

		// Then sort with pinned playlists first
		const sorted = [...filtered].sort((a, b) => {
			// Check if playlists are pinned
			const aPinned = localStorageService.isPlaylistPinned(a.id);
			const bPinned = localStorageService.isPlaylistPinned(b.id);

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
					comparison =
						a.publishedAt?.localeCompare(b.publishedAt || "") || 0;
					break;
				default:
					comparison = a.title.localeCompare(b.title);
			}

			return sortOrder === "ASC" ? comparison : -comparison;
		});

		return sorted;
	}, [playlists, searchTerm, sortOption, sortOrder, forceUpdateFlag]);

	// Handle sort option changes
	const handleSortOptionChange = (newSortOption: string) => {
		setSortOption(newSortOption);
		localStorageService.setPlaylistsSortOption(newSortOption);
	};

	const handleSortOrderToggle = () => {
		const newSortOrder = sortOrder === "ASC" ? "DESC" : "ASC";
		setSortOrder(newSortOrder);
		localStorageService.setPlaylistsSortOrder(newSortOrder);
	};

	// Handle pin/unpin operations
	const handleTogglePin = (playlistId: string) => {
		if (localStorageService.isPlaylistPinned(playlistId)) {
			localStorageService.unpinPlaylist(playlistId);
		} else {
			localStorageService.pinPlaylist(playlistId);
		}
		// Force re-render to update pin states and sorting
		setForceUpdateFlag((prev) => prev + 1);
	};

	const handleAddPlaylist = async () => {
		if (!playlistIdInput.trim()) {
			setAddError("Please enter a playlist ID or URL");
			return;
		}

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
			setAddError(error.message || "Failed to add playlist");
		} finally {
			// Check if component is still mounted before updating state
			if (isMountedRef.current) {
				setIsAdding(false);
			}
		}
	};

	const resetAddForm = () => {
		setShowAddForm(false);
		setPlaylistIdInput("");
		setAddError(null);
		setIsAdding(false);
	};

	// Loading State - skeleton cards
	if (isLoading) {
		return (
			<div className="user-playlists-view">
				<ViewHeader
					icon={<Youtube className="video-view-header__icon" />}
					title={UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
				/>

				<div className="playlists-loading-skeleton">
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
	if (error) {
		return (
			<div className="user-playlists-view">
				<ViewHeader
					icon={<Youtube className="video-view-header__icon" />}
					title={UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
				/>

				<div className="playlists-error">
					<div className="playlists-error__icon">
						<AlertCircle size={48} />
					</div>
					<div className="playlists-error__title">
						Failed to load playlists
					</div>
					<div className="playlists-error__message">{error}</div>
					<button
						className="playlists-error__retry-button"
						onClick={onRetry}
					>
						<RefreshCw size={16} />
						Try Again
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="user-playlists-view">
			<ViewHeader
				icon={<Youtube className="video-view-header__icon" />}
				title={UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
				actions={
					<button
						className="add-playlist-button"
						onClick={() => setShowAddForm(true)}
						disabled={isLoading || showAddForm}
						title="Add playlist by ID"
					>
						<Plus size={16} />
					</button>
				}
			/>

			{/* Add Playlist Form */}
			{showAddForm && (
				<AddPlaylistForm
					resetAddForm={resetAddForm}
					isAdding={isAdding}
					playlistIdInput={playlistIdInput}
					setPlaylistIdInput={setPlaylistIdInput}
					handleAddPlaylist={handleAddPlaylist}
					addError={addError}
				/>
			)}

			{playlists.length > 0 && (
				<div className="search-bar-container">
					<div className="search-bar-wrapper">
						<SearchBar
							searchTerm={searchTerm}
							onSearchTermChange={setSearchTerm}
						/>
					</div>
					<div className="video-count">
						<p style={{ margin: "0" }}>
							{UI_TEXT.VIDEO_COUNT_WITH_TOTAL(
								sortedAndFilteredPlaylists.length,
								playlists.length,
							)}
						</p>
					</div>
				</div>
			)}

			{/* Sort Controls */}
			{playlists.length > 0 && (
				<div className="video-view-sort">
					<div className="sort-controls">
						<label htmlFor="sort-playlist-select">Sort by:</label>
						<select
							id="sort-playlist-select"
							className="video-view-sort__select"
							value={sortOption}
							onChange={(e) =>
								handleSortOptionChange(e.target.value)
							}
						>
							<option value="title">Title</option>
							<option value="itemCount">Video Count</option>
							<option value="publishedAt">Time Created</option>
						</select>
						<button
							title={`Toggle sort order (${sortOrder === "ASC" ? "Ascending" : "Descending"})`}
							onClick={handleSortOrderToggle}
							className="video-view-sort__order"
						>
							{sortOrder === "ASC" ? (
								<ArrowDownWideNarrow size={16} />
							) : (
								<ArrowUpNarrowWide size={16} />
							)}
						</button>
					</div>
				</div>
			)}

			{playlists.length === 0 ? (
				<div className="no-playlists-found">
					<div className="no-playlists-found__icon">
						<Video size={48} />
					</div>
					<div className="no-playlists-found__title">
						No playlists found
					</div>
					<div className="no-playlists-found__text">
						Create playlists on YouTube to see them here.
					</div>
				</div>
			) : sortedAndFilteredPlaylists.length === 0 ? (
				<div className="no-playlists-found">
					<div className="no-playlists-found__icon">
						<Search size={48} />
					</div>
					<div className="no-playlists-found__title">
						No matching playlists
					</div>
					<div className="no-playlists-found__text">
						No playlists match "{searchTerm}". Try a different
						search term.
					</div>
					<button
						className="no-playlists-found__clear-button"
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
								isPinned={localStorageService.isPlaylistPinned(
									playlist.id,
								)}
							/>
						),
					)}
				</div>
			)}
		</div>
	);
};
