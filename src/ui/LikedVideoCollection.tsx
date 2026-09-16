import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Range } from "@tanstack/react-virtual";
import type { LikedVideoPaginationMode, YouTubeVideo } from "src/types";
import type { SummarySnapshot } from "./SummarySection";

export interface SummaryCardState {
	readonly summaryExpanded: boolean;
	readonly onSummaryExpandedChange: (expanded: boolean) => void;
	readonly onSummaryBusyChange: (busy: boolean) => void;
	readonly summarySnapshot?: SummarySnapshot;
	readonly onSummarySnapshotChange: (snapshot: SummarySnapshot) => void;
}

interface Props {
	readonly label?: string;
	readonly getVideoKey?: (video: YouTubeVideo) => string;
	readonly videos: YouTubeVideo[];
	readonly mode: LikedVideoPaginationMode;
	readonly currentPage: number;
	readonly onPageChange: (page: number) => void;
	readonly resetKey: string;
	readonly noteExistenceMap: ReadonlyMap<string, boolean>;
	readonly renderVideo: (video: YouTubeVideo, noteExists: boolean, summary: SummaryCardState) => ReactNode;
}

export interface LikedVideoCollectionHandle {
	focusEntry: () => boolean;
}

const getDefaultVideoKey = (video: YouTubeVideo): string => video.id;

const GAP = 16;
const PAGE_SIZE = 10;
const INFINITE_BATCH_SIZE = 50;

