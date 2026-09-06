import { debugLogger } from '../debug';
import { BaseAIService } from './baseAIService';
import { AIServiceError } from './aiServiceError';

export { AIServiceError } from './aiServiceError';

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getGeminiText(data: unknown): string {
	if (!isRecord(data) || !Array.isArray(data.candidates)) return '';
	const candidate = data.candidates[0];
	if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return '';
	const part = candidate.content.parts[0];
	return isRecord(part) && typeof part.text === 'string' ? part.text : '';
}

export interface AIServiceResult {
	summary: string;
	generatedAt: string;
	model: string;
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
	generateTextCompletion(prompt: string): Promise<string>;
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

	protected buildRequestHeaders(): Record<string, string> {
		return {
				'Content-Type': 'application/json',
				'x-goog-api-key': this.apiKey
		};
	}

	protected parseChunk(jsonStr: string): string | null {
		try {
			const data: unknown = JSON.parse(jsonStr);
			return getGeminiText(data) || null;
		} catch {
			debugLogger.debug(`[AI Summary] Failed to parse Gemini SSE chunk: ${jsonStr}`);
			return null;
		}
	}

	protected buildTextCompletionUrl(): string {
		return `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;
	}

	protected buildTextCompletionBody(prompt: string): object {
		return {
			contents: [{ parts: [{ text: prompt }] }]
		};
	}

	protected parseTextCompletionResponse(data: unknown): string {
		return getGeminiText(data);
	}

	protected mapHttpStatusToError(status: number, message: string): AIServiceError {
		if (status === 400 || status === 403) {
			return new AIServiceError('invalid_key', `Invalid API key: ${message}`);
		} else if (status === 429) {
			return new AIServiceError('rate_limit', 'Rate limit exceeded. Try again later.');
		}
		return new AIServiceError('unknown', `HTTP ${status}: ${message}`);
	}
}
