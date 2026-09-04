import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

const MAX_CARD_TAGS = 3;
const TAG_GAP_PX = 4;

interface ResponsiveVideoTagsProps {
	tags: string[];
	onTagClick: (tag: string) => void;
}

interface VideoTagChipsProps {
	tags: string[];
}

const getDisplayTags = (tags: string[]): string[] =>
	tags.filter((tag) => tag.trim().length > 0);

export const ResponsiveVideoTags = ({
	tags,
	onTagClick,
}: ResponsiveVideoTagsProps) => {
	const displayTags = useMemo(() => getDisplayTags(tags), [tags]);
	const cardTags = useMemo(
		() => displayTags.slice(0, MAX_CARD_TAGS),
		[displayTags],
	);
	const [visibleCount, setVisibleCount] = useState(cardTags.length);
	const [isPopoverOpen, setIsPopoverOpen] = useState(false);
	const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0 });
	const containerRef = useRef<HTMLDivElement>(null);
	const measurementRef = useRef<HTMLDivElement>(null);
	const overflowButtonRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const visibleTags = displayTags.slice(0, visibleCount);
	const hiddenTags = displayTags.slice(visibleCount);

	const recalculateVisibleCount = useCallback(() => {
		const container = containerRef.current;
		const measurement = measurementRef.current;
		if (!container || !measurement) return;

		const tagWidths = Array.from(
			measurement.querySelectorAll<HTMLElement>("[data-tag-measure]"),
		).map((element) => element.getBoundingClientRect().width);
		const availableWidth = container.getBoundingClientRect().width;
		let nextVisibleCount = cardTags.length;

		while (nextVisibleCount > 0) {
			const hiddenCount = displayTags.length - nextVisibleCount;
			const overflowMeasure = measurement.querySelector<HTMLElement>(
				`[data-overflow-measure="${hiddenCount}"]`,
			);
			const visibleWidth = tagWidths
				.slice(0, nextVisibleCount)
				.reduce((sum, width) => sum + width, 0);
			const itemCount = nextVisibleCount + (hiddenCount > 0 ? 1 : 0);
			const requiredWidth =
				visibleWidth +
				(hiddenCount > 0
					? (overflowMeasure?.getBoundingClientRect().width ?? 0)
					: 0) +
				Math.max(0, itemCount - 1) * TAG_GAP_PX;

			if (requiredWidth <= availableWidth) break;
			nextVisibleCount -= 1;
		}

		setVisibleCount((current) =>
			current === nextVisibleCount ? current : nextVisibleCount,
		);
	}, [cardTags, displayTags]);

	useLayoutEffect(() => {
		setVisibleCount(cardTags.length);
		recalculateVisibleCount();
	}, [cardTags.length, recalculateVisibleCount]);

	useEffect(() => {
		const container = containerRef.current;
		const measurement = measurementRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver(recalculateVisibleCount);
		observer.observe(container);
		if (measurement) observer.observe(measurement);

		return () => observer.disconnect();
	}, [recalculateVisibleCount]);

	useEffect(() => {
		if (!isPopoverOpen) return;
		const ownerDocument = containerRef.current?.ownerDocument ?? document;

		const handlePointerDown = (event: PointerEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node) &&
				!popoverRef.current?.contains(event.target as Node)
			) {
				setIsPopoverOpen(false);
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsPopoverOpen(false);
				overflowButtonRef.current?.focus();
			}
		};

		ownerDocument.addEventListener("pointerdown", handlePointerDown);
		ownerDocument.addEventListener("keydown", handleKeyDown);
		return () => {
			ownerDocument.removeEventListener("pointerdown", handlePointerDown);
			ownerDocument.removeEventListener("keydown", handleKeyDown);
		};
	}, [isPopoverOpen]);

	useLayoutEffect(() => {
		if (!isPopoverOpen || !overflowButtonRef.current) return;

		const ownerWindow =
			overflowButtonRef.current.ownerDocument.defaultView ?? window;
		const updatePopoverPosition = () => {
			const buttonRect = overflowButtonRef.current?.getBoundingClientRect();
			const popoverRect = popoverRef.current?.getBoundingClientRect();
			if (!buttonRect || !popoverRect) return;

			const viewportPadding = 12;
			const gap = 6;
			const maxLeft = Math.max(
				viewportPadding,
				ownerWindow.innerWidth - popoverRect.width - viewportPadding,
			);
			const left = Math.min(
				Math.max(buttonRect.left, viewportPadding),
				maxLeft,
			);
			const spaceBelow =
				ownerWindow.innerHeight - buttonRect.bottom - viewportPadding;
			const canOpenAbove =
				buttonRect.top - viewportPadding >= popoverRect.height + gap;
			const top =
				spaceBelow < popoverRect.height && canOpenAbove
					? buttonRect.top - popoverRect.height - gap
					: buttonRect.bottom + gap;

			setPopoverPosition({ left, top });
		};

		updatePopoverPosition();
		popoverRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
		ownerWindow.addEventListener("resize", updatePopoverPosition);
		ownerWindow.addEventListener("scroll", updatePopoverPosition, true);
		return () => {
			ownerWindow.removeEventListener("resize", updatePopoverPosition);
			ownerWindow.removeEventListener("scroll", updatePopoverPosition, true);
		};
	}, [isPopoverOpen, hiddenTags.length]);

	useEffect(() => {
		if (displayTags.length - visibleCount === 0) {
			setIsPopoverOpen(false);
		}
	}, [displayTags.length, visibleCount]);

	if (displayTags.length === 0) return null;

	const overflowCounts = Array.from(
		{ length: cardTags.length + 1 },
		(_, index) => displayTags.length - index,
	).filter((count) => count > 0);

	const handleTagClick = (
		event: React.MouseEvent<HTMLButtonElement>,
		tag: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		setIsPopoverOpen(false);
		onTagClick(tag);
	};

	return (
		<div className="video-tags" ref={containerRef}>
			<div className="video-tags__row" aria-label="Video tags">
				{visibleTags.map((tag, index) => (
					<button
						key={`${tag}-${index}`}
						type="button"
						className="video-tag-chip video-tag-chip--interactive"
						title={tag}
						draggable={false}
						onDragStart={(event) => event.stopPropagation()}
						onClick={(event) => handleTagClick(event, tag)}
					>
						{tag}
					</button>
				))}
				{hiddenTags.length > 0 && (
					<button
						ref={overflowButtonRef}
						type="button"
						className="video-tag-chip video-tag-chip--overflow"
						aria-label={`Show ${hiddenTags.length} more video tags`}
						aria-expanded={isPopoverOpen}
						aria-haspopup="dialog"
						draggable={false}
						onDragStart={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							setIsPopoverOpen((current) => !current);
						}}
					>
						+{hiddenTags.length}
					</button>
				)}
			</div>

			{isPopoverOpen &&
				hiddenTags.length > 0 &&
				createPortal(
					<div
						ref={popoverRef}
						className="video-tags__popover"
						role="dialog"
						aria-label="More video tags"
						style={popoverPosition}
						onClick={(event) => event.stopPropagation()}
					>
						{hiddenTags.map((tag, index) => (
							<button
								key={`${tag}-${index}`}
								type="button"
								className="video-tag-chip video-tag-chip--interactive"
								title={tag}
								onClick={(event) => handleTagClick(event, tag)}
							>
								{tag}
							</button>
						))}
					</div>,
					containerRef.current?.ownerDocument.body ?? document.body,
				)}

			<div className="video-tags__measurement" ref={measurementRef}>
				{cardTags.map((tag, index) => (
					<span
						key={`${tag}-${index}`}
						className="video-tag-chip"
						data-tag-measure
					>
						{tag}
					</span>
				))}
				{overflowCounts.map((count) => (
					<span
						key={count}
						className="video-tag-chip video-tag-chip--overflow"
						data-overflow-measure={count}
					>
						+{count}
					</span>
				))}
			</div>
		</div>
	);
};

export const VideoTagChips = ({ tags }: VideoTagChipsProps) => {
	const displayTags = getDisplayTags(tags);
	if (displayTags.length === 0) return null;

	return (
		<div className="video-tag-list" aria-label="Video tags">
			{displayTags.map((tag, index) => (
				<span
					key={`${tag}-${index}`}
					className="video-tag-chip video-tag-chip--static"
					title={tag}
				>
					{tag}
				</span>
			))}
		</div>
	);
};
