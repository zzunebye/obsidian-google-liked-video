import { Component, Notice, MarkdownRenderer, getLanguage } from "obsidian";
import { useState, useEffect, useCallback, useRef } from "react";
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
import { confirmLongVideoSummary } from "../utils/confirmationUtils";
import type { SummarySource } from "../types";

const LONG_VIDEO_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

export interface SummarySnapshot {
	readonly summary: string | null;
	readonly source?: SummarySource;
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
	onPreviewUpdated?: () => void;
	regenerateTrigger?: number;
	videoDuration?: string; // ISO 8601 duration format (e.g., "PT1H30M")
	onBusyChange?: (busy: boolean) => void;
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
	onPreviewUpdated,
	regenerateTrigger,
	videoDuration,
	onBusyChange,
	initialSnapshot,
	onSnapshotChange,
	presentation = "card",
}: SummarySectionProps) => {
	const plugin = usePlugin();
	const [summary, setSummaryValue] = useState<string | null>(initialSnapshot?.summary ?? null);
	const [summarySource, setSummarySource] = useState<SummarySource>(initialSnapshot?.source ?? 'video');
	const activeSourceRef = useRef<SummarySource>(summarySource);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setErrorValue] = useState<AIServiceError | null>(initialSnapshot?.error ?? null);
	const [streamingContent, setStreamingContent] = useState<string>("");
	const streamingContentRef = useRef("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [isContentCollapsed, setContentCollapsedValue] = useState(initialSnapshot?.contentCollapsed ?? presentation === "card");
	const snapshotRef = useRef<SummarySnapshot>({ summary, source: summarySource, error, contentCollapsed: isContentCollapsed });
	const setSummary = (value: string | null, source: SummarySource) => {
		setSummaryValue(value);
		setSummarySource(source);
		const contentCollapsed = presentation === "card";
		setContentCollapsedValue(contentCollapsed);
		snapshotRef.current = { ...snapshotRef.current, summary: value, source, contentCollapsed };
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

	const generateOneLiner = useCallback(
		(fullSummary: string) => {
			try {
				const aiService = createAIService(plugin.settings);
				const prompt = `Condense the following video summary into a single concise sentence (max 120 chars). Return ONLY the sentence.\n\n${fullSummary}`;
				aiService
					.generateTextCompletion(prompt)
					.then(async (oneLiner) => {
						const trimmed = oneLiner.replace(/\s+/g, " ").trim();
						if (!trimmed) {
							throw new Error("One-liner completion returned no text");
						}
						await plugin.summaryStorage.setOneLinerSummary(videoId, trimmed);
						onPreviewUpdated?.();
					})
					.catch((err) => {
						debugLogger.warn(
							`[AI Summary] One-liner generation failed for ${videoId}:`,
							err,
						);
					});
			} catch (err) {
				debugLogger.warn(
					`[AI Summary] One-liner generation setup failed for ${videoId}:`,
					err,
				);
			}
		},
		[plugin, videoId, onPreviewUpdated],
	);

	const generateSummary = useCallback(
		async (forceRegenerate = false) => {
			if (requestPendingRef.current || isLoading || isStreaming) {
				debugLogger.debug(
					`[AI Summary] Skipping generation for ${videoId} - already loading/streaming`,
				);
				return;
			}

			requestPendingRef.current = true;
			setIsLoading(true);
			setError(null);
			onBusyChange?.(true);
			try {
				if (!forceRegenerate) {
					const cached =
						await plugin.summaryStorage.getVideoSummaryData(videoId);
					if (cached) {
						debugLogger.debug(
							`[AI Summary] Cache hit for video: ${videoId} (generated: ${cached.generatedAt})`,
						);
						setSummary(cached.summary, cached.source ?? 'video');
						if (!cached.oneLinerSummary?.trim() && plugin.settings.enableAISummary && getActiveApiKey(plugin.settings)) {
							generateOneLiner(cached.summary);
						}
						return;
					}
					debugLogger.debug(
						`[AI Summary] Cache miss for video: ${videoId}`,
					);
				} else {
					debugLogger.info(
						`[AI Summary] Force regenerating summary for video: ${videoId}`,
					);
				}

				if (presentation === "reader" && !plugin.settings.enableAISummary) {
					setError(new AIServiceError("unknown", "Enable AI summaries in Settings > AI Features to generate a summary."));
					return;
				}
				if (!getActiveApiKey(plugin.settings)) {
					setError(new AIServiceError("no_api_key", "Please configure your API key in Settings > AI Features"));
					return;
				}

				// Check if video is longer than 30 minutes and warn user
				if (plugin.settings.aiProvider === 'gemini' && videoDuration) {
					const durationSeconds = parseDurationToSeconds(videoDuration);
					if (
						durationSeconds &&
						durationSeconds > LONG_VIDEO_THRESHOLD_SECONDS
					) {
						const durationMinutes = durationSeconds / 60;
						debugLogger.info(
							`[AI Summary] Video ${videoId} is ${Math.round(durationMinutes)} minutes long - showing confirmation`,
						);
						const confirmed = await confirmLongVideoSummary(
							plugin.app,
							videoTitle,
							durationMinutes,
						);
						if (!confirmed) {
							debugLogger.info(
								`[AI Summary] User cancelled long video summary for: ${videoId}`,
							);
							setIsExpanded(false);
							return;
						}
					}
				}

				debugLogger.info(
					`[AI Summary] Starting generation for video: ${videoId}`,
				);
				setIsLoading(true);
				setError(null);
				setStreamingContent("");
				streamingContentRef.current = "";

				try {
					const aiService = createAIService(plugin.settings);
					activeSourceRef.current = plugin.settings.aiProvider === 'gemini' ? 'video' : 'transcript';

					// Check if streaming is supported
					if (aiService.generateVideoSummaryStream) {
						debugLogger.info(
							`[AI Summary] Using streaming mode for video: ${videoId}`,
						);

						const abortController = new AbortController();
						abortControllerRef.current = abortController;
						setIsStreaming(true);
						setIsLoading(false); // Hide skeleton once streaming starts
						let completion: Promise<void> | undefined;

						await aiService.generateVideoSummaryStream(
							videoId,
							plugin.settings.summaryPrompt,
							{
								onChunk: (_chunk: string, accumulated: string) => {
									if (abortController.signal.aborted) return;
									streamingContentRef.current = accumulated;
									setStreamingContent(accumulated);
								},
								onComplete: (result: AIServiceResult) => {
									if (abortController.signal.aborted) return;
									completion = (async () => {
										debugLogger.info(
											`[AI Summary] Streaming complete for video: ${videoId} - caching result`,
										);
										await plugin.summaryStorage.setVideoSummary(
											videoId,
											result,
											{
												title: videoTitle,
												channelTitle,
												channelId,
												videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
											},
										);
										setSummary(result.summary, result.source);
										setStreamingContent("");
										streamingContentRef.current = "";
										setIsStreaming(false);
										abortControllerRef.current = null;
										onSummaryGenerated?.();
										generateOneLiner(result.summary);
										new Notice(
											`AI summary generated for "${videoTitle}"`,
											5000,
										);
									})();
								},
								onError: (err: AIServiceError) => {
									if (abortController.signal.aborted) return;
									debugLogger.error(
										`[AI Summary] Streaming failed for video ${videoId}: type=${err.type}, message=${err.message}`,
									);
									setError(err);
									setIsStreaming(false);
									abortControllerRef.current = null;
								},
								signal: abortController.signal,
							},
						);
						await completion;
					} else {
						// Fallback to non-streaming
						const result = await aiService.generateVideoSummary(
							videoId,
							plugin.settings.summaryPrompt,
						);
						debugLogger.info(
							`[AI Summary] Generation complete for video: ${videoId} - caching result`,
						);
						await plugin.summaryStorage.setVideoSummary(
							videoId,
							result,
							{
								title: videoTitle,
								channelTitle,
								channelId,
								videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
							},
						);
						setSummary(result.summary, result.source);
						onSummaryGenerated?.();
						generateOneLiner(result.summary);
						new Notice(
							`AI summary generated for "${videoTitle}"`,
							5000,
						);
						debugLogger.debug(
							`[AI Summary] State updated and parent notified for video: ${videoId}`,
						);
					}
				} catch (err) {
					const aiError = err instanceof AIServiceError
						? err
						: new AIServiceError(
							"unknown",
							err instanceof Error ? err.message : "Unknown error",
						);
					debugLogger.error(
						`[AI Summary] Generation failed for video ${videoId}: type=${aiError.type}, message=${aiError.message}`,
					);
					// If we have partial streaming content on error, keep it visible
					if (streamingContentRef.current) {
						setSummary(streamingContentRef.current, activeSourceRef.current);
						setStreamingContent("");
						streamingContentRef.current = "";
					}
					setError(aiError);
				} finally {
					abortControllerRef.current = null;
					setIsLoading(false);
					setIsStreaming(false);
				}
			} catch (err: unknown) {
				debugLogger.error(`[AI Summary] Could not load summary for ${videoId}`, err);
				setError(err instanceof AIServiceError ? err : new AIServiceError("unknown", "Could not load the summary. Please try again."));
			} finally {
				setIsLoading(false);
				requestPendingRef.current = false;
				onBusyChange?.(false);
			}
		},
		[
			videoId,
			plugin,
			isLoading,
			isStreaming,
			onSummaryGenerated,
			generateOneLiner,
			videoTitle,
			channelTitle,
			channelId,
			videoDuration,
			presentation,
		],
	);

	useEffect(() => {
		if (isExpanded && !summary && !isLoading && !error) {
			debugLogger.debug(
				`[AI Summary] Section expanded for video: ${videoId} - triggering auto-generation`,
			);
			void generateSummary();
		} else if (isExpanded) {
			debugLogger.debug(
				`[AI Summary] Section expanded for video: ${videoId} - state: summary=${!!summary}, loading=${isLoading}, error=${!!error}`,
			);
		}
	}, [isExpanded]);

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
		if (!summary) return;
		try {
			await onAddToNote?.(summary);
		} catch (err) {
			console.error("Failed to add summary to note:", err);
			new Notice("Failed to add summary to note");
		}
	};

	const handleCancel = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			debugLogger.info(
				`[AI Summary] User cancelled streaming for video: ${videoId}`,
			);
			abortControllerRef.current?.abort();
			setIsStreaming(false);
			setIsLoading(false);
			// Keep streaming content visible if any was received
			if (streamingContentRef.current) {
				setSummary(streamingContentRef.current, activeSourceRef.current);
				setStreamingContent("");
				streamingContentRef.current = "";
			}
			setError(new AIServiceError("unknown", "Summary cancelled. Retry when ready."));
		},
		[videoId],
	);

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

	if (!isExpanded) return null;

	return (
		<div className="summary-section" onClick={(e) => e.stopPropagation()} aria-busy={isLoading || isStreaming}>
			{(isLoading || (isStreaming && !streamingContent)) && (
				<div className="summary-section__skeleton" role="status" aria-label="Loading AI summary">
					{presentation === "reader" && <p>Preparing AI summary… This may take a moment.</p>}
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--medium" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--short" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
				</div>
			)}

			{error && !isLoading && !isStreaming && (
				<div className="summary-section__error" role="alert">
					<AlertCircle size={14} />
					<span>{error.message}</span>
					{(error.type !== "no_api_key" || presentation === "reader") && (
						<button
							className="summary-section__retry-btn"
							onClick={handleRegenerate}
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
					<div className="summary-section__streaming-indicator">
						<div className="summary-section__streaming-dot" />
						<span>Generating...</span>
						<button
							className="summary-section__cancel-btn"
							onClick={handleCancel}
							title="Cancel generation"
						>
							<Square size={10} />
							<span>Stop</span>
						</button>
					</div>
				</>
			)}

			{summary && !isLoading && !isStreaming && (
				<>
					<div className="summary-section__source">
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
					<div className="summary-section__actions">
						<div className="summary-section__left-actions">
							{onAddToNote && <button
								className="summary-section__action-btn"
								onClick={(event) => {
									void handleAddToNote(event);
								}}
								title="Add summary to video note"
							>
								<FileText size={14} />
								<span>Add to Note</span>
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
							title="Regenerate summary"
						>
							<RefreshCw size={14} />
						</button>
						<button
							className="summary-section__action-btn"
							onClick={() => {
								return setIsExpanded(false);
							}}
							title="Close summary section"
						>
							<ChevronUp size={14} />
						</button>
					</div>
				</>
			)}
		</div>
	);
};
