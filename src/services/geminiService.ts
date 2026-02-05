import { debugLogger } from '../debug';

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface AIServiceResult {
	summary: string;
	generatedAt: string;
	model: string;
}

export interface AIServiceError {
	type: 'no_api_key' | 'invalid_key' | 'network_error' | 'rate_limit' | 'unknown';
	message: string;
}

export interface AIService {
	generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult>;
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

	async generateVideoSummary(videoId: string, prompt: string): Promise<AIServiceResult> {
		if (!this.apiKey) {
			debugLogger.warn('[AI Summary] No API key configured, aborting generation');
			throw { type: 'no_api_key', message: 'Gemini API key is not configured' } as AIServiceError;
		}

		const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;
		const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

		const body = {
			contents: [{
				parts: [
					{
						text: prompt
					},
					{
						file_data: {
							file_uri: videoUrl,
						}
					},
				]
			}]
		};

		debugLogger.info(`[AI Summary] Starting summary generation for video: ${videoId}`);
		debugLogger.debug(`[AI Summary] Request URL: ${url}`);
		debugLogger.debug(`[AI Summary] Video URL: ${videoUrl}`);
		debugLogger.verbose(`[AI Summary] Prompt: ${prompt}`);
		debugLogger.verbose(`[AI Summary] Request body:`, body);
		debugLogger.time(`ai-summary-${videoId}`);

		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			debugLogger.warn(`[AI Summary] Request timed out after 60s for video: ${videoId}`);
			controller.abort();
		}, 90000);

		try {
			debugLogger.debug(`[AI Summary] Sending POST request to Gemini API...`);
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': this.apiKey
				},
				body: JSON.stringify(body),
				signal: controller.signal
			});

			debugLogger.debug(`[AI Summary] Response received: HTTP ${response.status} ${response.statusText}`);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const errorMessage = (errorData as any)?.error?.message || response.statusText;
				debugLogger.error(`[AI Summary] API error: HTTP ${response.status} - ${errorMessage}`, errorData);

				if (response.status === 400 || response.status === 403) {
					throw { type: 'invalid_key', message: `Invalid API key: ${errorMessage}` } as AIServiceError;
				}
				if (response.status === 429) {
					debugLogger.warn(`[AI Summary] Rate limited by Gemini API`);
					throw { type: 'rate_limit', message: 'Rate limit exceeded. Try again later.' } as AIServiceError;
				}
				throw { type: 'unknown', message: `HTTP ${response.status}: ${errorMessage}` } as AIServiceError;
			}

			const data = await response.json();
			const text = (data as any)?.candidates?.[0]?.content?.parts?.[0]?.text;
			const finishReason = (data as any)?.candidates?.[0]?.finishReason;
			const usageMetadata = (data as any)?.usageMetadata;

			debugLogger.debug(`[AI Summary] Finish reason: ${finishReason}`);
			if (usageMetadata) {
				debugLogger.debug(`[AI Summary] Token usage - prompt: ${usageMetadata.promptTokenCount}, response: ${usageMetadata.candidatesTokenCount}, total: ${usageMetadata.totalTokenCount}`);
			}

			if (!text) {
				debugLogger.error(`[AI Summary] No text in response. Full response:`, data);
				throw { type: 'unknown', message: 'No summary text in Gemini response' } as AIServiceError;
			}

			debugLogger.info(`[AI Summary] Summary generated successfully for video: ${videoId} (${text.length} chars)`);
			debugLogger.verbose(`[AI Summary] Summary content preview: ${text.slice(0, 200)}...`);

			return {
				summary: text,
				generatedAt: new Date().toISOString(),
				model: GEMINI_MODEL
			};
		} catch (error: any) {
			if (error?.name === 'AbortError') {
				debugLogger.error(`[AI Summary] Request aborted (timeout) for video: ${videoId}`);
				throw { type: 'network_error', message: 'Request timed out' } as AIServiceError;
			}
			if (error?.type) {
				debugLogger.error(`[AI Summary] GeminiError thrown: type=${error.type}, message=${error.message}`);
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
