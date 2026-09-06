import { requestUrl } from 'obsidian';
import { debugLogger } from '../debug';
import { AIService, AIServiceResult, StreamOptions, StreamCallback } from './geminiService';
import { AIServiceError, toAIServiceError } from './aiServiceError';

const REQUEST_TIMEOUT_MS = 90000;
const TEXT_COMPLETION_TIMEOUT_MS = 30000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function getApiErrorMessage(responseBody: unknown, fallback: string): string {
	if (!isRecord(responseBody) || !isRecord(responseBody.error)) return fallback;
	return typeof responseBody.error.message === 'string'
		? responseBody.error.message
		: fallback;
}

function isAIServiceError(error: unknown): error is AIServiceError {
	return error instanceof AIServiceError;
}

export abstract class BaseAIService implements AIService {
	protected abstract serviceName: string;
	protected abstract apiKey: string;

	protected abstract getModel(): string;
	protected abstract buildStreamUrl(): string;
	protected abstract buildRequestBody(videoId: string, prompt: string): object;
	protected abstract buildRequestHeaders(): Record<string, string>;
	protected abstract parseChunk(jsonStr: string): string | null;
	protected abstract mapHttpStatusToError(status: number, message: string): AIServiceError;
	protected abstract buildTextCompletionUrl(): string;
	protected abstract buildTextCompletionBody(prompt: string): object;
	protected abstract parseTextCompletionResponse(data: unknown): string;

	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		return new Promise((resolve, reject) => {
			const controller = new AbortController();
			const timeoutId = window.setTimeout(() => {
				debugLogger.warn(`[AI Summary] Request timed out after ${REQUEST_TIMEOUT_MS}ms for video: ${videoId}`);
				controller.abort();
			}, REQUEST_TIMEOUT_MS);

			this.generateVideoSummaryStream(videoId, prompt, {
				onChunk: () => {},
				onComplete: (result) => {
					window.clearTimeout(timeoutId);
					resolve(result);
				},
				onError: (error) => {
					window.clearTimeout(timeoutId);
					reject(error);
				},
				signal: controller.signal,
			}).catch((error) => {
				window.clearTimeout(timeoutId);
				reject(toAIServiceError(error));
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
				return this.throwAndNotify(
					new AIServiceError('unknown', 'No response body for streaming'),
					options.onError,
				);
			}

			accumulated = await this.processSSEStream(reader, options.onChunk, (jsonStr) => this.parseChunk(jsonStr));

			debugLogger.info(`[AI Summary] ${this.serviceName} streaming complete for video: ${videoId} (${accumulated.length} chars)`);
			options.onComplete?.(this.createResult(accumulated));
		} catch (error: unknown) {
			this.handleStreamError(error, accumulated, options, videoId);
		} finally {
			debugLogger.timeEnd(`ai-summary-${videoId}`);
		}
	}

	async generateTextCompletion(prompt: string): Promise<string> {
		this.validateApiKey();

		const url = this.buildTextCompletionUrl();
		const body = this.buildTextCompletionBody(prompt);
		const controller = new AbortController();
		const timeoutId = window.setTimeout(() => controller.abort(), TEXT_COMPLETION_TIMEOUT_MS);

		try {
			const response = await this.executeRequest(url, body, controller.signal);
			window.clearTimeout(timeoutId);

			if (!response.ok) {
				const errorData: unknown = await response.json().catch(() => ({}));
				const errorMessage = getApiErrorMessage(errorData, response.statusText);
				throw this.mapHttpStatusToError(response.status, errorMessage);
			}

			const data: unknown = await response.json();
			return this.parseTextCompletionResponse(data);
		} catch (error: unknown) {
			window.clearTimeout(timeoutId);
			if (isAbortError(error)) {
				const timeoutError = new AIServiceError(
					'network_error',
					'Text completion request timed out',
				);
				throw timeoutError;
			}
			throw toAIServiceError(error);
		}
	}

	protected executeRequest(url: string, body: object, signal?: AbortSignal): Promise<Response> {
		const request = requestUrl({
			url,
			method: 'POST',
			headers: this.buildRequestHeaders(),
			body: JSON.stringify(body),
			throw: false,
		}).then((response) => new Response(response.text, {
			status: response.status,
			headers: response.headers,
		}));

		if (!signal) return request;
		if (signal.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));

		return new Promise((resolve, reject) => {
			const abort = () => reject(new DOMException('Request aborted', 'AbortError'));
			signal.addEventListener('abort', abort, { once: true });
			void request.then(
				(response) => {
					signal.removeEventListener('abort', abort);
					resolve(response);
				},
					(error: unknown) => {
						signal.removeEventListener('abort', abort);
						reject(toAIServiceError(error));
					}
			);
		});
	}

	protected validateApiKey(onError?: (e: AIServiceError) => void): void {
		if (!this.apiKey) {
			const error = new AIServiceError(
				'no_api_key',
				`${this.serviceName} API key is not configured`,
			);
			debugLogger.warn(`[AI Summary] No ${this.serviceName} API key configured`);
			onError?.(error);
			throw error;
		}
	}

	protected async handleHttpError(response: Response, onError?: (e: AIServiceError) => void): Promise<void> {
		if (response.ok) return;

		const errorData: unknown = await response.json().catch(() => ({}));
		const errorMessage = getApiErrorMessage(errorData, response.statusText);
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

		let streamDone = false;
		while (!streamDone) {
			const { done, value } = await reader.read();
			streamDone = done;
			if (streamDone) break;

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
		error: unknown,
		accumulated: string,
		options: StreamOptions,
		videoId: string
	): void {
		if (isAbortError(error)) {
			debugLogger.info(`[AI Summary] ${this.serviceName} streaming aborted for video: ${videoId}`);
			if (accumulated) {
				options.onComplete?.(this.createResult(accumulated));
			}
			return;
		}

		if (!isAIServiceError(error)) {
			const wrappedError = new AIServiceError(
				'network_error',
				error instanceof Error ? error.message : 'Network error',
			);
			options.onError?.(wrappedError);
			throw wrappedError;
		}

		options.onError?.(error);
		throw error;
	}
}
