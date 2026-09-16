import { getLanguage } from "obsidian";
import { useEffect, useState } from "react";
import { debugLogger } from "src/debug";
import { transcriptService, TranscriptServiceError } from "src/services/transcriptService";
import type { VideoTranscript } from "src/services/transcriptService";
import { usePlugin } from "src/store/pluginContext";

export type TranscriptState =
	| { kind: "loading" }
	| { kind: "loaded"; transcript: VideoTranscript }
	| { kind: "error"; message: string };

export function useVideoTranscript(videoId: string, initialTranscript?: VideoTranscript, enabled = true) {
	const plugin = usePlugin();
	const [preferredLanguage] = useState(() => plugin.settings.transcriptLanguage === "auto" ? getLanguage() : plugin.settings.transcriptLanguage);
	const [version, setVersion] = useState(0);
	const [state, setState] = useState<TranscriptState>(initialTranscript ? { kind: "loaded", transcript: initialTranscript } : { kind: "loading" });
	useEffect(() => {
		if (!enabled) return;
		if (version === 0 && initialTranscript?.videoId === videoId) {
			setState({ kind: "loaded", transcript: initialTranscript });
			return;
		}
		const controller = new AbortController();
		setState({ kind: "loading" });
		void transcriptService.getTranscript(videoId, controller.signal, preferredLanguage).then(
			(transcript) => { if (!controller.signal.aborted) setState({ kind: "loaded", transcript }); },
			(error: unknown) => {
				if (controller.signal.aborted) return;
				debugLogger.error("[Transcript] Fetch failed", videoId, error);
				setState({ kind: "error", message: error instanceof TranscriptServiceError ? error.message : "Could not fetch the transcript. Please try again." });
			},
		);
		return () => controller.abort();
	}, [videoId, initialTranscript, version, preferredLanguage, enabled]);
	return { state, retry: () => setVersion(value => value + 1) };
}
