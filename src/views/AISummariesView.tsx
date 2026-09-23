import { Notice } from "obsidian";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, ExternalLink, MessageCircle } from "lucide-react";
import type { SummaryFileData, SummarySource, YouTubeVideo } from "src/types";
import { debugLogger } from "src/debug";
import { saveSummaryToNote } from "src/services/summaryNoteService";
import { SearchBar } from "src/ui/SearchBar";
import { SummarySection } from "src/ui/SummarySection";
import { SummarySpeechButton } from "src/ui/SummarySpeechButton";
import { VideoCommentsModal } from "src/ui/VideoCommentsModal";
import { ViewHeader } from "src/ui/ViewHeader";
import { usePlugin } from "../store/pluginContext";

type SummarySort = "newest" | "oldest" | "title" | "channel";
type SummarySourceFilter = "all" | SummarySource;

const SORT_OPTIONS: ReadonlyArray<{ value: SummarySort; label: string }> = [
	{ value: "newest", label: "Newest generated" },
	{ value: "oldest", label: "Oldest generated" },
	{ value: "title", label: "Title A–Z" },
	{ value: "channel", label: "Channel A–Z" },
];

const SOURCE_OPTIONS: ReadonlyArray<{ value: SummarySourceFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "transcript", label: "Transcript-based" },
	{ value: "video", label: "Video-based" },
];

function getSource(summary: SummaryFileData): SummarySource {
	return summary.source ?? "video";
}

function getTitle(summary: SummaryFileData): string {
	return summary.title.trim() || `YouTube video · ${summary.videoId}`;
}

function getChannel(summary: SummaryFileData): string {
	return summary.channelTitle.trim() || "Unknown channel";
}

