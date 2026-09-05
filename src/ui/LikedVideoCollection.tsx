import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Range } from "@tanstack/react-virtual";
import type { LikedVideoDisplayMode, YouTubeVideo } from "src/types";
import { useNoteExistenceMap } from "src/hooks/useNoteExistence";
import { usePlugin } from "src/store/pluginContext";
import type { SummarySnapshot } from "./SummarySection";

export interface SummaryCardState {
	readonly summaryExpanded: boolean;
	readonly onSummaryExpandedChange: (expanded: boolean) => void;
	readonly onSummaryBusyChange: (busy: boolean) => void;
	readonly summarySnapshot?: SummarySnapshot;
	readonly onSummarySnapshotChange: (snapshot: SummarySnapshot) => void;
}

interface Props {
	readonly videos: YouTubeVideo[];
	readonly mode: LikedVideoDisplayMode;
	readonly currentPage: number;
	readonly resetKey: string;
	readonly renderVideo: (video: YouTubeVideo, noteExists: boolean, summary: SummaryCardState) => ReactNode;
}

const GAP = 16;
const PAGE_SIZE = 10;
const INFINITE_BATCH_SIZE = 50;

export function LikedVideoCollection({ videos, mode, currentPage, resetKey, renderVideo }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const endRef = useRef<HTMLParagraphElement>(null);
	const [batch, setBatch] = useState({ key: resetKey, count: INFINITE_BATCH_SIZE });
	const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
	const [geometry, setGeometry] = useState({ width: 0, margin: 0 });
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [summaries, setSummaries] = useState<ReadonlyMap<string, SummarySnapshot>>(new Map());
	const [busyVideos, setBusyVideos] = useState<ReadonlyMap<string, YouTubeVideo>>(new Map());
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const heights = useRef(new Map<string, number>());
	const columns = Math.max(1, Math.min(videos.length || 1, Math.floor((geometry.width + GAP) / (500 + GAP))));
	const infinite = mode === "infinite";
	const exposedCount = Math.min(videos.length, batch.key === resetKey ? batch.count : INFINITE_BATCH_SIZE);
	const rowCount = Math.ceil(exposedCount / columns);
	const getItemKey = useCallback((index: number) =>
		videos.slice(index * columns, (index + 1) * columns).map(video => video.id).join("/"), [videos, columns]);
	const rangeExtractor = useCallback((range: Range) => {
		const rows = new Set(defaultRangeExtractor(range));
		videos.forEach((video, index) => {
			if (index < exposedCount && (busyVideos.has(video.id) || video.id === focusedId)) rows.add(Math.floor(index / columns));
		});
		return [...rows].sort((a, b) => a - b);
	}, [videos, busyVideos, focusedId, columns, exposedCount]);
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
		heights.current.clear();
		virtualizer.measure();
	}, [geometry.width, columns, virtualizer]);

	useLayoutEffect(() => {
		setBatch(previous => previous.key === resetKey ? previous : { key: resetKey, count: INFINITE_BATCH_SIZE });
		if (infinite) virtualizer.scrollToOffset(0);
		else scrollElement?.scrollTo({ top: 0, behavior: "auto" });
		setFocusedId(null);
	}, [resetKey, scrollElement, infinite, virtualizer]);

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
	const mountedVideos = [...visibleVideos, ...[...busyVideos.values()].filter(video => !visibleVideos.some(item => item.id === video.id))];
	const placementKey = [...placements.keys()].join(",");
	const trackedVideos = useMemo(() => mountedVideos, [videos, placementKey, busyVideos]);
	const noteExistenceMap = useNoteExistenceMap(usePlugin(), trackedVideos);

	useLayoutEffect(() => {
		const container = containerRef.current;
		const ownerWindow = container?.ownerDocument.defaultView;
		if (!infinite || !container || !ownerWindow) return;
		const measure = () => {
			const rows = new Set<number>();
			container.querySelectorAll<HTMLElement>("[data-video-index]").forEach(element => {
				const index = Number(element.dataset.videoIndex);
				const video = videos[index];
				if (!video) return;
				heights.current.set(video.id, element.getBoundingClientRect().height);
				rows.add(Math.floor(index / columns));
			});
			rows.forEach(row => {
				const size = Math.max(...videos.slice(row * columns, Math.min((row + 1) * columns, exposedCount)).map(video => heights.current.get(video.id) ?? 240));
				virtualizer.resizeItem(row, size);
			});
		};
		const observer = new ownerWindow.ResizeObserver(measure);
		container.querySelectorAll<HTMLElement>("[data-video-index]").forEach(element => observer.observe(element));
		measure();
		return () => observer.disconnect();
	}, [infinite, videos, columns, geometry.width, virtualizer, placementKey, exposedCount]);

	return (
		<>
		<div ref={containerRef} role="list" aria-label={`Liked videos, ${videos.length} results`}
			className={`video-view__video-grid ${infinite ? "liked-video-virtual-grid" : ""}`}
			style={infinite ? { height: virtualizer.getTotalSize() } : undefined}>
			{mountedVideos.map(video => {
				const index = videos.indexOf(video);
				const shown = placements.has(index);
				return (
					<div key={video.id} role="listitem" aria-setsize={videos.length} aria-posinset={shown ? index + 1 : undefined}
						tabIndex={shown ? 0 : -1}
						aria-hidden={shown ? undefined : true} data-video-id={video.id} data-video-index={shown ? index : undefined}
						className={infinite || !shown ? "liked-video-virtual-card" : "liked-video-page-card"}
						style={infinite || !shown ? {
							width: `calc((100% - ${(columns - 1) * GAP}px) / ${columns})`,
							left: shown ? `calc(${index % columns} * ((100% + ${GAP}px) / ${columns}))` : 0,
							top: shown ? placements.get(index) : 0,
							visibility: shown ? undefined : "hidden",
							height: shown ? undefined : 0,
							overflow: shown ? undefined : "hidden",
						} : undefined}
						onFocusCapture={() => setFocusedId(video.id)}
						onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null); }}>
						{renderVideo(video, noteExistenceMap.get(video.id) ?? false, {
							summarySnapshot: summaries.get(video.id),
							onSummarySnapshotChange: snapshot => setSummaries(previous => new Map(previous).set(video.id, snapshot)),
							summaryExpanded: expanded.has(video.id),
							onSummaryExpandedChange: value => setExpanded(previous => {
								const next = new Set(previous);
								if (value) next.add(video.id); else next.delete(video.id);
								return next;
							}),
							onSummaryBusyChange: value => setBusyVideos(previous => {
								if (previous.has(video.id) === value) return previous;
								const next = new Map(previous);
								if (value) next.set(video.id, video); else next.delete(video.id);
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
}
