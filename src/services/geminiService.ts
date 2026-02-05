import { debugLogger } from '../debug';

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 90000;

export interface AIServiceResult {
	summary: string;
	generatedAt: string;
	model: string;
}

export interface AIServiceError {
	type: 'no_api_key' | 'invalid_key' | 'network_error' | 'rate_limit' | 'unknown';
	message: string;
}

export type StreamCallback = (chunk: string, accumulated: string) => void;

export interface StreamOptions {
	onChunk: StreamCallback;
	onComplete?: (result: AIServiceResult) => void;
	onError?: (error: AIServiceError) => void;
	signal?: AbortSignal;
}

export interface AIService {
	generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult>;
	generateVideoSummaryStream?(videoId: string, prompt: string, options: StreamOptions): Promise<void>;
}

// Keep old names as aliases for backwards compatibility with any external consumers
export type GeminiSummaryResult = AIServiceResult;
export type GeminiError = AIServiceError;

export class GeminiService implements AIService {
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
		debugLogger.debug(`[AI Summary] GeminiService initialized (model: ${GEMINI_MODEL})`);
	}

	/**
	 * Non-streaming summary generation. Internally uses streaming and collects all chunks.
	 */
	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		return new Promise((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				debugLogger.warn(`[AI Summary] Request timed out after ${REQUEST_TIMEOUT_MS}ms for video: ${videoId}`);
				controller.abort();
			}, REQUEST_TIMEOUT_MS);

			this.generateVideoSummaryStream(videoId, prompt, {
				onChunk: () => {}, // Ignore chunks for non-streaming
				onComplete: (result) => {
					clearTimeout(timeoutId);
					resolve(result);
				},
				onError: (error) => {
					clearTimeout(timeoutId);
					reject(error);
				},
				signal: controller.signal,
			}).catch((error) => {
				clearTimeout(timeoutId);
				reject(error);
			});
		});
	}

	/**
	 * Streaming summary generation with progressive chunk callbacks.
	 */
	async generateVideoSummaryStream(videoId: string, prompt: string, options: StreamOptions): Promise<void> {
		this.validateApiKey();

		const url = this.buildStreamUrl();
		const body = this.buildRequestBody(videoId, prompt);

		debugLogger.info(`[AI Summary] Starting streaming generation for video: ${videoId}`);
		debugLogger.debug(`[AI Summary] Streaming URL: ${url}`);
		debugLogger.time(`ai-summary-${videoId}`);

		let accumulated = '';

		try {
			const response = await this.executeRequest(url, body, options.signal);
			await this.handleHttpError(response, 'Gemini');

			const reader = response.body?.getReader();
			if (!reader) {
				this.throwAndNotify({ type: 'unknown', message: 'No response body for streaming' }, options.onError);
			}

			accumulated = await this.processSSEStream(reader!, options.onChunk, this.parseGeminiChunk);

			debugLogger.info(`[AI Summary] Streaming complete for video: ${videoId} (${accumulated.length} chars)`);
			options.onComplete?.(this.createResult(accumulated));
		} catch (error: any) {
			this.handleStreamError(error, accumulated, options, videoId);
		} finally {
			debugLogger.timeEnd(`ai-summary-${videoId}`);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Private Helpers
	// ─────────────────────────────────────────────────────────────────────────────

	private validateApiKey(): void {
		if (!this.apiKey) {
			debugLogger.warn('[AI Summary] No Gemini API key configured');
			throw { type: 'no_api_key', message: 'Gemini API key is not configured' } as AIServiceError;
		}
	}

	private buildStreamUrl(): string {
		return `${GEMINI_BASE_URL}/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
	}

	private buildRequestBody(videoId: string, prompt: string): object {
		const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
		return {
			contents: [{
				parts: [
					{ text: prompt },
					{ file_data: { file_uri: videoUrl } }
				]
			}]
		};
	}

	private async executeRequest(url: string, body: object, signal?: AbortSignal): Promise<Response> {
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': this.apiKey
			},
			body: JSON.stringify(body),
			signal
		});
	}

	private async handleHttpError(response: Response, serviceName: string): Promise<void> {
		if (response.ok) return;

		const errorData = await response.json().catch(() => ({}));
		const errorMessage = (errorData as any)?.error?.message || response.statusText;
		debugLogger.error(`[AI Summary] ${serviceName} API error: HTTP ${response.status} - ${errorMessage}`);

		let error: AIServiceError;
		if (response.status === 400 || response.status === 403) {
			error = { type: 'invalid_key', message: `Invalid API key: ${errorMessage}` };
		} else if (response.status === 429) {
			error = { type: 'rate_limit', message: 'Rate limit exceeded. Try again later.' };
		} else {
			error = { type: 'unknown', message: `HTTP ${response.status}: ${errorMessage}` };
		}
		throw error;
	}

	private async processSSEStream(
		reader: ReadableStreamDefaultReader<Uint8Array>,
		onChunk: StreamCallback,
		parseChunk: (jsonStr: string) => string | null
	): Promise<string> {
		const decoder = new TextDecoder();
		let buffer = '';
		let accumulated = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() || '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const jsonStr = line.slice(6).trim();
					if (!jsonStr || jsonStr === '[DONE]') continue;

					const text = parseChunk(jsonStr);
					if (text) {
						accumulated += text;
						onChunk(text, accumulated);
					}
				}
			}
		}

		return accumulated;
	}

	private parseGeminiChunk = (jsonStr: string): string | null => {
		try {
			const data = JSON.parse(jsonStr);
			return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
		} catch {
			debugLogger.debug(`[AI Summary] Failed to parse Gemini SSE chunk: ${jsonStr}`);
			return null;
		}
	};

	private createResult(summary: string): AIServiceResult {
		return {
			summary,
			generatedAt: new Date().toISOString(),
			model: GEMINI_MODEL
		};
	}

	private throwAndNotify(error: AIServiceError, onError?: (e: AIServiceError) => void): never {
		onError?.(error);
		throw error;
	}

	private handleStreamError(
		error: any,
		accumulated: string,
		options: StreamOptions,
		videoId: string
	): void {
		if (error?.name === 'AbortError') {
			debugLogger.info(`[AI Summary] Streaming aborted for video: ${videoId}`);
			if (accumulated) {
				options.onComplete?.(this.createResult(accumulated));
			}
			return;
		}

		if (!error?.type) {
			const wrappedError: AIServiceError = { type: 'network_error', message: error?.message || 'Network error' };
			options.onError?.(wrappedError);
			throw wrappedError;
		}

		options.onError?.(error);
		throw error;
	}
}