function getPreview(summary: SummaryFileData): string {
	const preview = summary.oneLinerSummary?.trim() || summary.summary
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[#>*_`~|-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return preview.length > 140 ? `${preview.slice(0, 139).trimEnd()}…` : preview;
}

function formatGeneratedAt(generatedAt: string): string {
	const date = new Date(generatedAt);
	if (Number.isNaN(date.getTime())) return "Unknown date";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export const AISummariesView = () => {
	const plugin = usePlugin();
	const [summaries, setSummaries] = useState<SummaryFileData[]>(
		() => plugin.summaryStorage.getAllVideoSummaries(),
	);
	const [searchTerm, setSearchTerm] = useState("");
	const [sort, setSort] = useState<SummarySort>("newest");
	const [sourceFilter, setSourceFilter] = useState<SummarySourceFilter>("all");
	const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
	const [summaryBusy, setSummaryBusy] = useState(false);
	const [speechSummary, setSpeechSummary] = useState<string | null>(null);
	const summaryScrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => plugin.summaryStorage.subscribe(() => {
		setSummaries(plugin.summaryStorage.getAllVideoSummaries());
	}), [plugin.summaryStorage]);

	const visibleSummaries = useMemo(() => {
		const query = searchTerm.trim().toLocaleLowerCase();
		return summaries.filter(summary => {
			if (sourceFilter !== "all" && getSource(summary) !== sourceFilter) return false;
			if (!query) return true;
			return [getTitle(summary), getChannel(summary), summary.summary]
				.some(value => value.toLocaleLowerCase().includes(query));
		}).sort((left, right) => {
			if (sort === "newest") return right.generatedAt.localeCompare(left.generatedAt);
			if (sort === "oldest") return left.generatedAt.localeCompare(right.generatedAt);
			if (sort === "title") return compareText(getTitle(left), getTitle(right));
			return compareText(getChannel(left), getChannel(right));
		});
	}, [searchTerm, sort, sourceFilter, summaries]);

	const selectedSummary = selectedVideoId
		? summaries.find(summary => summary.videoId === selectedVideoId) ?? null
		: null;

	useEffect(() => {
		if (selectedVideoId && !summaries.some(summary => summary.videoId === selectedVideoId)) {
			setSelectedVideoId(null);
		}
	}, [selectedVideoId, summaries]);

	useEffect(() => {
		setSpeechSummary(selectedSummary?.summary ?? null);
		setSummaryBusy(false);
		summaryScrollRef.current?.scrollTo({ top: 0 });
	}, [selectedSummary?.videoId, selectedSummary?.summary]);

	const resolveVideo = async (summary: SummaryFileData): Promise<YouTubeVideo> => {
		const cached = plugin.likedVideoStorage?.getVideos().find(video => video.id === summary.videoId)
			?? plugin.subscriptionService.getSnapshot()?.videos.find(video => video.id === summary.videoId);
		return cached ?? plugin.likedVideoApi.fetchVideoById(summary.videoId);
	};

	const openVideo = async (summary: SummaryFileData): Promise<void> => {
		const url = summary.videoUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(summary.videoId)}`;
		try {
			if (!plugin.settings.openInObsidianWebViewer) {
				window.open(url, "_blank");
				return;
			}
			const leaf = plugin.app.workspace.getLeaf(
				plugin.settings.openWebViewerInSplitPane ? "split" : "tab",
			);
			await leaf.setViewState({
				type: "webviewer",
				state: { url, navigate: true },
				active: true,
			});
		} catch (error: unknown) {
			debugLogger.error("[AI summaries] Failed to open YouTube video", error);
			new Notice("Unable to open this video on YouTube. Please try again.");
		}
	};

	const hasActiveQuery = searchTerm.trim().length > 0 || sourceFilter !== "all";

	return (
		<div className="ai-summaries-view">
			<ViewHeader
				icon={<Bot className="video-view-header__icon" />}
				title="AI summaries"
				badge={`${summaries.length} saved`}
			/>
			<div className="ai-summaries-toolbar">
				<SearchBar
					searchTerm={searchTerm}
					onSearchTermChange={setSearchTerm}
					escapeClearsSearch
					ariaLabel="Search AI summaries"
					placeholder="Search titles, channels, and summaries…"
				/>
				<label className="ai-summaries-sort">
					<span>Sort</span>
					<select value={sort} onChange={event => setSort(event.target.value as SummarySort)}>
						{SORT_OPTIONS.map(option => (
							<option key={option.value} value={option.value}>{option.label}</option>
						))}
					</select>
				</label>
			</div>
			<div className="ai-summaries-source-filter" role="group" aria-label="Filter summaries by source">
				{SOURCE_OPTIONS.map(option => (
					<button key={option.value} type="button" aria-pressed={sourceFilter === option.value}
						onClick={() => setSourceFilter(option.value)}>
						{option.label}
					</button>
				))}
			</div>
			<div className="ai-summaries-result-count" aria-live="polite">
				{visibleSummaries.length} of {summaries.length} summaries
			</div>
			<div className={`ai-summaries-workspace${selectedSummary ? " ai-summaries-workspace--open" : ""}`}>
				<div className="ai-summaries-list" aria-label="Saved AI summaries">
					{visibleSummaries.length === 0 ? (
						<div className="ai-summaries-empty">
							<Bot size={32} aria-hidden="true" />
							<strong>{hasActiveQuery ? "No matching summaries" : "No saved AI summaries"}</strong>
							<span>{hasActiveQuery
								? "No summaries match the current search and filters."
								: "Summaries you generate in Geulo will appear here."}</span>
							{hasActiveQuery && <button type="button" onClick={() => {
								setSearchTerm("");
								setSourceFilter("all");
							}}>Clear search and filters</button>}
						</div>
					) : visibleSummaries.map(summary => {
						const title = getTitle(summary);
						const source = getSource(summary);
						return <button key={summary.videoId} type="button" className="ai-summary-list-item"
							aria-current={selectedVideoId === summary.videoId ? "true" : undefined}
							onClick={() => setSelectedVideoId(summary.videoId)}>
							<strong>{title}</strong>
							<span className="ai-summary-list-item__metadata">
								<span className="ai-summary-list-item__source">{source === "transcript" ? "Transcript-based" : "Video-based"}</span>
								<span>{getChannel(summary)}</span>
								<span aria-hidden="true">·</span>
								<time dateTime={summary.generatedAt}>{formatGeneratedAt(summary.generatedAt)}</time>
							</span>
							<span className="ai-summary-list-item__preview">{getPreview(summary)}</span>
						</button>;
					})}
				</div>
				<div className="ai-summaries-detail" aria-label="AI summary detail">
					{selectedSummary ? (
						<div className="ai-summary-reader">
							<header className="ai-summary-reader__header">
								<div className="ai-summary-reader__navigation">
									<button type="button" className="ai-summary-reader__back"
										onClick={() => setSelectedVideoId(null)}>
										<ArrowLeft size={16} aria-hidden="true" />
										All summaries
									</button>
									<div className="ai-summary-reader__header-actions">
										<button type="button" className="ai-summary-reader__action"
											title="Show comments" onClick={event => {
												const trigger = event.currentTarget;
												const modal = new VideoCommentsModal(
													plugin.app,
													selectedSummary.videoId,
													getTitle(selectedSummary),
													plugin.commentService,
													() => {
														if (trigger.isConnected) trigger.focus({ preventScroll: true });
													},
												);
												modal.open();
											}}>
											<MessageCircle size={14} aria-hidden="true" />
											<span>Comments</span>
										</button>
										<button type="button" className="ai-summary-reader__action"
											title="Open YouTube" onClick={() => void openVideo(selectedSummary)}>
											<ExternalLink size={14} aria-hidden="true" />
											<span>Open YouTube</span>
										</button>
										<SummarySpeechButton summary={speechSummary} disabled={summaryBusy} iconOnly />
									</div>
								</div>
								<h2>{getTitle(selectedSummary)}</h2>
								<div className="ai-summary-reader__metadata">
									<span>{getChannel(selectedSummary)}</span>
									<span aria-hidden="true">·</span>
									<time dateTime={selectedSummary.generatedAt}>{formatGeneratedAt(selectedSummary.generatedAt)}</time>
								</div>
							</header>
							<div ref={summaryScrollRef} className="ai-summary-reader__content"
								style={{ "--geulo-summary-line-height": String(plugin.settings.summaryLineHeight) } as React.CSSProperties}>
								<SummarySection
									key={selectedSummary.videoId}
									videoId={selectedSummary.videoId}
									videoTitle={getTitle(selectedSummary)}
									channelTitle={getChannel(selectedSummary)}
									channelId={selectedSummary.channelId}
									isExpanded
									setIsExpanded={() => undefined}
									presentation="reader"
									autoGeneratePreview={false}
									showSourceMetadata={false}
									initialSnapshot={{
										summary: selectedSummary.summary,
										source: getSource(selectedSummary),
										model: selectedSummary.model,
										saved: true,
										error: null,
										contentCollapsed: false,
									}}
									onAddToNote={async summary => {
										const video = await resolveVideo(selectedSummary);
										await saveSummaryToNote(plugin, video, summary);
									}}
									onBusyChange={setSummaryBusy}
									onScrollToTop={() => summaryScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
									onSnapshotChange={snapshot => setSpeechSummary(snapshot.summary)}
								/>
							</div>
						</div>
					) : (
						<div className="ai-summaries-detail-placeholder">
							<Bot size={32} aria-hidden="true" />
							<span>Select a summary to read it.</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
