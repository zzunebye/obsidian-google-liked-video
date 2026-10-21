import { Notice } from "obsidian";
import { debugLogger } from "src/debug";
import { usePlugin } from "src/store/pluginContext";
import { t } from "../i18n";
import type { YouTubeVideo } from "src/types";

export function YouTubeChannelButton({ video }: { readonly video: YouTubeVideo }) {
	const plugin = usePlugin();
	const openChannel = async (ownerWindow: Window): Promise<void> => {
		const url = `https://www.youtube.com/channel/${encodeURIComponent(video.snippet.channelId)}`;
		try {
			if (!plugin.settings.openInObsidianWebViewer) {
				ownerWindow.open(url, "_blank", "noopener,noreferrer");
				return;
			}
			const leaf = plugin.app.workspace.getLeaf(plugin.settings.openWebViewerInSplitPane ? "split" : "tab");
			await leaf.setViewState({ type: "webviewer", state: { url, navigate: true }, active: true });
		} catch (error: unknown) {
			debugLogger.error("Failed to open YouTube channel:", error);
			new Notice(t("youtube.openChannelFailed"));
		}
	};

	return <button type="button" className="geulo-channel-button"
		onClick={event => void openChannel(event.currentTarget.ownerDocument.defaultView ?? window)}>
		{video.snippet.channelTitle}
	</button>;
}
