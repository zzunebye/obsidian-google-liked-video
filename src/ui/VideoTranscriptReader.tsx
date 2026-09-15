import { Menu, Notice } from "obsidian";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Copy, ExternalLink, FilePlus, PanelRightOpen, Search } from "lucide-react";
import { debugLogger } from "src/debug";
import type { VideoTranscript } from "src/services/transcriptService";
import { TranscriptPlaybackService } from "src/services/transcriptPlaybackService";
import { usePlugin } from "src/store/pluginContext";
import type { YouTubeVideo } from "src/types";
import { getExpectedNotePath, sanitizeFileName } from "src/utils/noteUtils";
import { formatTranscriptTimestamp, getTranscriptRows } from "src/utils/transcriptUtils";
import type { TranscriptReaderMode } from "src/utils/transcriptUtils";
import { SummarySection } from "./SummarySection";
import { useVideoTranscript } from "./useVideoTranscript";

interface Props {
	video: YouTubeVideo;
	initialTranscript?: VideoTranscript;
	displayMode?: TranscriptReaderMode;
	onDisplayModeChange?: (mode: TranscriptReaderMode) => void;
	backLabel?: string;
	onBack?: () => void;
	onOpenPane?: (transcript: VideoTranscript | undefined, mode: TranscriptReaderMode) => Promise<void>;
}

function Highlight({ text, query }: { text: string; query: string }) {
	if (!query) return <>{text}</>;
	const parts = [];
	let offset = 0;
	let index = text.toLocaleLowerCase().indexOf(query);
	while (index >= 0) {
		parts.push(text.slice(offset, index), <mark key={index}>{text.slice(index, index + query.length)}</mark>);
		offset = index + query.length;
		index = text.toLocaleLowerCase().indexOf(query, offset);
	}
	parts.push(text.slice(offset));
	return <>{parts}</>;
}

