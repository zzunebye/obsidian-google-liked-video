import type { TranscriptSegment } from "src/services/transcriptService";

export type TranscriptDisplayMode = "paragraphs" | "original";
export type TranscriptReaderMode = TranscriptDisplayMode | "ai";

export interface TranscriptRow {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export function getTranscriptRows(segments: readonly TranscriptSegment[], mode: TranscriptDisplayMode): TranscriptRow[] {
	return mode === "original"
		? segments.map(segment => ({ start: segment.start, end: segment.start + segment.duration, text: segment.text }))
		: groupTranscriptSegments(segments);
}

export function formatTranscriptTimestamp(seconds: number): string {
	const whole = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const remainder = (whole % 60).toString().padStart(2, "0");
	return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

const MIN_SENTENCE_SECONDS = 12;
const MIN_SENTENCE_CHARACTERS = 160;
const TARGET_SECONDS = 30;
const TARGET_CHARACTERS = 500;
const MAX_SECONDS = 60;
const MAX_CHARACTERS = 800;
const PARAGRAPH_GAP_SECONDS = 2;
const TARGET_GAP_SECONDS = 0.75;

// Use caption boundaries only: keep words/timing intact and join each paragraph once.
export function groupTranscriptSegments(segments: readonly TranscriptSegment[]): TranscriptRow[] {
	const paragraphs: TranscriptRow[] = [];
	let parts: string[] = [];
	let start = 0;
	let end = 0;
	let characterCount = 0;
	let sentenceEnded = false;
	const flush = (): void => {
		if (parts.length === 0) return;
		paragraphs.push({ start, end, text: parts.join(" ") });
		parts = [];
		characterCount = 0;
		sentenceEnded = false;
	};
	for (const segment of segments) {
		const text = segment.text.replace(/\s+/g, " ").trim();
		if (!text) continue;
		if (parts.length > 0) {
			const elapsed = segment.start - start;
			const gap = segment.start - end;
			const sentenceBoundary = sentenceEnded && (elapsed >= MIN_SENTENCE_SECONDS || characterCount >= MIN_SENTENCE_CHARACTERS);
			const targetReached = elapsed >= TARGET_SECONDS || characterCount >= TARGET_CHARACTERS;
			const pauseBoundary = gap >= PARAGRAPH_GAP_SECONDS || (targetReached && gap >= TARGET_GAP_SECONDS);
			const limitReached = elapsed >= MAX_SECONDS || characterCount + 1 + text.length > MAX_CHARACTERS;
			if (sentenceBoundary || pauseBoundary || limitReached) flush();
		}
		if (parts.length === 0) { start = segment.start; end = segment.start; }
		characterCount += text.length + (parts.length > 0 ? 1 : 0);
		parts.push(text);
		end = Math.max(end, segment.start + segment.duration);
		sentenceEnded = /[.!?。！？…]["'”’»）)\]}]*$/.test(text);
	}
	flush();
	return paragraphs;
}
