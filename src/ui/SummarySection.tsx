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
import type { SummaryProgressPhase } from "../services/geminiService";
import { createAIService, getActiveApiKey } from "../services/aiServiceFactory";
import { usePlugin } from "../store/pluginContext";
import { debugLogger } from "../debug";
import { parseDurationToSeconds } from "../utils/videoUtils";
import type { SummarySource } from "../types";
import { t } from "../i18n";

const LONG_VIDEO_THRESHOLD_SECONDS = 30 * 60; // 30 minutes
type SummaryPhase = "idle" | "preparing" | SummaryProgressPhase | "generating" | "saving" | "preview";

const SUMMARY_PROGRESS_LABELS: Record<Exclude<SummaryPhase, "idle">, string> = {
	preparing: t("summary.preparing"),
	"fetching-transcript": t("summary.fetchingTranscript"),
	"opening-youtube": t("summary.openingYouTube"),
	"reading-captions": t("summary.readingCaptions"),
	"waiting-for-ai": t("summary.waitingForAI"),
	generating: t("summary.generating"),
	saving: t("summary.saving"),
	preview: t("summary.generatingPreview"),
};

function getLocalizedAIError(error: AIServiceError): string {
	switch (error.type) {
		case "no_api_key": return t("summary.errorNoApiKey");
		case "invalid_key": return t("summary.errorInvalidApiKey");
		case "request_rejected": return t("summary.errorRequestRejected");
		case "rate_limit": return t("summary.errorRateLimit");
		case "transcript_error": return error.message;
		case "network_error": return t("summary.errorNetwork");
		default: return t("summary.errorUnknown");
	}
}

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
	actionsHost?: HTMLElement | null;
	onShowSummary?: () => void;
	initialSnapshot?: SummarySnapshot;
	onSnapshotChange?: (snapshot: SummarySnapshot) => void;
	autoGeneratePreview?: boolean;
	showSourceMetadata?: boolean;
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
	actionsHost,
	onShowSummary,
	initialSnapshot,
	onSnapshotChange,
	autoGeneratePreview = true,
	showSourceMetadata = true,
	presentation = "card",
}: SummarySectionProps) => {
	const plugin = usePlugin();
	const [summary, setSummaryValue] = useState<string | null>(initialSnapshot?.summary ?? null);
	const [summarySource, setSummarySource] = useState<SummarySource>(initialSnapshot?.source ?? 'video');
	const [summaryModel, setSummaryModel] = useState<string | undefined>(initialSnapshot?.model);
	const activeSourceRef = useRef<SummarySource>(summarySource);
	const [phase, setPhase] = useState<SummaryPhase>("idle");
	const isLoading = phase === "preparing" || phase === "fetching-transcript" || phase === "opening-youtube"
		|| phase === "reading-captions" || phase === "waiting-for-ai";
	const isStreaming = phase === "generating";
	const isBusy = phase !== "idle";
	const progressLabel = phase === "idle" ? "" : SUMMARY_PROGRESS_LABELS[phase];
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
			const rendered = el.createDiv();
			rendered.detach();
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
			setError(new AIServiceError("unknown", t("summary.errorLoadSaved")));
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
					onPhase: progressPhase => {
						if (!controller.signal.aborted) setPhase(progressPhase);
					},
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
			if (!result) throw new AIServiceError("unknown", t("summary.errorEmptyResponse"));
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
			new Notice(`${t("summary.savedInGeuloFor")} "${videoTitle}". ${t("summary.useAddToNote")}`, 5000);
		} catch (error: unknown) {
			if (controller.signal.aborted) return;
			if (streamingContentRef.current) {
				setSummary(streamingContentRef.current, activeSourceRef.current);
				setSaved(false);
			}
			debugLogger.error(`[AI Summary] Generation failed for ${videoId}`, error);
			setError(error instanceof AIServiceError ? error : new AIServiceError("unknown", t("summary.errorGenerate")));
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
				setError(new AIServiceError("unknown", t("summary.errorPreview")));
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
		if (!autoGeneratePreview || checkingCache || !summary || !isSaved || hasOneLiner !== false || error || !canGenerate
			|| isBusy || savingNote || requestPendingRef.current || autoPreviewAttemptedRef.current) return;
		void generateOneLiner();
	}, [autoGeneratePreview, checkingCache, summary, isSaved, hasOneLiner, error, canGenerate, isBusy, savingNote]);

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
				new Notice(t("summary.copyFailed"));
			});
			new Notice(t("summary.copied"));
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
			new Notice(t("summary.addToNoteFailed"));
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
		setError(new AIServiceError("unknown", lastActionRef.current === "preview" ? t("summary.previewCancelled") : t("summary.generationCancelled")));
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
		<span role="status">{progressLabel}</span>
		{!isExpanded && onShowSummary && <button type="button" className="summary-section__action-btn" onClick={onShowSummary}>{t("summary.view")}</button>}
		{phase !== "saving" && <button type="button" className="summary-section__cancel-btn" onClick={handleCancel} title={t("summary.cancelGeneration")}><Square size={10} aria-hidden="true" /><span>{t("summary.stop")}</span></button>}
	</div> : null;
	const progressPortal = progressHost ? createPortal(progress, progressHost) : null;
	if (!isExpanded) return progressPortal;

	return (
		<div className="summary-section" onClick={(e) => e.stopPropagation()} aria-busy={isBusy || checkingCache || savingNote}>
			{progressPortal ?? progress}
			{actionsHost && createPortal(<>
				<button type="button" aria-label={t("summary.copy")} title={t("summary.copy")}
					disabled={!summary || isBusy || checkingCache} onClick={handleCopy}><Copy size={16} aria-hidden="true" /></button>
				{onAddToNote && <button type="button" aria-label={savingNote ? t("summary.savingToNote") : t("summary.addToNote")}
					title={savingNote ? t("summary.savingToNote") : t("summary.addToVideoNote")} aria-busy={savingNote}
					disabled={!summary || isBusy || checkingCache || savingNote}
					onClick={event => void handleAddToNote(event)}><FileText size={16} aria-hidden="true" /></button>}
			</>, actionsHost)}
			{checkingCache && <p role="status">{t("summary.loadingSaved")}</p>}
			{!checkingCache && ((!summary && !isBusy && !error) || showLongVideoNotice) && <div className="summary-section__setup">
				{!summary && !isBusy && !error && <strong>{t("summary.noneYet")}</strong>}
				{!summary && !canGenerate && <p>{plugin.settings.enableAISummary ? t("summary.configureApiKey") : t("summary.enableInSettings")}</p>}
				{showLongVideoNotice && <p>{t("summary.longVideoWarning")}</p>}
				{!summary && !isBusy && !error && <button type="button" className="mod-cta" disabled={!canGenerate} onClick={() => void generateSummary()}>{t("summary.generate")}</button>}
			</div> }
			{(isLoading || (isStreaming && !streamingContent)) && (
				<div className="summary-section__skeleton" aria-hidden="true">
					{presentation === "reader" && <p>{progressLabel} {t("summary.mayTakeMoment")}</p>}
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--medium" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--short" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
				</div>
			)}

			{error && !isBusy && (
				<div className="summary-section__error" role="alert">
					<AlertCircle size={14} />
					<span>{getLocalizedAIError(error)}</span>
					{(error.type !== "no_api_key" || presentation === "reader") && (
						<button
							className="summary-section__retry-btn"
							disabled={lastActionRef.current !== "load" && !canGenerate}
							onClick={() => { void (lastActionRef.current === "load" ? loadSavedSummary() : lastActionRef.current === "preview" ? generateOneLiner() : generateSummary(true)); }}
						>
							{t("common.tryAgain")}
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
					{showSourceMetadata && <div className="summary-section__source">
						<span>{isSaved ? t("summary.savedInGeulo") : phase === "saving" ? t("summary.savingInGeulo") : t("summary.notSavedInGeulo")} · </span>
						{getLanguage() === 'ko'
							? (summarySource === 'transcript' ? t("summary.transcriptBased") : t("summary.videoBased"))
							: (summarySource === 'transcript' ? t("summary.transcriptBased") : t("summary.videoBased"))}
					</div>}
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
									<span>{t("summary.showMore")}</span>
									<ChevronDown size={14} />
								</>
							) : (
								<>
									<span>{t("summary.showLess")}</span>
									<ChevronUp size={14} />
								</>
							)}
						</button>
					)}
					{isSaved && <div className="summary-section__preview-option">
						<span>{hasOneLiner ? t("summary.previewSaved") : error || !autoGeneratePreview ? t("summary.previewNotSaved") : t("summary.previewAutomatic")}</span>
						<span>{t("summary.model")}: {summaryModel ?? t("filter.unknown")}</span>
					</div>}
					<div className="summary-section__actions">
						<div className="summary-section__left-actions">
							{onAddToNote && <button
								className="summary-section__action-btn"
								disabled={isBusy || checkingCache || savingNote}
								onClick={(event) => {
									void handleAddToNote(event);
								}}
								title={t("summary.addToVideoNote")}
							>
								<FileText size={14} />
								<span>{savingNote ? t("summary.savingToNote") : t("summary.addToNote")}</span>
							</button>}
							<button
								className="summary-section__action-btn"
								onClick={handleCopy}
								title={t("summary.copy")}
							>
								<Copy size={14} />
							</button>
						</div>
						<button
							className="summary-section__action-btn"
							onClick={handleRegenerate}
							disabled={!canGenerate || isBusy || savingNote}
							aria-label={t("summary.regenerate")}
							title={t("summary.regenerate")}
						>
							<RefreshCw size={14} />
						</button>
						<button
							className="summary-section__action-btn"
							onClick={presentation === "reader" ? onScrollToTop : () => setIsExpanded(false)}
							title={presentation === "reader" ? t("summary.scrollToTop") : t("summary.closeSection")}
							aria-label={presentation === "reader" ? t("summary.scrollToTop") : t("summary.closeSection")}
						>
							<ChevronUp size={14} />
						</button>
					</div>
				</>
			)}
		</div>
	);
};
