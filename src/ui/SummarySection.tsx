import { useState, useEffect, useCallback, useRef } from "react";
import { Notice, MarkdownRenderer } from "obsidian";
import {
	Copy,
	RefreshCw,
	AlertCircle,
	ChevronUp,
} from "lucide-react";
import { GeminiService, GeminiError } from "../services/geminiService";
import { usePlugin } from "../store/pluginContext";
import { debugLogger } from "../debug";

interface SummarySectionProps {
	videoId: string;
	videoTitle: string;
	channelTitle: string;
	channelId: string;
	isExpanded: boolean;
	setIsExpanded: (expanded: boolean) => void;
	onSummaryGenerated: () => void;
}

export const SummarySection = ({
	videoId,
	videoTitle,
	channelTitle,
	channelId,
	isExpanded,
	setIsExpanded,
	onSummaryGenerated,
}: SummarySectionProps) => {
	const plugin = usePlugin();
	const [summary, setSummary] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<GeminiError | null>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = contentRef.current;
		if (!el || !summary) return;
		el.empty();
		MarkdownRenderer.render(plugin.app, summary, el, "", plugin);
		console.log("Rendered summary!");
	}, [summary, plugin, isExpanded]);

	const generateSummary = useCallback(
		async (forceRegenerate = false) => {
			if (isLoading) {
				debugLogger.debug(
					`[AI Summary] Skipping generation for ${videoId} - already loading`,
				);
				return;
			}

			if (!plugin.settings.geminiApiKey) {
				debugLogger.warn(
					`[AI Summary] No API key configured for video: ${videoId}`,
				);
				setError({
					type: "no_api_key",
					message:
						"Please configure your Gemini API key in Settings > AI Features",
				});
				return;
			}

			if (!forceRegenerate) {
				const cached = await plugin.summaryStorage.getVideoSummary(videoId);
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

			debugLogger.info(
				`[AI Summary] Starting generation for video: ${videoId}`,
			);
			setIsLoading(true);
			setError(null);

			try {
				const gemini = new GeminiService(plugin.settings.geminiApiKey);
				const result = await gemini.generateVideoSummary(
					videoId,
					plugin.settings.summaryPrompt,
				);
				debugLogger.info(
					`[AI Summary] Generation complete for video: ${videoId} - caching result`,
				);
				await plugin.summaryStorage.setVideoSummary(videoId, result, {
					title: videoTitle,
					channelTitle,
					channelId,
					videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
				});
				setSummary(result.summary);
				onSummaryGenerated();
				debugLogger.debug(
					`[AI Summary] State updated and parent notified for video: ${videoId}`,
				);
			} catch (err) {
				const geminiError = err as GeminiError;
				debugLogger.error(
					`[AI Summary] Generation failed for video ${videoId}: type=${geminiError.type}, message=${geminiError.message}`,
				);
				setError(geminiError);
			} finally {
				setIsLoading(false);
			}
		},
		[videoId, plugin, isLoading, onSummaryGenerated],
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

	if (!isExpanded) return null;

	return (
		<div className="summary-section" onClick={(e) => e.stopPropagation()}>
			{isLoading && (
				<div className="summary-section__skeleton">
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--medium" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--short" />
					<div className="summary-section__shimmer-line summary-section__shimmer-line--long" />
				</div>
			)}

			{error && !isLoading && (
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

			{summary && !isLoading && (
				<>
					<div
						className="summary-section__content"
						ref={contentRef}
					/>
					<div className="summary-section__actions">
						<div className="summary-section__left-actions">
							<button
								className="summary-section__action-btn"
								onClick={handleCopy}
								title="Copy summary"
							>
								<Copy size={14} />
								<span>Copy</span>
							</button>
							<button
								className="summary-section__action-btn"
								onClick={handleRegenerate}
								title="Regenerate summary"
							>
								<RefreshCw size={14} />
								<span>Regenerate</span>
							</button>
						</div>

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
