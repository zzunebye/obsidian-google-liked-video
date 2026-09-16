import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import type { YouTubeVideo } from "src/types";
import { formatVideoCount, formatVideoDuration } from "src/utils/videoUtils";

export function VideoInfoTooltip({ video }: { video: YouTubeVideo }) {
	const id = useId();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const closeTimer = useRef<number>();
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ left: 0, top: 0 });
	const ownerWindow = buttonRef.current?.ownerDocument.defaultView ?? window;
	const duration = formatVideoDuration(video.contentDetails?.duration);
	const publishedAt = new Date(video.snippet.publishedAt);
	const publishedDate = Number.isFinite(publishedAt.getTime())
		? publishedAt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
	const description = video.snippet.description?.trim().replace(/\s+/g, " ") ?? "";
	const descriptionPreview = description.length > 280 ? `${description.slice(0, 277).trimEnd()}…` : description;
	const statistics = [
		{ label: "Views", value: video.statistics?.viewCount },
		{ label: "Likes", value: video.statistics?.likeCount },
		{ label: "Comments", value: video.statistics?.commentCount },
	].filter(({ value }) => value !== undefined && value !== null);

	const show = (): void => {
		ownerWindow.clearTimeout(closeTimer.current);
		setIsOpen(true);
	};
	const scheduleClose = (): void => {
		ownerWindow.clearTimeout(closeTimer.current);
		// Allow the pointer to cross the gap between the icon and its portalled tooltip.
		closeTimer.current = ownerWindow.setTimeout(() => {
			if (!buttonRef.current?.matches(":hover, :focus-visible") && !tooltipRef.current?.matches(":hover")) {
				setIsOpen(false);
			}
		}, 150);
	};

	useEffect(() => () => ownerWindow.clearTimeout(closeTimer.current), [ownerWindow]);

	useEffect(() => {
		const button = buttonRef.current;
		const tooltip = tooltipRef.current;
		if (!isOpen || !button || !tooltip) return;
		const ownerDocument = button.ownerDocument;
		const dismissOutside = (event: PointerEvent): void => {
			const path = event.composedPath();
			if (!path.includes(button) && !path.includes(tooltip)) setIsOpen(false);
		};
		const dismissOnEscape = (event: KeyboardEvent): void => {
			if (event.key !== "Escape" || event.isComposing) return;
			// Consume Escape before the transcript reader handles it as Back.
			event.preventDefault();
			event.stopPropagation();
			setIsOpen(false);
		};
		ownerDocument.addEventListener("pointerdown", dismissOutside);
		ownerDocument.addEventListener("keydown", dismissOnEscape, true);
		return () => {
			ownerDocument.removeEventListener("pointerdown", dismissOutside);
			ownerDocument.removeEventListener("keydown", dismissOnEscape, true);
		};
	}, [isOpen]);

	useLayoutEffect(() => {
		const button = buttonRef.current;
		const tooltip = tooltipRef.current;
		if (!isOpen || !button || !tooltip) return;
		const updatePosition = (): void => {
			const anchor = button.getBoundingClientRect();
			const card = tooltip.getBoundingClientRect();
			const padding = 12;
			const gap = 6;
			const left = Math.max(padding, Math.min(anchor.right - card.width, ownerWindow.innerWidth - card.width - padding));
			const preferredTop = anchor.bottom + gap + card.height > ownerWindow.innerHeight - padding
				? anchor.top - card.height - gap : anchor.bottom + gap;
			const top = Math.max(padding, Math.min(preferredTop, ownerWindow.innerHeight - card.height - padding));
			setPosition({ left, top });
		};
		updatePosition();
		const observer = new ownerWindow.ResizeObserver(updatePosition);
		observer.observe(tooltip);
		if (button.parentElement) observer.observe(button.parentElement);
		ownerWindow.addEventListener("resize", updatePosition);
		ownerWindow.addEventListener("scroll", updatePosition, true);
		return () => {
			observer.disconnect();
			ownerWindow.removeEventListener("resize", updatePosition);
			ownerWindow.removeEventListener("scroll", updatePosition, true);
		};
	}, [isOpen, ownerWindow]);

	return <>
		<button ref={buttonRef} type="button" className="geulo-video-info__trigger" aria-label="Video information"
			aria-describedby={isOpen ? id : undefined}
			onMouseEnter={show} onMouseLeave={scheduleClose} onFocus={show} onBlur={scheduleClose} onClick={show}>
			<Info size={16} aria-hidden="true" />
		</button>
		{isOpen && buttonRef.current && createPortal(
			<div ref={tooltipRef} id={id} role="tooltip" className="geulo-video-info__tooltip" style={position}
				onMouseEnter={show} onMouseLeave={scheduleClose}>
				<strong className="geulo-video-info__channel">{video.snippet.channelTitle}</strong>
				{(publishedDate || duration) && <dl className="geulo-video-info__details">
					{publishedDate && <div><dt>Published</dt><dd>{publishedDate}</dd></div>}
					{duration && <div><dt>Duration</dt><dd>{duration}</dd></div>}
				</dl>}
				{statistics.length > 0 && <dl className="geulo-video-info__statistics">
					{statistics.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{formatVideoCount(value)}</dd></div>)}
				</dl>}
				{descriptionPreview && <p className="geulo-video-info__description">{descriptionPreview}</p>}
			</div>, buttonRef.current.ownerDocument.body,
		)}
	</>;
}
