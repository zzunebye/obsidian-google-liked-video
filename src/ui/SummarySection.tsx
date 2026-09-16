import { Component, Notice, MarkdownRenderer, getLanguage } from "obsidian";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
	Copy,
	RefreshCw,
	AlertCircle,
	ChevronUp,
	ChevronDown,
	FileText,
	Square,
} from "lucide-react";
import { AIServiceError, AIServiceResult } from "../services/geminiService";
import { createAIService, getActiveApiKey } from "../services/aiServiceFactory";
import { usePlugin } from "../store/pluginContext";
import { debugLogger } from "../debug";
import { parseDurationToSeconds } from "../utils/videoUtils";
import type { SummarySource } from "../types";

const LONG_VIDEO_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

export interface SummarySnapshot {
	readonly summary: string | null;
	readonly source?: SummarySource;
	readonly model?: string;
	readonly saved?: boolean;
	readonly error: AIServiceError | null;
	readonly contentCollapsed: boolean;
}

interface SummarySectionProps {
	videoId: string;
	videoTitle: string;
	channelTitle: string;
	channelId: string;
	isExpanded: boolean;
	setIsExpanded: (expanded: boolean) => void;
	onSummaryGenerated?: () => void;
	onAddToNote?: (summary: string) => Promise<void>;
	presentation?: "card" | "reader";
	onScrollToTop?: () => void;
	onPreviewUpdated?: () => void;
	regenerateTrigger?: number;
	videoDuration?: string; // ISO 8601 duration format (e.g., "PT1H30M")
	onBusyChange?: (busy: boolean) => void;
	progressHost?: HTMLElement | null;
	onShowSummary?: () => void;
	initialSnapshot?: SummarySnapshot;
	onSnapshotChange?: (snapshot: SummarySnapshot) => void;
}

