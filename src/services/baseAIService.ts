import { requestUrl } from 'obsidian';
import { debugLogger } from '../debug';
import type { SummarySource } from '../types';
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
	protected abstract summarySource: SummarySource;

	protected abstract getModel(): string;
	protected abstract buildStreamUrl(): string;
	protected abstract buildRequestBody(videoId: string, prompt: string, signal?: AbortSignal): object | Promise<object>;
	protected abstract buildRequestHeaders(): Record<string, string>;
	protected abstract parseChunk(jsonStr: string): string | null;
	protected abstract mapHttpStatusToError(status: number, message: string): AIServiceError;
	protected abstract buildTextCompletionUrl(): string;
	protected abstract buildTextCompletionBody(prompt: string): object;
	protected abstract parseTextCompletionResponse(data: unknown): string;

	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		return new Promise((resolve, reject) => {
			this.generateVideoSummaryStream(videoId, prompt, {
				onChunk: () => {},
				onComplete: resolve,
				onError: reject,
			}).catch((error) => {
				reject(toAIServiceError(error));
			});
		});
	}

	async generateVideoSummaryStream(videoId: string, prompt: string, options: StreamOptions): Promise<void> {
		this.validateApiKey(options.onError);

		const url = this.buildStreamUrl();

		debugLogger.info(`[AI Summary] Starting streaming generation via ${this.serviceName} for video: ${videoId}`);
		debugLogger.debug(`[AI Summary] Model: ${this.getModel()}`);
		debugLogger.time(`ai-summary-${videoId}`);

		const controller = new AbortController();
		const abort = () => controller.abort();
		options.signal?.addEventListener('abort', abort, { once: true });
		if (options.signal?.aborted) controller.abort();
		let timedOut = false;
		const timeoutId = window.setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, REQUEST_TIMEOUT_MS);

		try {
			const body = await this.buildRequestBody(videoId, prompt, controller.signal);
			// requestUrl buffers the entire response, so SSE must use fetch's live body.
			const response = await fetch(url, {
				method: 'POST',
				headers: this.buildRequestHeaders(),
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			await this.handleHttpError(response, options.onError);

			const reader = response.body?.getReader();
			if (!reader) {
				return this.throwAndNotify(
					new AIServiceError('unknown', 'No response body for streaming'),
					options.onError,
				);
			}

			const accumulated = await this.processSSEStream(reader, (chunk, content) => {
				if (!controller.signal.aborted) options.onChunk(chunk, content);
			}, (jsonStr) => this.parseChunk(jsonStr));
			if (controller.signal.aborted) throw new DOMException('Request aborted', 'AbortError');

			debugLogger.info(`[AI Summary] ${this.serviceName} streaming complete for video: ${videoId} (${accumulated.length} chars)`);
			options.onComplete?.(this.createResult(accumulated));
		} catch (error: unknown) {
			this.handleStreamError(timedOut
				? new AIServiceError('network_error', 'Summary request timed out. Please try again.')
				: error, options, videoId);
		} finally {
			window.clearTimeout(timeoutId);
			options.signal?.removeEventListener('abort', abort);
			debugLogger.timeEnd(`ai-summary-${videoId}`);
		}
	}

	async generateTextCompletion(prompt: string, signal?: AbortSignal): Promise<string> {
		this.validateApiKey();

		const url = this.buildTextCompletionUrl();
		const body = this.buildTextCompletionBody(prompt);
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) controller.abort();
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
			if (signal?.aborted) throw error;
			if (isAbortError(error)) {
				const timeoutError = new AIServiceError(
					'network_error',
					'Text completion request timed out',
				);
				throw timeoutError;
			}
			throw toAIServiceError(error);
		} finally {
			window.clearTimeout(timeoutId);
			signal?.removeEventListener('abort', abort);
		}
	}

	protected executeRequest(url: string, body: object, signal?: AbortSignal): Promise<Response> {
		if (signal?.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));
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

		try {
			while (!streamDone) {
				const { done, value } = await reader.read();
				streamDone = done;
				buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const jsonStr = line.slice(5).trim();
					if (jsonStr === '[DONE]') return accumulated;
					if (!jsonStr) continue;

					const text = parseChunk(jsonStr);
					if (text) {
						accumulated += text;
						onChunk(text, accumulated);
					}
				}
			}
			return accumulated;
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
	}

	protected createResult(summary: string): AIServiceResult {
		return {
			summary,
			generatedAt: new Date().toISOString(),
			model: this.getModel(),
			source: this.summarySource,
		};
	}

	protected throwAndNotify(error: AIServiceError, onError?: (e: AIServiceError) => void): never {
		onError?.(error);
		throw error;
	}

	protected handleStreamError(
		error: unknown,
		options: StreamOptions,
		videoId: string
	): void {
		if (isAbortError(error)) {
			debugLogger.info(`[AI Summary] ${this.serviceName} streaming aborted for video: ${videoId}`);
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
