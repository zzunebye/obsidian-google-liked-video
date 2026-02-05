import { debugLogger } from '../debug';
import { AIServiceError } from './geminiService';
import { BaseAIService } from './baseAIService';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

	protected async executeRequest(url: string, body: object, signal?: AbortSignal): Promise<Response> {
		return fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
			signal
		});
	}

	protected parseChunk(jsonStr: string): string | null {
		try {
			const data = JSON.parse(jsonStr);
			return data?.choices?.[0]?.delta?.content || null;
		} catch {
			debugLogger.debug(`[AI Summary] Failed to parse OpenRouter SSE chunk: ${jsonStr}`);
			return null;
		}
	}

	protected mapHttpStatusToError(status: number, message: string): AIServiceError {
		if (status === 401 || status === 403) {
			return { type: 'invalid_key', message: `Invalid API key: ${message}` };
		} else if (status === 429) {
			return { type: 'rate_limit', message: 'Rate limit exceeded. Try again later.' };
		}
		return { type: 'unknown', message: `HTTP ${status}: ${message}` };
	}
}
