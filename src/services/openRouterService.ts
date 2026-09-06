import { debugLogger } from '../debug';
import { AIServiceError } from './aiServiceError';
import { BaseAIService } from './baseAIService';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getOpenRouterText(data: unknown, responseType: 'delta' | 'message'): string {
	if (!isRecord(data) || !Array.isArray(data.choices)) return '';
	const choice: unknown = data.choices[0];
	if (!isRecord(choice)) return '';
	const response: unknown = choice[responseType];
	if (!isRecord(response)) return '';
	return typeof response.content === 'string' ? response.content : '';
}

export class OpenRouterService extends BaseAIService {
	protected serviceName = 'OpenRouter';
	protected apiKey: string;
	private model: string;

	constructor(apiKey: string, model: string) {
		super();
		this.apiKey = apiKey;
		this.model = model;
		debugLogger.debug(`[AI Summary] OpenRouterService initialized (model: ${this.model})`);
	}

	protected getModel(): string {
		return this.model;
	}

	protected buildStreamUrl(): string {
		return OPENROUTER_URL;
	}

	protected buildRequestBody(videoId: string, prompt: string): object {
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

	protected buildRequestHeaders(): Record<string, string> {
		return {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
		};
	}

	protected parseChunk(jsonStr: string): string | null {
		try {
			const data: unknown = JSON.parse(jsonStr);
			return getOpenRouterText(data, 'delta') || null;
		} catch {
			debugLogger.debug(`[AI Summary] Failed to parse OpenRouter SSE chunk: ${jsonStr}`);
			return null;
		}
	}

	protected buildTextCompletionUrl(): string {
		return OPENROUTER_URL;
	}

	protected buildTextCompletionBody(prompt: string): object {
		return {
			model: this.model,
			stream: false,
			messages: [{ role: 'user', content: prompt }]
		};
	}

	protected parseTextCompletionResponse(data: unknown): string {
		return getOpenRouterText(data, 'message');
	}

	protected mapHttpStatusToError(status: number, message: string): AIServiceError {
		if (status === 401 || status === 403) {
			return new AIServiceError('invalid_key', `Invalid API key: ${message}`);
		} else if (status === 429) {
			return new AIServiceError('rate_limit', 'Rate limit exceeded. Try again later.');
		}
		return new AIServiceError('unknown', `HTTP ${status}: ${message}`);
	}
}
