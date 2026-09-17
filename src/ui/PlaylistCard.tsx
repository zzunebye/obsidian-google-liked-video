import { Menu } from "obsidian";
import { AlertCircle, Calendar, Pin, Play, Video } from "lucide-react";
import { PlaylistInfo } from "src/types";

interface PlaylistCardProps {
	playlist: PlaylistInfo;
	onPlaylistSelect: (playlist: PlaylistInfo) => void;
	onTogglePin: (playlistId: string) => void;
	onDeletePlaylist?: (playlist: PlaylistInfo) => Promise<void>;
	onRemovePlaylist?: (playlist: PlaylistInfo) => void;
	isPinned: boolean;
}

export const PlaylistCard = ({
	playlist,
	onPlaylistSelect,
	onTogglePin,
	onDeletePlaylist,
	onRemovePlaylist,
	isPinned,
}: PlaylistCardProps) => {
	const sourceLabel = playlist.isOwnedByUser === true
		? "Your playlist"
		: playlist.isOwnedByUser === false ? "Imported" : null;
	const playlistAction = playlist.isOwnedByUser === true
		? onDeletePlaylist
		: playlist.isOwnedByUser === false ? onRemovePlaylist : undefined;
	const isUnavailable = playlist.isOwnedByUser === false && playlist.isUnavailable === true;

	const formatItemCount = (count: number): string => {
		if (count === 0) return "Empty";
		if (count === 1) return "1 video";
		return `${count} videos`;
	};

	const formatDate = (dateString: string): string => {
		const date = new Date(dateString);
		return date.toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	};

	const handlePinClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation(); // Prevent triggering playlist selection
		onTogglePin(playlist.id);
	};

	const createPlaylistMenu = (): Menu => {
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle(playlist.isOwnedByUser === true ? "Delete from YouTube" : "Remove from Geulo");
			item.setIcon(playlist.isOwnedByUser === true ? "trash-2" : "list-minus");
			item.onClick(() => {
				if (playlistAction) void playlistAction(playlist);
			});
		});
		return menu;
	};

	return (
		<div
			key={playlist.id}
			className={`playlist-card ${isPinned ? "playlist-card--pinned" : ""}`}
			onClick={() => onPlaylistSelect(playlist)}
			onContextMenu={(event) => {
				if (!playlistAction) return;
				event.preventDefault();
				event.stopPropagation();
				createPlaylistMenu().showAtMouseEvent(event.nativeEvent);
			}}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget || e.defaultPrevented || e.nativeEvent.isComposing) return;
				if (
					playlistAction &&
					(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
				) {
					e.preventDefault();
					const rect = e.currentTarget.getBoundingClientRect();
					createPlaylistMenu().showAtPosition({
						x: rect.left + 24,
						y: rect.top + 24,
					});
					return;
				}

				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onPlaylistSelect(playlist);
				}
			}}
		>
			{/* Pin button */}
			<button
				type="button"
				className={`playlist-card__pin-button ${isPinned ? "playlist-card__pin-button--pinned" : "playlist-card__pin-button--hover"}`}
				onClick={handlePinClick}
				title={isPinned ? "Unpin playlist" : "Pin playlist"}
				aria-label={isPinned ? "Unpin playlist" : "Pin playlist"}
				aria-pressed={isPinned}
			>
				<Pin
					size={24}
					className={
						isPinned ? "playlist-card__pin-icon--pinned" : ""
					}
				/>
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

				{isUnavailable && (
					<div className="playlist-card__availability">
						<AlertCircle size={14} aria-hidden="true" />
						<span>Unavailable on YouTube · Showing saved details</span>
					</div>
				)}

				{playlist.description && (
					<p
						className="playlist-card__description"
						title={playlist.description}
					>
						{playlist.description}
					</p>
				)}

				<div className="playlist-card__meta">
					{sourceLabel && (
						<span className="playlist-card__source">{sourceLabel}</span>
					)}
					<span className="playlist-card__item-count">
						{formatItemCount(playlist.itemCount)}
					</span>
					{playlist.publishedAt && (
						<span className="playlist-card__created-at">
							<Calendar size={12} />
							{formatDate(playlist.publishedAt)}
						</span>
					)}
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
