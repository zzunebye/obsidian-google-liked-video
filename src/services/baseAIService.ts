import { debugLogger } from '../debug';
import { AIService, AIServiceResult, AIServiceError, StreamOptions, StreamCallback } from './geminiService';

const REQUEST_TIMEOUT_MS = 90000;

export abstract class BaseAIService implements AIService {
	protected abstract serviceName: string;
	protected abstract apiKey: string;

	protected abstract getModel(): string;
	protected abstract buildStreamUrl(): string;
	protected abstract buildRequestBody(videoId: string, prompt: string): object;
	protected abstract executeRequest(url: string, body: object, signal?: AbortSignal): Promise<Response>;
	protected abstract parseChunk(jsonStr: string): string | null;
	protected abstract mapHttpStatusToError(status: number, message: string): AIServiceError;

	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		return new Promise((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				debugLogger.warn(`[AI Summary] Request timed out after ${REQUEST_TIMEOUT_MS}ms for video: ${videoId}`);
				controller.abort();
			}, REQUEST_TIMEOUT_MS);

			this.generateVideoSummaryStream(videoId, prompt, {
				onChunk: () => {},
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

	async generateVideoSummaryStream(videoId: string, prompt: string, options: StreamOptions): Promise<void> {
		this.validateApiKey(options.onError);

		const url = this.buildStreamUrl();
		const body = this.buildRequestBody(videoId, prompt);

		debugLogger.info(`[AI Summary] Starting streaming generation via ${this.serviceName} for video: ${videoId}`);
		debugLogger.debug(`[AI Summary] Model: ${this.getModel()}`);
		debugLogger.time(`ai-summary-${videoId}`);

		let accumulated = '';

		try {
			const response = await this.executeRequest(url, body, options.signal);
			await this.handleHttpError(response, options.onError);

			const reader = response.body?.getReader();
			if (!reader) {
				return this.throwAndNotify({ type: 'unknown', message: 'No response body for streaming' }, options.onError);
			}

			accumulated = await this.processSSEStream(reader, options.onChunk, (jsonStr) => this.parseChunk(jsonStr));

			debugLogger.info(`[AI Summary] ${this.serviceName} streaming complete for video: ${videoId} (${accumulated.length} chars)`);
			options.onComplete?.(this.createResult(accumulated));
		} catch (error: any) {
			this.handleStreamError(error, accumulated, options, videoId);
		} finally {
			debugLogger.timeEnd(`ai-summary-${videoId}`);
		}
	}

	protected validateApiKey(onError?: (e: AIServiceError) => void): void {
		if (!this.apiKey) {
			const error: AIServiceError = {
				type: 'no_api_key',
				message: `${this.serviceName} API key is not configured`
			};
			debugLogger.warn(`[AI Summary] No ${this.serviceName} API key configured`);
			onError?.(error);
			throw error;
		}
	}

	protected async handleHttpError(response: Response, onError?: (e: AIServiceError) => void): Promise<void> {
		if (response.ok) return;

		const errorData = await response.json().catch(() => ({}));
		const errorMessage = (errorData as any)?.error?.message || response.statusText;
		debugLogger.error(`[AI Summary] ${this.serviceName} API error: HTTP ${response.status} - ${errorMessage}`);

		const error = this.mapHttpStatusToError(response.status, errorMessage);
		onError?.(error);
		throw error;
	}

	protected async processSSEStream(
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

	protected createResult(summary: string): AIServiceResult {
		return {
			summary,
			generatedAt: new Date().toISOString(),
			model: this.getModel()
		};
	}

	protected throwAndNotify(error: AIServiceError, onError?: (e: AIServiceError) => void): never {
		onError?.(error);
		throw error;
	}

	protected handleStreamError(
		error: any,
		accumulated: string,
		options: StreamOptions,
		videoId: string
	): void {
		if (error?.name === 'AbortError') {
			debugLogger.info(`[AI Summary] ${this.serviceName} streaming aborted for video: ${videoId}`);
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