export const SummarySection = ({
	videoId,
	videoTitle,
	channelTitle,
	channelId,
	isExpanded,
	setIsExpanded,
	onSummaryGenerated,
	onAddToNote,
	onScrollToTop,
	onPreviewUpdated,
	regenerateTrigger,
	videoDuration,
	onBusyChange,
	progressHost,
	onShowSummary,
	initialSnapshot,
	onSnapshotChange,
	presentation = "card",
}: SummarySectionProps) => {
	const plugin = usePlugin();
	const [summary, setSummaryValue] = useState<string | null>(initialSnapshot?.summary ?? null);
	const [summarySource, setSummarySource] = useState<SummarySource>(initialSnapshot?.source ?? 'video');
	const [summaryModel, setSummaryModel] = useState<string | undefined>(initialSnapshot?.model);
	const activeSourceRef = useRef<SummarySource>(summarySource);
	const [phase, setPhase] = useState<"idle" | "preparing" | "generating" | "saving" | "preview">("idle");
	const isLoading = phase === "preparing";
	const isStreaming = phase === "generating";
	const isBusy = phase !== "idle";
	const [savingNote, setSavingNote] = useState(false);
	const savingNoteRef = useRef(false);
	const [checkingCache, setCheckingCache] = useState(!initialSnapshot?.summary);
	const [isSaved, setSavedValue] = useState(initialSnapshot?.saved ?? !!initialSnapshot?.summary);
	const [hasOneLiner, setHasOneLiner] = useState<boolean | null>(null);
	const lastActionRef = useRef<"summary" | "preview" | "load">("load");
	const [error, setErrorValue] = useState<AIServiceError | null>(initialSnapshot?.error ?? null);
	const [streamingContent, setStreamingContent] = useState<string>("");
	const streamingContentRef = useRef("");
	const [isContentCollapsed, setContentCollapsedValue] = useState(initialSnapshot?.contentCollapsed ?? presentation === "card");
	const snapshotRef = useRef<SummarySnapshot>({ summary, source: summarySource, model: summaryModel, saved: isSaved, error, contentCollapsed: isContentCollapsed });
	const setSummary = (value: string | null, source: SummarySource, model?: string) => {
		setSummaryValue(value);
		setSummarySource(source);
		setSummaryModel(model);
		const contentCollapsed = presentation === "card";
		setContentCollapsedValue(contentCollapsed);
		snapshotRef.current = { ...snapshotRef.current, summary: value, source, model, contentCollapsed };
		onSnapshotChange?.(snapshotRef.current);
	};
	const setSaved = (saved: boolean) => {
		setSavedValue(saved);
		snapshotRef.current = { ...snapshotRef.current, saved };
		onSnapshotChange?.(snapshotRef.current);
	};
	const setError = (value: AIServiceError | null) => {
		setErrorValue(value);
		snapshotRef.current = { ...snapshotRef.current, error: value };
		onSnapshotChange?.(snapshotRef.current);
	};
	const setIsContentCollapsed = (value: boolean) => {
		setContentCollapsedValue(value);
		snapshotRef.current = { ...snapshotRef.current, contentCollapsed: value };
		onSnapshotChange?.(snapshotRef.current);
	};
	const [isOverflowing, setIsOverflowing] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const requestPendingRef = useRef(false);
	const autoGenerationAttemptedRef = useRef(false);
	const autoPreviewAttemptedRef = useRef(false);
	const renderComponentRef = useRef<Component | null>(null);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		let disposed = false;
		let rendering = false;
		let renderedContent = "";

		const renderContent = async (): Promise<void> => {
			const contentToRender = isStreaming ? streamingContentRef.current : summary;
			if (!contentToRender || rendering || contentToRender === renderedContent) return;
			rendering = true;
			const rendered = el.ownerDocument.createElement("div");
			const renderComponent = new Component();
			renderComponent.load();
			try {
				await MarkdownRenderer.render(plugin.app, contentToRender, rendered, "", renderComponent);
				if (disposed) {
					renderComponent.unload();
					return;
				}
				renderComponentRef.current?.unload();
				el.replaceChildren(...Array.from(rendered.childNodes));
				renderComponentRef.current = renderComponent;
				renderedContent = contentToRender;
			} catch (error: unknown) {
				renderComponent.unload();
				debugLogger.warn(
					`[AI Summary] Failed to render summary for video: ${videoId}`,
					error,
				);
			} finally {
				rendering = false;
			}
		};
		void renderContent();
		const interval = isStreaming ? window.setInterval(() => void renderContent(), 100) : undefined;

		return () => {
			disposed = true;
			window.clearInterval(interval);
			renderComponentRef.current?.unload();
			renderComponentRef.current = null;
		};
	}, [summary, plugin, videoId, isExpanded, isStreaming, isLoading]);

	// Measure content overflow after markdown rendering completes
	useEffect(() => {
		if (!summary || isStreaming || !contentRef.current) return;
		const timer = window.setTimeout(() => {
			if (contentRef.current) {
				setIsOverflowing(contentRef.current.scrollHeight > 300);
			}
		}, 50);
		return () => window.clearTimeout(timer);
	}, [summary, isStreaming]);

	const canGenerate = plugin.settings.enableAISummary && !!getActiveApiKey(plugin.settings);
	const provider = plugin.settings.aiProvider;
	const showLongVideoNotice = provider === "gemini"
		&& (parseDurationToSeconds(videoDuration ?? "") ?? 0) > LONG_VIDEO_THRESHOLD_SECONDS;

	useEffect(() => { onBusyChange?.(isBusy || savingNote); }, [isBusy, savingNote, onBusyChange]);

	const loadSavedSummary = async (): Promise<void> => {
		lastActionRef.current = "load";
		setCheckingCache(true);
		try {
			const cached = await plugin.summaryStorage.getVideoSummaryData(videoId);
			if (requestPendingRef.current) return;
			if (cached && !summary) {
				setSummary(cached.summary, cached.source ?? "video", cached.model);
				setSaved(true);
			}
			setHasOneLiner(!!cached?.oneLinerSummary?.trim());
			setError(null);
		} catch (error: unknown) {
			debugLogger.error(`[AI Summary] Could not load summary for ${videoId}`, error);
			setError(new AIServiceError("unknown", "Could not load the saved summary. Please try again."));
		} finally { setCheckingCache(false); }
	};

	useEffect(() => {
		if (isExpanded && (!summary || hasOneLiner === null) && !requestPendingRef.current) void loadSavedSummary();
	}, [isExpanded, videoId]);

	const generateSummary = async (forceRegenerate = false): Promise<void> => {
		if (requestPendingRef.current || savingNoteRef.current || checkingCache || !canGenerate) return;
		lastActionRef.current = "summary";
		const controller = new AbortController();
		abortControllerRef.current = controller;
		requestPendingRef.current = true;
		setPhase("preparing");
		setError(null);
		streamingContentRef.current = "";
		setStreamingContent("");
		try {
			if (!forceRegenerate) {
				const cached = await plugin.summaryStorage.getVideoSummaryData(videoId);
				if (controller.signal.aborted) return;
				if (cached) {
					setSummary(cached.summary, cached.source ?? "video", cached.model);
					setSaved(true);
					setHasOneLiner(!!cached.oneLinerSummary?.trim());
					return;
				}
			}
			const aiService = createAIService(plugin.settings);
			activeSourceRef.current = provider === "gemini" ? "video" : "transcript";
			let result: AIServiceResult | undefined;
			if (aiService.generateVideoSummaryStream) {
				await aiService.generateVideoSummaryStream(videoId, plugin.settings.summaryPrompt, {
					onChunk: (_chunk, accumulated) => {
						if (controller.signal.aborted) return;
						streamingContentRef.current = accumulated;
						setStreamingContent(accumulated);
						setPhase("generating");
					},
					onComplete: completed => { result = completed; },
					signal: controller.signal,
				});
			} else {
				setPhase("generating");
				result = await aiService.generateVideoSummary(videoId, plugin.settings.summaryPrompt);
			}
			if (controller.signal.aborted) return;
			if (!result) throw new AIServiceError("unknown", "No summary was returned. Please try again.");
			setSummary(result.summary, result.source, result.model);
			setSaved(false);
			setPhase("saving");
			await plugin.summaryStorage.setVideoSummary(videoId, result, {
				title: videoTitle, channelTitle, channelId,
				videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
			});
			if (controller.signal.aborted) return;
			setSaved(true);
			setHasOneLiner(false);
			autoPreviewAttemptedRef.current = false;
			onSummaryGenerated?.();
			new Notice(`AI summary saved in Geulo for "${videoTitle}". Use Add to Note to save it to a note.`, 5000);
		} catch (error: unknown) {
			if (controller.signal.aborted) return;
			if (streamingContentRef.current) {
				setSummary(streamingContentRef.current, activeSourceRef.current);
				setSaved(false);
			}
			debugLogger.error(`[AI Summary] Generation failed for ${videoId}`, error);
			setError(error instanceof AIServiceError ? error : new AIServiceError("unknown", error instanceof Error ? error.message : "Could not generate or save the summary."));
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null;
				requestPendingRef.current = false;
				streamingContentRef.current = "";
				setStreamingContent("");
				setPhase("idle");
			}
		}
	};

	useEffect(() => {
		if (!isExpanded || checkingCache || summary || error || !canGenerate
			|| requestPendingRef.current || autoGenerationAttemptedRef.current) return;
		autoGenerationAttemptedRef.current = true;
		void generateSummary();
	}, [isExpanded, checkingCache, summary, error, canGenerate]);

	const generateOneLiner = async (): Promise<void> => {
		if (!summary || !isSaved || !canGenerate || requestPendingRef.current || savingNoteRef.current) return;
		autoPreviewAttemptedRef.current = true;
		lastActionRef.current = "preview";
		const controller = new AbortController();
		abortControllerRef.current = controller;
		requestPendingRef.current = true;
		setPhase("preview");
		setError(null);
		try {
			const prompt = `Condense the following video summary into a single concise sentence (max 120 chars). Return ONLY the sentence.\n\n${summary}`;
			const oneLiner = await createAIService(plugin.settings).generateTextCompletion(prompt, controller.signal);
			if (controller.signal.aborted) return;
			const trimmed = oneLiner.replace(/\s+/g, " ").trim();
			if (!trimmed) throw new Error("One-line preview returned no text.");
			setPhase("saving");
			await plugin.summaryStorage.setOneLinerSummary(videoId, trimmed);
			if (controller.signal.aborted) return;
			setHasOneLiner(true);
			onPreviewUpdated?.();
		} catch (error: unknown) {
			if (!controller.signal.aborted) {
				debugLogger.warn(`[AI Summary] One-line preview failed for ${videoId}`, error);
				setError(new AIServiceError("unknown", "Could not generate or save the one-line preview. Your summary is still saved."));
			}
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null;
				requestPendingRef.current = false;
				setPhase("idle");
			}
		}
	};

	useEffect(() => {
		if (checkingCache || !summary || !isSaved || hasOneLiner !== false || error || !canGenerate
			|| isBusy || savingNote || requestPendingRef.current || autoPreviewAttemptedRef.current) return;
		void generateOneLiner();
	}, [checkingCache, summary, isSaved, hasOneLiner, error, canGenerate, isBusy, savingNote]);

	useEffect(() => {
		if (regenerateTrigger && regenerateTrigger > 0) {
			void generateSummary(true);
		}
	}, [regenerateTrigger]);

	const handleCopy = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (summary) {
			void navigator.clipboard.writeText(summary).catch((error: unknown) => {
				debugLogger.warn(
					`[AI Summary] Failed to copy summary for video: ${videoId}`,
					error,
				);
				new Notice("Could not copy the summary. Please try again.");
			});
			new Notice("Summary copied to clipboard");
			debugLogger.debug(
				`[AI Summary] Summary copied to clipboard for video: ${videoId}`,
			);
		}
	};

	const handleRegenerate = (e: React.MouseEvent) => {
		e.stopPropagation();
		debugLogger.info(
			`[AI Summary] Regenerate requested for video: ${videoId}`,
		);
		void generateSummary(true);
	};

	const handleAddToNote = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!summary || !onAddToNote || requestPendingRef.current || savingNoteRef.current) return;
		savingNoteRef.current = true;
		setSavingNote(true);
		try {
			await onAddToNote(summary);
		} catch (err) {
			debugLogger.error("[AI Summary] Failed to save summary to note", err);
			new Notice("Failed to add summary to note");
		} finally {
			savingNoteRef.current = false;
			setSavingNote(false);
		}
	};

	const handleCancel = (e: React.MouseEvent) => {
			e.stopPropagation();
			debugLogger.info(
				`[AI Summary] User cancelled streaming for video: ${videoId}`,
			);
			abortControllerRef.current?.abort();
			abortControllerRef.current = null;
			requestPendingRef.current = false;
			setPhase("idle");
			// Keep streaming content visible if any was received
			if (streamingContentRef.current) {
				setSummary(streamingContentRef.current, activeSourceRef.current);
				setSaved(false);
				setStreamingContent("");
				streamingContentRef.current = "";
			}
			setError(new AIServiceError("unknown", lastActionRef.current === "preview" ? "One-line preview cancelled. Your summary is still saved." : "Summary cancelled. Any partial text is not saved."));
	};

	const handleToggleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsContentCollapsed(!isContentCollapsed);
	};

	// Cleanup abort controller on unmount
	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	const progress = isBusy ? <div className="summary-section__streaming-indicator">
		<div className="summary-section__streaming-dot" aria-hidden="true" />
		<span role="status">{phase === "preparing" ? "Preparing AI summary…" : phase === "saving" ? "Saving…" : phase === "preview" ? "Generating one-line preview…" : "Generating AI summary…"}</span>
		{!isExpanded && onShowSummary && <button type="button" className="summary-section__action-btn" onClick={onShowSummary}>View</button>}
		{phase !== "saving" && <button type="button" className="summary-section__cancel-btn" onClick={handleCancel} title="Cancel generation"><Square size={10} aria-hidden="true" /><span>Stop</span></button>}
	</div> : null;
	const progressPortal = progressHost ? createPortal(progress, progressHost) : null;
	if (!isExpanded) return progressPortal;

	return (
		<div className="summary-section" onClick={(e) => e.stopPropagation()} aria-busy={isBusy || checkingCache || savingNote}>
			{progressPortal ?? progress}
			{checkingCache && <p role="status">Loading saved summary…</p>}
			{!checkingCache && ((!summary && !isBusy && !error) || !canGenerate || showLongVideoNotice) && <div className="summary-section__setup">
				{!summary && !isBusy && !error && <strong>No AI summary yet</strong>}
				{!canGenerate && <p>{plugin.settings.enableAISummary ? "Configure an API key in Settings > AI Features to generate a summary." : "Enable AI summaries in Settings > AI Features to generate a summary."}</p>}
				{showLongVideoNotice && <p>This video is over 30 minutes. Video analysis may take longer and cost more.</p>}
				{!summary && !isBusy && !error && <button type="button" className="mod-cta" disabled={!canGenerate} onClick={() => void generateSummary()}>Generate AI summary</button>}
			</div> }
			{(isLoading || (isStreaming && !streamingContent)) && (
				<div className="summary-section__skeleton" role="status" aria-label="Loading AI summary">
					{presentation === "reader" && <p>Preparing AI summary… This may take a moment.</p>}
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--medium" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--short" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
				</div>
			)}

			{error && !isBusy && (
				<div className="summary-section__error" role="alert">
					<AlertCircle size={14} />
					<span>{error.message}</span>
					{(error.type !== "no_api_key" || presentation === "reader") && (
						<button
							className="summary-section__retry-btn"
							disabled={lastActionRef.current !== "load" && !canGenerate}
							onClick={() => { void (lastActionRef.current === "load" ? loadSavedSummary() : lastActionRef.current === "preview" ? generateOneLiner() : generateSummary(true)); }}
						>
							Retry
						</button>
					)}
				</div>
			)}

			{isStreaming && (
				<>
					<div className={presentation === "card" ? "summary-section__fade-overlay" : ""}>
						<div
							className={`summary-section__content${presentation === "card" ? " summary-section__content--collapsed" : ""}`}
							ref={contentRef}
						/>
					</div>
				</>
			)}

			{summary && !isLoading && !isStreaming && (
				<>
					<div className="summary-section__source">
						<span>{isSaved ? "Saved in Geulo" : phase === "saving" ? "Saving in Geulo…" : "Not saved in Geulo"} · </span>
						{getLanguage() === 'ko'
							? (summarySource === 'transcript' ? 'Transcript 기반' : '영상 분석 기반')
							: (summarySource === 'transcript' ? 'Transcript-based' : 'Video-based')}
					</div>
					<div
						className={
							isOverflowing && isContentCollapsed
								? "summary-section__fade-overlay"
								: ""
						}
					>
						<div
							className={`summary-section__content${isOverflowing && isContentCollapsed ? " summary-section__content--collapsed" : ""}`}
							ref={contentRef}
						/>
					</div>
					{isOverflowing && presentation === "card" && (
						<button
							className="summary-section__toggle-btn"
							onClick={handleToggleCollapse}
						>
							{isContentCollapsed ? (
								<>
									<span>Show more</span>
									<ChevronDown size={14} />
								</>
							) : (
								<>
									<span>Show less</span>
									<ChevronUp size={14} />
								</>
							)}
						</button>
					)}
					{isSaved && <div className="summary-section__preview-option">
						<span>{hasOneLiner ? "One-line preview saved" : error ? "One-line preview not saved" : "A one-line preview is generated automatically with one additional AI request."}</span>
						<span>Model: {summaryModel ?? "Unknown"}</span>
					</div>}
					<div className="summary-section__actions">
						<div className="summary-section__left-actions">
							{onAddToNote && <button
								className="summary-section__action-btn"
								disabled={isBusy || checkingCache || savingNote}
								onClick={(event) => {
									void handleAddToNote(event);
								}}
								title="Add summary to video note"
							>
								<FileText size={14} />
								<span>{savingNote ? "Saving to note…" : "Add to Note"}</span>
							</button>}
							<button
								className="summary-section__action-btn"
								onClick={handleCopy}
								title="Copy summary"
							>
								<Copy size={14} />
							</button>
						</div>
						<button
							className="summary-section__action-btn"
							onClick={handleRegenerate}
							disabled={!canGenerate || isBusy || savingNote}
							aria-label="Regenerate summary"
							title="Regenerate summary"
						>
							<RefreshCw size={14} />
						</button>
						<button
							className="summary-section__action-btn"
							onClick={presentation === "reader" ? onScrollToTop : () => setIsExpanded(false)}
							title={presentation === "reader" ? "Scroll to top" : "Close summary section"}
							aria-label={presentation === "reader" ? "Scroll to top" : "Close summary section"}
						>
							<ChevronUp size={14} />
						</button>
					</div>
				</>
			)}
		</div>
	);
};
