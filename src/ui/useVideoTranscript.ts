import { getLanguage } from "obsidian";
import { useEffect, useState } from "react";
import { debugLogger } from "src/debug";
import { TranscriptService, TranscriptServiceError } from "src/services/transcriptService";
import type { VideoTranscript } from "src/services/transcriptService";
import { usePlugin } from "src/store/pluginContext";

export type TranscriptState =
	| { kind: "loading" }
	| { kind: "loaded"; transcript: VideoTranscript }
	| { kind: "error"; message: string };

const service = new TranscriptService();

export function useVideoTranscript(videoId: string, initialTranscript?: VideoTranscript) {
	const plugin = usePlugin();
	const [preferredLanguage] = useState(() => plugin.settings.transcriptLanguage === "auto" ? getLanguage() : plugin.settings.transcriptLanguage);
	const [version, setVersion] = useState(0);
	const [state, setState] = useState<TranscriptState>(initialTranscript ? { kind: "loaded", transcript: initialTranscript } : { kind: "loading" });
	useEffect(() => {
		if (version === 0 && initialTranscript?.videoId === videoId) {
			setState({ kind: "loaded", transcript: initialTranscript });
			return;
		}
		const controller = new AbortController();
		setState({ kind: "loading" });
		void service.fetchTranscript(videoId, controller.signal, preferredLanguage).then(
			(transcript) => { if (!controller.signal.aborted) setState({ kind: "loaded", transcript }); },
			(error: unknown) => {
				if (controller.signal.aborted) return;
				debugLogger.error("[Transcript] Fetch failed", videoId, error);
				setState({ kind: "error", message: error instanceof TranscriptServiceError ? error.message : "Could not fetch the transcript. Please try again." });
			},
		);
		return () => controller.abort();
	}, [videoId, initialTranscript, version, preferredLanguage]);
	return { state, retry: () => setVersion(value => value + 1) };
}
