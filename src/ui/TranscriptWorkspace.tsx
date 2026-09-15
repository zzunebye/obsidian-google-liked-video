import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePlugin } from "src/store/pluginContext";
import type { YouTubeVideo } from "src/types";
import type { TranscriptReaderMode } from "src/utils/transcriptUtils";
import { VideoTranscriptReader } from "./VideoTranscriptReader";

interface TranscriptSelection {
	video: YouTubeVideo;
	displayMode: TranscriptReaderMode;
}

interface TranscriptContextValue {
	selectedVideoId?: string;
	openTranscript: (video: YouTubeVideo, trigger: HTMLElement, mode?: TranscriptReaderMode) => void;
}

const TranscriptContext = createContext<TranscriptContextValue | null>(null);
export const useTranscriptWorkspace = () => useContext(TranscriptContext);

export function TranscriptWorkspace({ children, label }: { children: ReactNode; label: string }) {
	const plugin = usePlugin();
	const [selected, setSelected] = useState<TranscriptSelection | null>(null);
	const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
	const [width, setWidth] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const detailRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLElement | null>(null);
	useLayoutEffect(() => {
		const host = rootRef.current?.parentElement;
		const root = rootRef.current;
		const ownerWindow = root?.ownerDocument.defaultView;
		host?.classList.add("geulo-transcript-host");
		const observer = ownerWindow && new ownerWindow.ResizeObserver(() => setWidth(root?.clientWidth ?? 0));
		if (root) { setWidth(root.clientWidth); observer?.observe(root); }
		return () => { observer?.disconnect(); host?.classList.remove("geulo-transcript-host"); };
	}, []);
	const hasSelection = selected !== null;
	const listHidden = hasSelection && width < 900;
	useLayoutEffect(() => {
		const list = listRef.current;
		if (listHidden && list?.contains(list.ownerDocument.activeElement)) {
			rootRef.current?.querySelector<HTMLElement>(".geulo-transcript-reader")?.focus({ preventScroll: true });
		}
		list?.toggleAttribute("inert", listHidden);
	}, [listHidden]);
	useLayoutEffect(() => {
		if (!hasSelection) {
			if (phase === "closing") {
				if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
				else listRef.current?.focus({ preventScroll: true });
				setPhase("opening");
			}
			return;
		}
		if (phase === "opening") {
			// Resolve the initial styles before transitioning the new layer into view.
			detailRef.current?.getBoundingClientRect();
			setPhase("open");
			return;
		}
		if (phase !== "closing") return;
		let cancelled = false;
		const animations = [
			...(detailRef.current?.getAnimations() ?? []),
			...(listRef.current?.getAnimations() ?? []),
		];
		void Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(() => {
			if (cancelled) return;
			setSelected(null);
		});
		return () => { cancelled = true; };
	}, [hasSelection, phase]);
	return <TranscriptContext.Provider value={{
		selectedVideoId: selected?.video.id,
		openTranscript: (video, trigger, displayMode = "paragraphs") => {
			triggerRef.current = trigger;
			setPhase(hasSelection ? "open" : "opening");
			setSelected({ video, displayMode });
		},
	}}>
		<div ref={rootRef} className={`geulo-transcript-workspace${selected ? ` geulo-transcript-workspace--${phase}` : ""}`}>
			<div ref={listRef} className="view-content geulo-transcript-workspace__list" tabIndex={-1} aria-hidden={listHidden || undefined} aria-label={label}>{children}</div>
			{selected && <div ref={detailRef} className="geulo-transcript-workspace__detail">
				<VideoTranscriptReader key={selected.video.id} video={selected.video} backLabel={`Back to ${label}`} onBack={() => setPhase("closing")}
					displayMode={selected.displayMode} onDisplayModeChange={displayMode => setSelected(current => current ? { ...current, displayMode } : current)}
					onOpenPane={async (transcript, mode) => {
						await plugin.openTranscriptPane(selected.video, transcript, mode);
						setSelected(null);
					}} />
			</div>}
		</div>
	</TranscriptContext.Provider>;
}
