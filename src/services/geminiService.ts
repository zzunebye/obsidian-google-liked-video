import { debugLogger } from '../debug';
import { BaseAIService } from './baseAIService';

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

export class GeminiService extends BaseAIService {
	protected serviceName = 'Gemini';
	protected apiKey: string;

	constructor(apiKey: string) {
		super();
		this.apiKey = apiKey;
		debugLogger.debug(`[AI Summary] GeminiService initialized (model: ${GEMINI_MODEL})`);
	}

	protected getModel(): string {
		return GEMINI_MODEL;
	}

	protected buildStreamUrl(): string {
		return `${GEMINI_BASE_URL}/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
	}

	protected buildRequestBody(videoId: string, prompt: string): object {
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

	protected async executeRequest(url: string, body: object, signal?: AbortSignal): Promise<Response> {
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

	protected parseChunk(jsonStr: string): string | null {
		try {
			const data = JSON.parse(jsonStr);
			return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
		} catch {
			debugLogger.debug(`[AI Summary] Failed to parse Gemini SSE chunk: ${jsonStr}`);
			return null;
		}
	}

	protected mapHttpStatusToError(status: number, message: string): AIServiceError {
		if (status === 400 || status === 403) {
			return { type: 'invalid_key', message: `Invalid API key: ${message}` };
		} else if (status === 429) {
			return { type: 'rate_limit', message: 'Rate limit exceeded. Try again later.' };
		}
		return { type: 'unknown', message: `HTTP ${status}: ${message}` };
	}
}
