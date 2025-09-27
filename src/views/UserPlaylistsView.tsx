import { useState, useMemo, useEffect, useRef } from 'react';
import { PlaylistInfo } from 'src/api';
import { List, Search, Play, Loader2, AlertCircle, RefreshCw, Video, Plus, Youtube, Pin } from 'lucide-react';
import { UI_TEXT } from 'src/constants/uiText';
import { SearchBar } from 'src/ui/SearchBar';
import { localStorageService } from 'src/storage';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';

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
    onAddPlaylist
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [playlistIdInput, setPlaylistIdInput] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    // Component mount state for cleanup
    const isMountedRef = useRef(true);

    // Sort state
    const [sortOption, setSortOption] = useState(() => localStorageService.getPlaylistsSortOption());
    const [sortOrder, setSortOrder] = useState(() => localStorageService.getPlaylistsSortOrder());

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
        const filtered = playlists.filter(playlist =>
            playlist.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            playlist.description.toLowerCase().includes(searchTerm.toLowerCase())
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
                case 'title':
                    comparison = a.title.localeCompare(b.title);
                    break;
                case 'itemCount':
                    comparison = a.itemCount - b.itemCount;
                    break;

                case 'publishedAt':
                    comparison = a.publishedAt?.localeCompare(b.publishedAt || '') || 0;
                    break;
                default:
                    comparison = a.title.localeCompare(b.title);
            }

            return sortOrder === 'ASC' ? comparison : -comparison;
        });

        return sorted;
    }, [playlists, searchTerm, sortOption, sortOrder, forceUpdateFlag]);

    // Handle sort option changes
    const handleSortOptionChange = (newSortOption: string) => {
        setSortOption(newSortOption);
        localStorageService.setPlaylistsSortOption(newSortOption);
    };

    const handleSortOrderToggle = () => {
        const newSortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
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
        setForceUpdateFlag(prev => prev + 1);
    };

    const handleAddPlaylist = async () => {
        if (!playlistIdInput.trim()) {
            setAddError('Please enter a playlist ID or URL');
            return;
        }

        setIsAdding(true);
        setAddError(null);

        try {
            const success = await onAddPlaylist(playlistIdInput.trim());

            // Check if component is still mounted before updating state
            if (!isMountedRef.current) return;

            if (success) {
                setPlaylistIdInput('');
                setShowAddForm(false);
                setAddError(null);
            } else {
                setAddError('Playlist already exists in your saved playlists');
            }
        } catch (error) {
            // Check if component is still mounted before updating state
            if (!isMountedRef.current) return;
            setAddError(error.message || 'Failed to add playlist');
        } finally {
            // Check if component is still mounted before updating state
            if (isMountedRef.current) {
                setIsAdding(false);
            }
        }
    };

    const resetAddForm = () => {
        setShowAddForm(false);
        setPlaylistIdInput('');
        setAddError(null);
        setIsAdding(false);
    };

    // Loading State
    if (isLoading) {
        return (
            <div className="user-playlists-view">
                <div className="video-view-header">
                    <div className="video-view-header__title">
                        <List className="video-view-header__icon" />
                        My Playlists
                    </div>
                </div>

                <div className="playlists-loading">
                    <div className="playlists-loading__spinner">
                        <Loader2 size={32} className="animate-spin" />
                    </div>
                    <div className="playlists-loading__text">
                        Loading your playlists...
                    </div>
                </div>
            </div>
        );
    }

    // Error State
    if (error) {
        return (
            <div className="user-playlists-view">
                <div className="video-view-header">
                    <div className="video-view-header__title">
                        <List className="video-view-header__icon" />
                        My Playlists
                    </div>
                </div>

                <div className="playlists-error">
                    <div className="playlists-error__icon">
                        <AlertCircle size={48} />
                    </div>
                    <div className="playlists-error__title">
                        Failed to load playlists
                    </div>
                    <div className="playlists-error__message">
                        {error}
                    </div>
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
            <div className="video-view-header">
                <div className="video-view-header__title">
                    <Youtube className="video-view-header__icon" /> {UI_TEXT.HEADER_TITLE_USER_PLAYLISTS}
                </div>
                <div className="video-view-header__actions">
                    <button
                        className="add-playlist-button"
                        onClick={() => setShowAddForm(true)}
                        disabled={isLoading || showAddForm}
                        title="Add playlist by ID"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>

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
                        <p style={{ margin: '0' }}>{UI_TEXT.VIDEO_COUNT_WITH_TOTAL(sortedAndFilteredPlaylists.length, playlists.length)}</p>
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
                            onChange={(e) => handleSortOptionChange(e.target.value)}
                        >
                            <option value="title">Title</option>
                            <option value="itemCount">Video Count</option>
                            <option value="publishedAt">Time Created</option>
                        </select>
                        <button
                            title={`Toggle sort order (${sortOrder === 'ASC' ? 'Ascending' : 'Descending'})`}
                            onClick={handleSortOrderToggle}
                            className="video-view-sort__order"
                        >
                            {sortOrder === 'ASC' ? <ArrowDownWideNarrow size={16} /> : <ArrowUpNarrowWide size={16} />}
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
                        No playlists match "{searchTerm}". Try a different search term.
                    </div>
                    <button
                        className="no-playlists-found__clear-button"
                        onClick={() => setSearchTerm('')}
                    >
                        Clear search
                    </button>
                </div>
            ) : (
                <div className="playlists-grid">
                    {sortedAndFilteredPlaylists.map((playlist: PlaylistInfo) => (
                        <PlaylistCard
                            key={playlist.id}
                            playlist={playlist}
                            onPlaylistSelect={onPlaylistSelect}
                            onTogglePin={handleTogglePin}
                            isPinned={localStorageService.isPlaylistPinned(playlist.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

interface PlaylistCardProps {
    playlist: PlaylistInfo;
    onPlaylistSelect: (playlist: PlaylistInfo) => void;
    onTogglePin: (playlistId: string) => void;
    isPinned: boolean;
}

const PlaylistCard = ({ playlist, onPlaylistSelect, onTogglePin, isPinned }: PlaylistCardProps) => {
    const formatItemCount = (count: number): string => {
        if (count === 0) return 'Empty';
        if (count === 1) return '1 video';
        return `${count} videos`;
    };

    const handlePinClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent triggering playlist selection
        onTogglePin(playlist.id);
    };

    return (
        <div
            key={playlist.id}
            className={`playlist-card ${isPinned ? 'playlist-card--pinned' : ''}`}
            onClick={() => onPlaylistSelect(playlist)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPlaylistSelect(playlist);
                }
            }}
        >
            {/* Pin button */}
            <button
                className={`playlist-card__pin-button ${isPinned ? 'playlist-card__pin-button--pinned' : 'playlist-card__pin-button--hover'}`}
                onClick={handlePinClick}
                title={isPinned ? 'Unpin playlist' : 'Pin playlist'}
                aria-label={isPinned ? 'Unpin playlist' : 'Pin playlist'}
            >
                <Pin size={24} className={isPinned ? 'playlist-card__pin-icon--pinned' : ''} />
            </button>

            <div className="playlist-card__thumbnail">
                {playlist.thumbnailUrl ? (
                    <img
                        src={playlist.thumbnailUrl}
                        alt={`${playlist.title} thumbnail`}
                        className="playlist-card__thumbnail-img playlist-card__thumbnail-img--fixed"
                        loading="lazy"
                    />
                ) : (
                    <div className="playlist-card__thumbnail-placeholder playlist-card__thumbnail-placeholder--fixed">
                        <Play size={32} />
                    </div>
                )}
                <div className="playlist-card__video-count">
                    <Video size={12} />
                    {playlist.itemCount}
                </div>
            </div>

            <div className="playlist-card__content">
                <h3 className="playlist-card__title" title={playlist.title}>
                    {playlist.title}
                </h3>

                {playlist.description && (
                    <p className="playlist-card__description" title={playlist.description}>
                        {playlist.description}
                    </p>
                )}

                <div className="playlist-card__meta">
                    <span className="playlist-card__item-count">
                        {formatItemCount(playlist.itemCount)}
                    </span>

                </div>
            </div>

            <div className="playlist-card__hover-overlay">
                <div className="playlist-card__hover-text">
                    Click to view videos
                </div>
            </div>
        </div>
    );
};

interface AddPlaylistFormProps {
    resetAddForm: () => void;
    isAdding: boolean;
    playlistIdInput: string;
    setPlaylistIdInput: (value: string) => void;
    handleAddPlaylist: () => void;
    addError: string | null;
}

const AddPlaylistForm = ({ resetAddForm, isAdding, playlistIdInput, setPlaylistIdInput, handleAddPlaylist, addError }: AddPlaylistFormProps) => {
    return (
        <div className="add-playlist-form">
            <div className="add-playlist-form__header">
                <label>Add Playlist by ID</label>
            </div>

            <div className="add-playlist-form__content">
                <div className="add-playlist-form__input-group">
                    <label htmlFor="playlist-id-input">
                        Playlist ID or URL:
                    </label>
                    <div className="add-playlist-form__input-wrapper">
                        <input
                            id="playlist-id-input"
                            type="text"
                            className="add-playlist-form__input"
                            placeholder="PLDDTZzm0d6OE3op3... or full YouTube URL"
                            value={playlistIdInput}
                            onChange={(e) => setPlaylistIdInput(e.target.value)}
                            disabled={isAdding}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddPlaylist();
                                }
                                if (e.key === 'Escape') {
                                    resetAddForm();
                                }
                            }}
                        />

                    </div>
                </div>

                {addError && (
                    <div className="add-playlist-form__error">
                        <AlertCircle size={16} />
                        {addError}
                    </div>
                )}

                <div className="add-playlist-form__actions">
                    <button
                        className="add-playlist-form__submit"
                        onClick={handleAddPlaylist}
                        disabled={isAdding || !playlistIdInput.trim()}
                    >
                        {isAdding ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Adding...
                            </>
                        ) : (
                            <>
                                <Plus size={16} />
                                Add Playlist
                            </>
                        )}
                    </button>
                    <button
                        className="add-playlist-form__cancel"
                        onClick={resetAddForm}
                        disabled={isAdding}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