export const LikedVideoCollection = forwardRef<LikedVideoCollectionHandle, Props>(function LikedVideoCollection(
	{ videos, mode, currentPage, onPageChange, resetKey, noteExistenceMap, renderVideo, label = "Liked videos", getVideoKey = getDefaultVideoKey }, ref,
) {
	const containerRef = useRef<HTMLDivElement>(null);
	const endRef = useRef<HTMLParagraphElement>(null);
	const [batch, setBatch] = useState({ key: resetKey, count: INFINITE_BATCH_SIZE });
	const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
	const [geometry, setGeometry] = useState({ width: 0, margin: 0 });
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [summaries, setSummaries] = useState<ReadonlyMap<string, SummarySnapshot>>(new Map());
	const [busyVideos, setBusyVideos] = useState<ReadonlyMap<string, YouTubeVideo>>(new Map());
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const pendingFocus = useRef<{ id: string; key: string } | null>(null);
	const lastFocusedId = useRef<string | null>(null);
	const heights = useRef(new Map<string, number>());
	const scrollAnchor = useRef<{ id: string; offset: number; key: string } | null>(null);
	const previousPage = useRef(currentPage);
	const columns = 1;
	const infinite = mode === "infinite";
	const exposedCount = Math.min(videos.length, batch.key === resetKey ? batch.count : INFINITE_BATCH_SIZE);
	const rowCount = Math.ceil(exposedCount / columns);
	const getItemKey = useCallback((index: number) =>
		videos.slice(index * columns, (index + 1) * columns).map(video => getVideoKey(video)).join("/"), [videos, columns, getVideoKey]);
	const rangeExtractor = useCallback((range: Range) => {
		const rows = new Set(defaultRangeExtractor(range));
		videos.forEach((video, index) => {
			if (index < exposedCount && (busyVideos.has(getVideoKey(video)) || getVideoKey(video) === focusedId)) rows.add(Math.floor(index / columns));
		});
		return [...rows].sort((a, b) => a - b);
	}, [videos, busyVideos, focusedId, columns, exposedCount, getVideoKey]);
	const virtualizer = useVirtualizer({
		count: rowCount,
		getScrollElement: () => scrollElement,
		estimateSize: () => 240,
		getItemKey,
		rangeExtractor,
		overscan: 3,
		gap: GAP,
		scrollMargin: geometry.margin,
		enabled: infinite,
	});
	// A reset writes scrollTop before the virtualizer receives the scroll event.
	// Only compensate measurements above the actual viewport, never its stale offset.
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = item =>
		item.end <= (scrollElement?.scrollTop ?? 0) && virtualizer.scrollDirection !== "backward";

	useImperativeHandle(ref, () => ({
		focusEntry: () => {
			const start = infinite ? 0 : (currentPage - 1) * PAGE_SIZE;
			const end = infinite ? videos.length : Math.min(start + PAGE_SIZE, videos.length);
			if (start >= end) return false;
			const previous = videos.findIndex(video => getVideoKey(video) === lastFocusedId.current);
			const wrappers = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-video-index]") ?? []);
			const viewport = scrollElement?.getBoundingClientRect();
			const visible = wrappers.find(element => {
				const rect = element.getBoundingClientRect();
				return viewport && rect.bottom > viewport.top && rect.top < viewport.bottom;
			});
			const index = previous >= start && previous < end ? previous : Number(visible?.dataset.videoIndex ?? start);
			const id = getVideoKey(videos[index]);
			const card = wrappers.find(element => element.dataset.videoKey === id)?.querySelector<HTMLElement>(".video-card__container");
			if (card) {
				card.focus({ preventScroll: true });
				card.scrollIntoView({ block: "nearest", inline: "nearest" });
			} else {
				pendingFocus.current = { id, key: resetKey };
				setFocusedId(id);
				if (infinite && index >= exposedCount) setBatch({ key: resetKey, count: index + 1 });
			}
			return true;
		},
	}));

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing ||
			(event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
		const ownerWindow = event.currentTarget.ownerDocument.defaultView;
		const target = event.target;
		if (!ownerWindow || !(target instanceof ownerWindow.HTMLElement) || target.isContentEditable ||
			target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="menu"], [role="listbox"]')) return;
		const card = target.closest<HTMLElement>("[data-video-id]");
		if (!card || !event.currentTarget.contains(card)) return;
		if (!target.matches(".video-card__container")) return;
		const index = videos.findIndex(video => getVideoKey(video) === (pendingFocus.current?.id ?? card.dataset.videoKey));
		if (index < 0) return;
		event.preventDefault();
		event.stopPropagation();
		const nextIndex = Math.max(0, Math.min(videos.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
		if (nextIndex === index) return;
		const id = getVideoKey(videos[nextIndex]);
		pendingFocus.current = { id, key: resetKey };
		setFocusedId(id);
		if (infinite && nextIndex >= exposedCount) {
			setBatch({ key: resetKey, count: Math.min(nextIndex + INFINITE_BATCH_SIZE, videos.length) });
		} else if (!infinite) {
			const page = Math.floor(nextIndex / PAGE_SIZE) + 1;
			if (page !== currentPage) onPageChange(page);
		}
	};

	useLayoutEffect(() => {
		const container = containerRef.current;
		const scroller = container?.closest<HTMLElement>(".view-content");
		const ownerWindow = container?.ownerDocument.defaultView;
		if (!container || !scroller || !ownerWindow) return;
		setScrollElement(scroller);
		const update = () => {
			const width = container.clientWidth;
			const margin = container.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop;
			setGeometry(previous => previous.width === width && previous.margin === margin ? previous : { width, margin });
		};
		const observer = new ownerWindow.ResizeObserver(update);
		observer.observe(scroller);
		observer.observe(container);
		if (container.parentElement) observer.observe(container.parentElement);
		const clearOutsideFocus = (event: FocusEvent) => {
			if (event.target instanceof ownerWindow.Node && !container.contains(event.target)) setFocusedId(null);
		};
		container.ownerDocument.addEventListener("focusin", clearOutsideFocus);
		update();
		return () => {
			observer.disconnect();
			container.ownerDocument.removeEventListener("focusin", clearOutsideFocus);
		};
	}, []);

	useLayoutEffect(() => {
		setBatch(previous => previous.key === resetKey ? previous : { key: resetKey, count: INFINITE_BATCH_SIZE });
		if (infinite) virtualizer.scrollToOffset(0);
		else scrollElement?.scrollTo({ top: 0, behavior: "auto" });
		setFocusedId(null);
		pendingFocus.current = null;
		lastFocusedId.current = null;
		previousPage.current = 1;
	}, [resetKey, scrollElement, infinite, virtualizer]);

	useLayoutEffect(() => {
		const anchor = scrollAnchor.current;
		const ownerWindow = containerRef.current?.ownerDocument.defaultView;
		if (infinite && anchor?.key === resetKey && scrollElement && ownerWindow) {
			const index = videos.findIndex((video) => getVideoKey(video) === anchor.id);
			if (index >= 0) {
				virtualizer.scrollToIndex(Math.floor(index / columns), { align: "start" });
				ownerWindow.requestAnimationFrame(() => {
					const element = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-video-id]") ?? [])
						.find((card) => card.dataset.videoKey === anchor.id);
					if (!element || !scrollElement) return;
					const currentOffset = element.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
					scrollElement.scrollTop += currentOffset - anchor.offset;
				});
			}
		}
		scrollAnchor.current = null;

		return () => {
			if (!infinite || !scrollElement) return;
			const scrollerTop = scrollElement.getBoundingClientRect().top;
			const cards = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-video-id]") ?? [])
				.filter((card) => card.getBoundingClientRect().bottom > scrollerTop)
				.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
			const firstCard = cards[0];
			if (firstCard?.dataset.videoKey) {
				scrollAnchor.current = {
					id: firstCard.dataset.videoKey,
					offset: firstCard.getBoundingClientRect().top - scrollerTop,
					key: resetKey,
				};
			}
		};
	}, [videos, resetKey, infinite, scrollElement, columns, virtualizer, getVideoKey]);

	useLayoutEffect(() => {
		if (infinite || previousPage.current === currentPage || !scrollElement) return;
		previousPage.current = currentPage;
		scrollElement.scrollTo({ top: 0, behavior: "auto" });
		if (!pendingFocus.current) {
			containerRef.current?.querySelector<HTMLElement>(".video-card__container")?.focus();
		}
	}, [currentPage, infinite, scrollElement]);

	useEffect(() => {
		const end = endRef.current;
		const ownerWindow = end?.ownerDocument.defaultView;
		if (!infinite || !scrollElement || !end || !ownerWindow || exposedCount >= videos.length) return;
		const observer = new ownerWindow.IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) {
				setBatch({ key: resetKey, count: Math.min(exposedCount + INFINITE_BATCH_SIZE, videos.length) });
			}
		}, { root: scrollElement, rootMargin: "0px 0px 600px 0px" });
		observer.observe(end);
		return () => observer.disconnect();
	}, [infinite, scrollElement, resetKey, exposedCount, videos.length]);

	const virtualRows = virtualizer.getVirtualItems();
	const placements = new Map<number, number>();
	if (infinite) {
		for (const row of virtualRows) {
			for (let column = 0; column < columns; column++) {
				const index = row.index * columns + column;
				if (index < exposedCount) placements.set(index, row.start - geometry.margin);
			}
		}
	} else {
		const start = (currentPage - 1) * PAGE_SIZE;
		for (let index = start; index < Math.min(start + PAGE_SIZE, videos.length); index++) placements.set(index, 0);
	}
	const visibleVideos = [...placements.keys()].map(index => videos[index]);
	const mountedVideos = [...visibleVideos, ...[...busyVideos.values()].filter(video => !visibleVideos.some(item => getVideoKey(item) === getVideoKey(video)))];
	const placementKey = [...placements.keys()].join(",");

	useLayoutEffect(() => {
		const container = containerRef.current;
		const ownerWindow = container?.ownerDocument.defaultView;
		if (!infinite || !container || !ownerWindow) return;
		// Keep offscreen height estimates on resize; only remeasure mounted cards.
		const measure = () => {
			const rows = new Set<number>();
			container.querySelectorAll<HTMLElement>("[data-video-index]").forEach(element => {
				const index = Number(element.dataset.videoIndex);
				const video = videos[index];
				if (!video) return;
				heights.current.set(getVideoKey(video), element.getBoundingClientRect().height);
				rows.add(Math.floor(index / columns));
			});
			rows.forEach(row => {
				const size = Math.max(...videos.slice(row * columns, Math.min((row + 1) * columns, exposedCount)).map(video => heights.current.get(getVideoKey(video)) ?? 240));
				virtualizer.resizeItem(row, size);
			});
		};
		const observer = new ownerWindow.ResizeObserver(measure);
		container.querySelectorAll<HTMLElement>("[data-video-index]").forEach(element => observer.observe(element));
		measure();
		return () => observer.disconnect();
	}, [infinite, videos, columns, geometry.width, virtualizer, placementKey, exposedCount, getVideoKey]);

	useLayoutEffect(() => {
		const pending = pendingFocus.current;
		if (!pending || pending.key !== resetKey) return;
		const wrapper = Array.from(containerRef.current?.querySelectorAll<HTMLElement>("[data-video-id]") ?? [])
			.find(element => element.dataset.videoKey === pending.id);
		const card = wrapper?.querySelector<HTMLElement>(".video-card__container");
		if (!card) return;
		pendingFocus.current = null;
		card.focus({ preventScroll: true });
		card.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
	}, [focusedId, placementKey, currentPage, resetKey, videos, getVideoKey]);

	return (
		<>
		<div ref={containerRef} role="list" aria-label={`${label}, ${videos.length} results`}
			onKeyDown={handleKeyDown} aria-keyshortcuts="ArrowUp ArrowDown"
			className={`video-view__video-grid ${infinite ? "liked-video-virtual-grid" : ""}`}
			style={infinite ? { height: virtualizer.getTotalSize() } : undefined}>
			{mountedVideos.map(video => {
				const index = videos.indexOf(video);
				const shown = placements.has(index);
				return (
					<div key={getVideoKey(video)} role="listitem" aria-setsize={videos.length} aria-posinset={shown ? index + 1 : undefined}
							tabIndex={-1}
						aria-hidden={shown ? undefined : true} data-video-id={video.id} data-video-key={getVideoKey(video)} data-video-index={shown ? index : undefined}
						className={infinite || !shown ? "liked-video-virtual-card" : "liked-video-page-card"}
						style={infinite || !shown ? {
							width: `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`,
							left: shown ? `calc(${index % columns} * ((100% + ${GAP}px) / ${columns}))` : 0,
							top: shown ? placements.get(index) : 0,
							visibility: shown ? undefined : "hidden",
							height: shown ? undefined : 0,
							overflow: shown ? undefined : "hidden",
						} : undefined}
						onFocusCapture={() => { lastFocusedId.current = getVideoKey(video); setFocusedId(getVideoKey(video)); }}
						onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null); }}>
						{renderVideo(video, noteExistenceMap.get(video.id) ?? false, {
							summarySnapshot: summaries.get(getVideoKey(video)),
							onSummarySnapshotChange: snapshot => setSummaries(previous => new Map(previous).set(getVideoKey(video), snapshot)),
							summaryExpanded: expanded.has(getVideoKey(video)),
							onSummaryExpandedChange: value => setExpanded(previous => {
								const next = new Set(previous);
								if (value) next.add(getVideoKey(video)); else next.delete(getVideoKey(video));
								return next;
							}),
							onSummaryBusyChange: value => setBusyVideos(previous => {
								if (previous.has(getVideoKey(video)) === value) return previous;
								const next = new Map(previous);
								if (value) next.set(getVideoKey(video), video); else next.delete(getVideoKey(video));
								return next;
							}),
						})}
					</div>
				);
			})}
		</div>
		{infinite && videos.length > 0 && (
			<p ref={endRef} className="liked-video-list-end">
				{exposedCount < videos.length
					? `${exposedCount} of ${videos.length} videos`
					: `End of ${videos.length} ${videos.length === 1 ? "video" : "videos"}`}
			</p>
		)}
		</>
	);
});
