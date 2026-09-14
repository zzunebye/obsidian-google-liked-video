import type { TranscriptSegment } from "src/services/transcriptService";

export interface TranscriptParagraph {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export function formatTranscriptTimestamp(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const remainder = (whole % 60).toString().padStart(2, "0");
	return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

// Keep the original words and timing. Caption fragments need not contain punctuation.
export function groupTranscriptSegments(segments: readonly TranscriptSegment[]): TranscriptParagraph[] {
	const paragraphs: TranscriptParagraph[] = [];
	let current: TranscriptParagraph | undefined;
	for (const segment of segments) {
		const text = segment.text.replace(/\s+/g, " ").trim();
		if (!text) continue;
		const gap = current ? segment.start - current.end : 0;
		const sentenceEnded = current && /[.!?。！？]["'”’)]?$/.test(current.text);
		if (current && (gap > 3 || segment.start - current.start >= 30 || current.text.length >= 500
			|| (sentenceEnded && segment.start - current.start >= 15))) {
			paragraphs.push(current);
			current = undefined;
		}
		current = {
			start: current?.start ?? segment.start,
			end: Math.max(current?.end ?? 0, segment.start + segment.duration),
			text: current ? `${current.text} ${text}` : text,
		};
	}
	if (current) paragraphs.push(current);
	return paragraphs;
}
