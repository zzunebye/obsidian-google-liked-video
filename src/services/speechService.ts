import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';
import type { SpeechSettings } from 'src/types';

const SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';
const REQUEST_TIMEOUT_MS = 90000;
const CHUNK_SIZE = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export class SpeechServiceError extends Error {
	constructor(public readonly code: 'settings' | 'cancelled' | 'timeout' | 'request' | 'audio', message: string) {
		super(message);
		this.name = 'SpeechServiceError';
	}
}

export function splitSpeechText(text: string): string[] {
	const chunks: string[] = [];
	let remaining = Array.from(text.trim());
	while (remaining.length > 0) {
		let end = Math.min(remaining.length, CHUNK_SIZE);
		if (end < remaining.length) {
			for (let index = end; index > CHUNK_SIZE / 2; index--) {
				if (/\s/.test(remaining[index - 1])) { end = index; break; }
			}
		}
		const chunk = remaining.slice(0, end).join('').trim();
		if (chunk) chunks.push(chunk);
		remaining = remaining.slice(end);
	}
	return chunks;
}

export function validateSpeechSettings(settings: SpeechSettings): void {
	if (settings.speechProvider !== 'openrouter' || !settings.speechApiKey.trim()
		|| !settings.speechModel.trim()) {
		throw new SpeechServiceError('settings', 'Configure the speech API key and model in Settings > Geulo > Speech.');
	}
}

export async function generateSpeech(text: string, settings: SpeechSettings, signal: AbortSignal): Promise<Blob> {
	if (signal.aborted) throw new SpeechServiceError('cancelled', 'Speech cancelled.');
	validateSpeechSettings(settings);
	const voice = settings.speechVoice.trim();
	const controller = new AbortController();
	let timedOut = false;
	const abort = (): void => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
	try {
		// requestUrl bypasses CORS but cannot abort the network request. Ignore late responses.
		const response = await new Promise<RequestUrlResponse>((resolve, reject) => {
			controller.signal.addEventListener('abort', () => reject(new SpeechServiceError(
				timedOut ? 'timeout' : 'cancelled', timedOut ? 'Speech generation timed out. Please try again.' : 'Speech cancelled.',
			)), { once: true });
			requestUrl({
				url: SPEECH_URL, method: 'POST', throw: false,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.speechApiKey.trim()}` },
				body: JSON.stringify({ model: settings.speechModel.trim(), input: text, ...(voice ? { voice } : {}), response_format: 'mp3' }),
			}).then(resolve, () => reject(new SpeechServiceError('request', 'Could not connect to OpenRouter speech. Please try again.')));
		});
		if (response.status < 200 || response.status >= 300) {
			let detail = '';
			try {
				const body: unknown = JSON.parse(response.text);
				if (isRecord(body)) {
					const error = body.error;
					if (isRecord(error) && typeof error.message === 'string') {
						detail = error.message.slice(0, 240);
					}
				}
			} catch { detail = ''; }
			const message = response.status === 401 ? 'Invalid speech API key. Check Settings > Geulo > Speech.'
				: response.status === 402 ? 'Insufficient OpenRouter credits for speech.'
					: response.status === 429 ? 'Speech rate limit reached. Please try again later.'
						: `OpenRouter speech request failed (${response.status})${detail ? `: ${detail}` : '.'}`;
			throw new SpeechServiceError('request', message);
		}
		const contentType = Object.entries(response.headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
		if (!/^(audio\/(mpeg|mp3)|application\/octet-stream)(;|$)/i.test(contentType) || !response.arrayBuffer.byteLength) {
			throw new SpeechServiceError('audio', 'OpenRouter did not return playable MP3 audio. Check the speech model and voice.');
		}
		return new Blob([response.arrayBuffer], { type: 'audio/mpeg' });
	} finally {
		window.clearTimeout(timer);
		signal.removeEventListener('abort', abort);
	}
}
