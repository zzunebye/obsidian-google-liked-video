import { debugLogger } from '../debug';
import { AIService, AIServiceResult, AIServiceError, StreamOptions, StreamCallback } from './geminiService';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 90000;

export class OpenRouterService implements AIService {
	private apiKey: string;
	private model: string;

	constructor(apiKey: string, model: string) {
		this.apiKey = apiKey;
		this.model = model;
		debugLogger.debug(`[AI Summary] OpenRouterService initialized (model: ${this.model})`);
	}

	/**
	 * Non-streaming summary generation. Internally uses streaming and collects all chunks.
	 */
	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		return new Promise((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				debugLogger.warn(`[AI Summary] OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms for video: ${videoId}`);
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

		const body = this.buildRequestBody(videoId, prompt);

		debugLogger.info(`[AI Summary] Starting streaming generation via OpenRouter for video: ${videoId}`);
		debugLogger.debug(`[AI Summary] Model: ${this.model}`);
		debugLogger.time(`ai-summary-${videoId}`);

		let accumulated = '';

		try {
			const response = await this.executeRequest(body, options.signal);
			await this.handleHttpError(response);

			const reader = response.body?.getReader();
			if (!reader) {
				this.throwAndNotify({ type: 'unknown', message: 'No response body for streaming' }, options.onError);
			}

			accumulated = await this.processSSEStream(reader!, options.onChunk, this.parseOpenRouterChunk);

			debugLogger.info(`[AI Summary] OpenRouter streaming complete for video: ${videoId} (${accumulated.length} chars)`);
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
			debugLogger.warn('[AI Summary] No OpenRouter API key configured');
			throw { type: 'no_api_key', message: 'OpenRouter API key is not configured' } as AIServiceError;
		}
	}

	private buildRequestBody(videoId: string, prompt: string): object {
		const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
		return {
			model: this.model,
			stream: true,
			messages: [{
				role: 'user',
				content: [
					{ type: 'text', text: prompt },
					{ type: 'video_url', video_url: { url: videoUrl } }
				]
			}]
		};
	}

	private async executeRequest(body: object, signal?: AbortSignal): Promise<Response> {
		return fetch(OPENROUTER_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
			signal
		});
	}

	private async handleHttpError(response: Response): Promise<void> {
		if (response.ok) return;

		const errorData = await response.json().catch(() => ({}));
		const errorMessage = (errorData as any)?.error?.message || response.statusText;
		debugLogger.error(`[AI Summary] OpenRouter API error: HTTP ${response.status} - ${errorMessage}`);

		let error: AIServiceError;
		if (response.status === 401 || response.status === 403) {
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

	private parseOpenRouterChunk = (jsonStr: string): string | null => {
		try {
			const data = JSON.parse(jsonStr);
			return data?.choices?.[0]?.delta?.content || null;
		} catch {
			debugLogger.debug(`[AI Summary] Failed to parse OpenRouter SSE chunk: ${jsonStr}`);
			return null;
		}
	};

	private createResult(summary: string): AIServiceResult {
		return {
			summary,
			generatedAt: new Date().toISOString(),
			model: this.model
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
			debugLogger.info(`[AI Summary] OpenRouter streaming aborted for video: ${videoId}`);
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
