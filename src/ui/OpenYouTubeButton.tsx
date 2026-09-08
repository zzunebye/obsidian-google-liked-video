import { Notice } from "obsidian";
import { Search } from "lucide-react";
import { debugLogger } from "src/debug";
import { usePlugin } from "src/store/pluginContext";

export const OpenYouTubeButton = ({ query }: { query?: string }) => {
	const plugin = usePlugin();
	const openYouTube = async (): Promise<void> => {
		try {
			const url = query === undefined
				? "https://www.youtube.com/"
				: `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
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
			debugLogger.error("Failed to open YouTube:", error);
			new Notice("Unable to open YouTube. Please try again.");
		}
	};

	if (query !== undefined && !query.trim()) return null;
	const label = query === undefined ? "Open YouTube" : `Search YouTube for “${query.trim()}”`;

	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			className={query === undefined ? undefined : "youtube-search-button"}
			onClick={() => void openYouTube()}
		>
			<Search size={16} aria-hidden="true" />
			{query !== undefined && <span>{label}</span>}
		</button>
	);
};
