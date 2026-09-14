import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePlugin } from "src/store/pluginContext";
import type { YouTubeVideo } from "src/types";
import { VideoTranscriptReader } from "./VideoTranscriptReader";

interface TranscriptSelection {
	video: YouTubeVideo;
}

interface TranscriptContextValue {
	selectedVideoId?: string;
	openTranscript: (video: YouTubeVideo, trigger: HTMLElement) => void;
}

const TranscriptContext = createContext<TranscriptContextValue | null>(null);
export const useTranscriptWorkspace = () => useContext(TranscriptContext);

export function TranscriptWorkspace({ children, label }: { children: ReactNode; label: string }) {
	const plugin = usePlugin();
	const [selected, setSelected] = useState<TranscriptSelection | null>(null);
	const [width, setWidth] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
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
	const listHidden = selected !== null && width < 900;
	useLayoutEffect(() => {
		const list = listRef.current;
		if (listHidden && list?.contains(list.ownerDocument.activeElement)) {
			rootRef.current?.querySelector<HTMLElement>(".geulo-transcript-reader")?.focus({ preventScroll: true });
		}
		list?.toggleAttribute("inert", listHidden);
	}, [listHidden]);
	const close = (): void => {
		setSelected(null);
		rootRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
			if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
			else listRef.current?.focus({ preventScroll: true });
		});
	};
	return <TranscriptContext.Provider value={{
		selectedVideoId: selected?.video.id,
		openTranscript: (video, trigger) => { triggerRef.current = trigger; setSelected({ video }); },
	}}>
		<div ref={rootRef} className={`geulo-transcript-workspace${selected ? " geulo-transcript-workspace--open" : ""}`}>
			<div ref={listRef} className="view-content geulo-transcript-workspace__list" tabIndex={-1} aria-hidden={listHidden || undefined} aria-label={label}>{children}</div>
			{selected && <div className="geulo-transcript-workspace__detail">
				<VideoTranscriptReader key={selected.video.id} video={selected.video} backLabel={`Back to ${label}`} onBack={close}
					onOpenPane={async transcript => {
						await plugin.openTranscriptPane(selected.video, transcript);
						setSelected(null);
					}} />
			</div>}
		</div>
	</TranscriptContext.Provider>;
}