export function VideoTranscriptReader({ video, initialTranscript, displayMode, onDisplayModeChange, backLabel, onBack, onOpenPane }: Props) {
	const plugin = usePlugin();
	const rootRef = useRef<HTMLElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const { state, retry } = useVideoTranscript(video.id, initialTranscript);
	const [query, setQuery] = useState("");
	const [localDisplayMode, setLocalDisplayMode] = useState<TranscriptReaderMode>("paragraphs");
	const mode = displayMode ?? localDisplayMode;
	const [summaryBusy, setSummaryBusy] = useState(false);
	const [position, setPosition] = useState<number | null>(null);
	const [following, setFollowing] = useState(true);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [copied, setCopied] = useState(false);
	const playback = useMemo(() => new TranscriptPlaybackService(plugin.app, plugin.settings), [plugin]);
	const rows = useMemo(() => state.kind === "loaded" && mode !== "ai" ? getTranscriptRows(state.transcript.segments, mode) : [], [state, mode]);
	const needle = query.trim().toLocaleLowerCase();
	const visibleRows = useMemo(() => needle ? rows.filter(row => row.text.toLocaleLowerCase().includes(needle)) : rows, [rows, needle]);

	const activeIndex = position === null ?
		-1 : rows.findIndex((row, index) =>
			position >= row.start && position < (rows[index + 1]?.start ?? row.end + 1));
	const activeRow = rows[activeIndex];
	const activeStart = activeRow?.start;

	useEffect(() => { rootRef.current?.focus({ preventScroll: true }); }, []);

	useEffect(() => {
		const ownerWindow = rootRef.current?.ownerDocument.defaultView;
		if (!ownerWindow) return;
		let stopped = false;
		let timer: number | undefined;
		const poll = async (): Promise<void> => {
			const current = rootRef.current?.getClientRects().length ? await playback.getPosition(video.id) : null;
			if (stopped) return;
			setPosition(current);
			timer = ownerWindow.setTimeout(() => void poll(), 750);
		};
		void poll();
		return () => { stopped = true; ownerWindow.clearTimeout(timer); };
	}, [playback, video.id]);

	useEffect(() => {
		if (!following || needle || activeStart === undefined) return;
		const scroller = scrollRef.current;
		const active = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
		if (scroller && active) scroller.scrollTo({ top: active.offsetTop - scroller.clientHeight / 3, behavior: "auto" });
	}, [activeStart, following, needle, mode]);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2000);
		return () => window.clearTimeout(timer);
	}, [copied]);

	const run = async (action: () => Promise<void>): Promise<void> => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try { await action(); }
		catch (error: unknown) {
			debugLogger.error("[Transcript] Action failed", video.id, error);
			new Notice("Could not complete the transcript action. Please try again.");
		} finally { busyRef.current = false; setBusy(false); }
	};

	const copy = async (timestamps: boolean): Promise<void> => {
		await navigator.clipboard.writeText(rows.map(row =>
			`${timestamps ? `${formatTranscriptTimestamp(row.start)}  ` : ""}${row.text}`).join("\n\n"));
		setCopied(true);
		new Notice("Full transcript copied to clipboard");
	};

	const saveNote = async (): Promise<void> => {
		if (state.kind !== "loaded") return;
		const folder = plugin.settings.videoNotePath.trim();
		const noteTitle = `${sanitizeFileName(`${video.snippet.channelTitle} - ${video.snippet.title}`)} Transcript`;
		const path = await getExpectedNotePath(plugin.app,
			noteTitle, folder,
			folder.length > 0 && plugin.settings.organizeByChannel, video.snippet.channelTitle);
		let file = plugin.app.vault.getFileByPath(path);
		if (!file) {
			const url = `https://www.youtube.com/watch?v=${video.id}`;
			const escapedTitle = video.snippet.title.replace(/[[\]\\]/g, "\\$&");
			const content = `# Transcript\n\n[Watch video: ${escapedTitle}](${url})\n\n${video.snippet.channelTitle} · ${state.transcript.languageName}\n\n`
				+ rows.map(row => `[${formatTranscriptTimestamp(row.start)}](${url}&t=${Math.floor(row.start)}s) ${row.text}`).join("\n\n") + "\n";
			file = await plugin.app.vault.create(path, content);
			new Notice("Transcript saved as a note");
		} else new Notice("Opening the existing transcript note");
		await plugin.app.workspace.getLeaf("tab").openFile(file);
	};

	const changeMode = (value: TranscriptReaderMode): void => {
		if (value === mode) return;
		setLocalDisplayMode(value);
		setCopied(false);
		onDisplayModeChange?.(value);
		scrollRef.current?.scrollTo({ top: 0 });
	};
	const modes: TranscriptReaderMode[] = ["ai", "paragraphs", "original"];
	const isAiMode = mode === "ai";

	return (
		<section ref={rootRef} className={`geulo-transcript-reader geulo-transcript-reader--${mode}`} tabIndex={-1} aria-label={`Transcript for ${video.snippet.title}`}>
			<header className="geulo-transcript-reader__header">
				<div className="geulo-transcript-reader__navigation">
					{onBack ? <button type="button" className="geulo-transcript-reader__back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{backLabel ?? "Back to videos"}</button> : <span>Transcript</span>}
					<div className="geulo-transcript-reader__navigation-actions">
						<button type="button" disabled={busy} onClick={() => void run(() => playback.open(video.id))}><ExternalLink size={14} aria-hidden="true" />Open video</button>
						{onOpenPane && <button type="button" title="Open transcript in new pane" aria-label="Open transcript in new pane" disabled={busy || summaryBusy}
							onClick={() => void run(() => onOpenPane(state.kind === "loaded" ? state.transcript : undefined, mode))}><PanelRightOpen size={16} aria-hidden="true" /></button>}
					</div>
				</div>
				<h2>{video.snippet.title}</h2>
				<p className="geulo-transcript-reader__metadata">{video.snippet.channelTitle}
					{!isAiMode && state.kind === "loaded" && <> · {state.transcript.languageName.replace(/\s*\(auto-generated\)/i, "")} · {state.transcript.isAutoGenerated ? "Auto-generated" : "Captions"}</>}</p>

				<div className="geulo-transcript-reader__modes" role="group" aria-label="Transcript display mode">
					{modes.map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy}
						onClick={() => changeMode(value)}>{value === "ai" ? <><Bot size={14} aria-hidden="true" />AI</> : value === "paragraphs" ? "Paragraphs" : "Original timestamps"}</button>)}
				</div>
				{!isAiMode && <div className="geulo-transcript-reader__actions">
					<button type="button" disabled={busy || state.kind !== "loaded"} onClick={event => {
						const menu = new Menu();
						menu.addItem(item => item.setTitle("Copy full text").onClick(() => void run(() => copy(false))));
						menu.addItem(item => item.setTitle("Copy with timestamps").onClick(() => void run(() => copy(true))));
						const rect = event.currentTarget.getBoundingClientRect();
						menu.showAtPosition({ x: rect.left, y: rect.bottom });
					}}><Copy size={14} aria-hidden="true" />{copied ? "Copied" : "Copy all…"}</button>
					<button type="button" disabled={busy || state.kind !== "loaded"} onClick={() => void run(saveNote)}><FilePlus size={14} aria-hidden="true" />Save as note</button>
				</div>}
			</header>
			<div className="geulo-transcript-reader__summary" hidden={mode !== "ai"} aria-label="AI summary">
				<SummarySection videoId={video.id} videoTitle={video.snippet.title} channelTitle={video.snippet.channelTitle}
					channelId={video.snippet.channelId} videoDuration={video.contentDetails?.duration} presentation="reader"
					isExpanded={mode === "ai"} setIsExpanded={expanded => { if (!expanded) changeMode("paragraphs"); }}
					onBusyChange={setSummaryBusy} />
			</div>
			{mode !== "ai" && state.kind === "loading" && <p className="geulo-transcript-reader__status" role="status">Fetching transcript…</p>}
			{mode !== "ai" && state.kind === "error" && <div className="geulo-transcript-reader__status" role="alert"><p>{state.message}</p><button type="button" onClick={retry}>Try again</button></div>}
			{mode !== "ai" && state.kind === "loaded" && <>
				<div className="geulo-transcript-reader__tools">
					<label className="geulo-transcript-reader__search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search transcript" placeholder="Search transcript…" value={query} onChange={event => { setQuery(event.target.value); setFollowing(false); scrollRef.current?.scrollTo({ top: 0 }); }} /></label>
					<div className="geulo-transcript-reader__follow">
						<span role={needle ? "status" : undefined}>{needle ? `${visibleRows.length} matching ${mode === "paragraphs" ? "paragraphs" : "captions"}` : position === null ? "Open this video in WebViewer to follow playback" : `Playback · ${formatTranscriptTimestamp(position)}`}</span>
						{position !== null && <button type="button" aria-pressed={following} onClick={() => { setQuery(""); setFollowing(value => !value); }}>{following ? "Following" : "Follow playback"}</button>}
					</div>
				</div>
				<div ref={scrollRef} className="geulo-transcript-reader__paragraphs" tabIndex={0} aria-label={mode === "paragraphs" ? "Transcript paragraphs" : "Original caption segments"}
					onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)} onPointerDown={() => setFollowing(false)}
					onKeyDown={event => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) setFollowing(false); }}>
					{visibleRows.length === 0 && <p role="status">{needle ? "No matching transcript text." : "No transcript text is available."}</p>}
					{visibleRows.map((row, index) => <p key={`${row.start}-${index}`} className="geulo-transcript-reader__paragraph" aria-current={row === activeRow ? "true" : undefined}>
						<a href={`https://www.youtube.com/watch?v=${video.id}&t=${Math.floor(row.start)}s`} aria-label={`Play video at ${formatTranscriptTimestamp(row.start)}`}
							onClick={event => { event.preventDefault(); void run(() => playback.open(video.id, row.start)); }}>
							{formatTranscriptTimestamp(row.start)}</a>
						<span><Highlight text={row.text} query={needle} /></span>
					</p>)}
				</div>
			</>}
		</section>
	);
}
