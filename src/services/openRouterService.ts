import { debugLogger } from '../debug';
import { AIService, AIServiceResult, AIServiceError } from './geminiService';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterService implements AIService {
	private apiKey: string;
	private model: string;

	constructor(apiKey: string, model: string) {
		this.apiKey = apiKey;
		this.model = model;
		debugLogger.debug(`[AI Summary] OpenRouterService initialized (model: ${this.model})`);
	}

	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		if (!this.apiKey) {
			debugLogger.warn('[AI Summary] No OpenRouter API key configured, aborting generation');
			throw { type: 'no_api_key', message: 'OpenRouter API key is not configured' } as AIServiceError;
		}

		const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

		const body = {
			model: this.model,
			messages: [{
				role: 'user',
				content: [
					{ type: 'text', text: prompt },
					{ type: 'video_url', video_url: { url: videoUrl } }
				]
			}]
		};

		debugLogger.info(`[AI Summary] Starting summary generation via OpenRouter for video: ${videoId}`);
		debugLogger.debug(`[AI Summary] Request URL: ${OPENROUTER_URL}`);
		debugLogger.debug(`[AI Summary] Model: ${this.model}`);
		debugLogger.debug(`[AI Summary] Video URL: ${videoUrl}`);
		debugLogger.verbose(`[AI Summary] Prompt: ${prompt}`);
		debugLogger.verbose(`[AI Summary] Request body:`, body);
		debugLogger.time(`ai-summary-${videoId}`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			debugLogger.warn(`[AI Summary] OpenRouter request timed out after 90s for video: ${videoId}`);
			controller.abort();
		}, 90000);

		try {
			debugLogger.debug(`[AI Summary] Sending POST request to OpenRouter API...`);
			const response = await fetch(OPENROUTER_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal
			});

			debugLogger.debug(`[AI Summary] Response received: HTTP ${response.status} ${response.statusText}`);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const errorMessage = (errorData as any)?.error?.message || response.statusText;
				debugLogger.error(`[AI Summary] OpenRouter API error: HTTP ${response.status} - ${errorMessage}`, errorData);

				if (response.status === 401 || response.status === 403) {
					throw { type: 'invalid_key', message: `Invalid API key: ${errorMessage}` } as AIServiceError;
				}
				if (response.status === 429) {
					debugLogger.warn(`[AI Summary] Rate limited by OpenRouter API`);
					throw { type: 'rate_limit', message: 'Rate limit exceeded. Try again later.' } as AIServiceError;
				}
				throw { type: 'unknown', message: `HTTP ${response.status}: ${errorMessage}` } as AIServiceError;
			}

			const data = await response.json();
			const text = (data as any)?.choices?.[0]?.message?.content;
			const usage = (data as any)?.usage;

			if (usage) {
				debugLogger.debug(`[AI Summary] Token usage - prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, total: ${usage.total_tokens}`);
			}

			if (!text) {
				debugLogger.error(`[AI Summary] No text in OpenRouter response. Full response:`, data);
				throw { type: 'unknown', message: 'No summary text in OpenRouter response' } as AIServiceError;
			}

			debugLogger.info(`[AI Summary] Summary generated successfully via OpenRouter for video: ${videoId} (${text.length} chars)`);
			debugLogger.verbose(`[AI Summary] Summary content preview: ${text.slice(0, 200)}...`);

			return {
				summary: text,
				generatedAt: new Date().toISOString(),
				model: this.model
			};
		} catch (error: any) {
			if (error?.name === 'AbortError') {
				debugLogger.error(`[AI Summary] OpenRouter request aborted (timeout) for video: ${videoId}`);
				throw { type: 'network_error', message: 'Request timed out' } as AIServiceError;
			}
			if (error?.type) {
				debugLogger.error(`[AI Summary] AIServiceError thrown: type=${error.type}, message=${error.message}`);
				throw error;
			}
			debugLogger.error(`[AI Summary] Unexpected error for video ${videoId}:`, error);
			throw { type: 'network_error', message: error?.message || 'Network error' } as AIServiceError;
		} finally {
			clearTimeout(timeoutId);
			debugLogger.timeEnd(`ai-summary-${videoId}`);
		}
	}
}
