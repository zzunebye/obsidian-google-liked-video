import { useState, useEffect, useCallback, useRef } from "react";
import { Notice, MarkdownRenderer } from "obsidian";
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
import { parseDurationToSeconds } from "./VideoInfoModal";
import { confirmLongVideoSummary } from "../utils/confirmationUtils";

const LONG_VIDEO_THRESHOLD_SECONDS = 30 * 60; // 30 minutes

interface SummarySectionProps {
	videoId: string;
	videoTitle: string;
	channelTitle: string;
	channelId: string;
	isExpanded: boolean;
	setIsExpanded: (expanded: boolean) => void;
	onSummaryGenerated: () => void;
	onAddToNote: (summary: string) => Promise<void>;
	onPreviewUpdated?: () => void;
	regenerateTrigger?: number;
	videoDuration?: string; // ISO 8601 duration format (e.g., "PT1H30M")
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
}: SummarySectionProps) => {
	const plugin = usePlugin();
	const [summary, setSummary] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<AIServiceError | null>(null);
	const [streamingContent, setStreamingContent] = useState<string>("");
	const [isStreaming, setIsStreaming] = useState(false);
	const [isContentCollapsed, setIsContentCollapsed] = useState(true);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const el = contentRef.current;
		const contentToRender = streamingContent || summary;
		if (!el || !contentToRender) return;

		// Debounce rendering during streaming to reduce flicker
		if (renderTimeoutRef.current) {
			clearTimeout(renderTimeoutRef.current);
		}

		const delay = isStreaming ? 100 : 0;
		renderTimeoutRef.current = setTimeout(() => {
			el.empty();
			MarkdownRenderer.render(
				plugin.app,
				contentToRender,
				el,
				"",
				plugin,
			);
		}, delay);

		return () => {
			if (renderTimeoutRef.current) {
				clearTimeout(renderTimeoutRef.current);
			}
		};
	}, [summary, streamingContent, plugin, isExpanded, isStreaming]);

	// Measure content overflow after markdown rendering completes
	useEffect(() => {
		if (!summary || isStreaming || !contentRef.current) return;
		const timer = setTimeout(() => {
			if (contentRef.current) {
				setIsOverflowing(contentRef.current.scrollHeight > 300);
			}
		}, 50);
		return () => clearTimeout(timer);
	}, [summary, isStreaming]);

	// Reset collapsed state when summary changes
	useEffect(() => {
		setIsContentCollapsed(true);
	}, [summary]);

	const generateOneLiner = useCallback(
		(fullSummary: string) => {
			try {
				const aiService = createAIService(plugin.settings);
				const prompt = `Condense the following video summary into a single concise sentence (max 120 chars). Return ONLY the sentence.\n\n${fullSummary}`;
				aiService
					.generateTextCompletion(prompt)
					.then((oneLiner) => {
						const trimmed = oneLiner.trim();
						if (trimmed) {
							plugin.summaryStorage.setOneLinerSummary(
								videoId,
								trimmed,
							);
							onPreviewUpdated?.();
						}
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
			if (isLoading || isStreaming) {
				debugLogger.debug(
					`[AI Summary] Skipping generation for ${videoId} - already loading/streaming`,
				);
				return;
			}

			if (!getActiveApiKey(plugin.settings)) {
				debugLogger.warn(
					`[AI Summary] No API key configured for video: ${videoId}`,
				);
				setError({
					type: "no_api_key",
					message:
						"Please configure your API key in Settings > AI Features",
				});
				return;
			}

			if (!forceRegenerate) {
				const cached =
					await plugin.summaryStorage.getVideoSummaryData(videoId);
				if (cached) {
					debugLogger.debug(
						`[AI Summary] Cache hit for video: ${videoId} (generated: ${cached.generatedAt})`,
					);
					setSummary(cached.summary);
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

			// Check if video is longer than 30 minutes and warn user
			if (videoDuration) {
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

			try {
				const aiService = createAIService(plugin.settings);

				// Check if streaming is supported
				if (aiService.generateVideoSummaryStream) {
					debugLogger.info(
						`[AI Summary] Using streaming mode for video: ${videoId}`,
					);

					const abortController = new AbortController();
					abortControllerRef.current = abortController;
					setIsStreaming(true);
					setIsLoading(false); // Hide skeleton once streaming starts

					await aiService.generateVideoSummaryStream(
						videoId,
						plugin.settings.summaryPrompt,
						{
							onChunk: (_chunk: string, accumulated: string) => {
								setStreamingContent(accumulated);
							},
							onComplete: async (result: AIServiceResult) => {
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
								setSummary(result.summary);
								setStreamingContent("");
								setIsStreaming(false);
								abortControllerRef.current = null;
								onSummaryGenerated();
								generateOneLiner(result.summary);
								new Notice(
									`AI summary generated for "${videoTitle}"`,
									5000,
								);
							},
							onError: (err: AIServiceError) => {
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
					setSummary(result.summary);
					onSummaryGenerated();
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
				const aiError = err as AIServiceError;
				debugLogger.error(
					`[AI Summary] Generation failed for video ${videoId}: type=${aiError.type}, message=${aiError.message}`,
				);
				// If we have partial streaming content on error, keep it visible
				if (streamingContent) {
					setSummary(streamingContent);
					setStreamingContent("");
				}
				setError(aiError);
			} finally {
				setIsLoading(false);
				setIsStreaming(false);
			}
		},
		[
			videoId,
			plugin,
			isLoading,
			isStreaming,
			onSummaryGenerated,
			generateOneLiner,
			streamingContent,
			videoTitle,
			channelTitle,
			channelId,
			videoDuration,
		],
	);

	useEffect(() => {
		if (isExpanded && !summary && !isLoading && !error) {
			debugLogger.debug(
				`[AI Summary] Section expanded for video: ${videoId} - triggering auto-generation`,
			);
			generateSummary();
		} else if (isExpanded) {
			debugLogger.debug(
				`[AI Summary] Section expanded for video: ${videoId} - state: summary=${!!summary}, loading=${isLoading}, error=${!!error}`,
			);
		}
	}, [isExpanded]);

	useEffect(() => {
		if (regenerateTrigger && regenerateTrigger > 0) {
			generateSummary(true);
		}
	}, [regenerateTrigger]);

	const handleCopy = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (summary) {
			navigator.clipboard.writeText(summary);
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
		generateSummary(true);
	};

	const handleAddToNote = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!summary) return;
		try {
			await onAddToNote(summary);
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
			if (streamingContent) {
				setSummary(streamingContent);
				setStreamingContent("");
			}
		},
		[videoId, streamingContent],
	);

	const handleToggleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsContentCollapsed((prev) => !prev);
	};

	// Cleanup abort controller on unmount
	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	if (!isExpanded) return null;

	return (
		<div className="summary-section" onClick={(e) => e.stopPropagation()}>
			{(isLoading || (isStreaming && !streamingContent)) && (
				<div className="summary-section__skeleton">
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--medium" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--short" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
				</div>
			)}

			{error && !isLoading && !isStreaming && (
				<div className="summary-section__error">
					<AlertCircle size={14} />
					<span>{error.message}</span>
					{error.type !== "no_api_key" && (
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
					<div className="summary-section__fade-overlay">
						<div
							className="summary-section__content summary-section__content--collapsed"
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
					{isOverflowing && (
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
							<button
								className="summary-section__action-btn"
								onClick={handleAddToNote}
								title="Add summary to video note"
							>
								<FileText size={14} />
								<span>Add to Note</span>
							</button>
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
