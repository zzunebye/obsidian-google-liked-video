import { Pin, Play, Video } from "lucide-react";
import { PlaylistInfo } from "src/types";

interface PlaylistCardProps {
	playlist: PlaylistInfo;
	onPlaylistSelect: (playlist: PlaylistInfo) => void;
	onTogglePin: (playlistId: string) => void;
	isPinned: boolean;
}

export const PlaylistCard = ({
	playlist,
	onPlaylistSelect,
	onTogglePin,
	isPinned,
}: PlaylistCardProps) => {
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

	return (
		<div
			key={playlist.id}
			className={`playlist-card ${isPinned ? "playlist-card--pinned" : ""}`}
			onClick={() => onPlaylistSelect(playlist)}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onPlaylistSelect(playlist);
				}
			}}
		>
			{/* Pin button */}
			<button
				className={`playlist-card__pin-button ${isPinned ? "playlist-card__pin-button--pinned" : "playlist-card__pin-button--hover"}`}
				onClick={handlePinClick}
				title={isPinned ? "Unpin playlist" : "Pin playlist"}
				aria-label={isPinned ? "Unpin playlist" : "Pin playlist"}
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

				{playlist.description && (
					<p
						className="playlist-card__description"
						title={playlist.description}
					>
						{playlist.description}
					</p>
				)}

				<div className="playlist-card__meta">
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
