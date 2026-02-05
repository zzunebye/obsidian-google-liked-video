import { ObsidianGoogleLikedVideoSettings } from '../types';
import { AIService, GeminiService } from './geminiService';
import { OpenRouterService } from './openRouterService';

export function createAIService(settings: ObsidianGoogleLikedVideoSettings): AIService {
	if (settings.aiProvider === 'openrouter') {
		return new OpenRouterService(settings.openRouterApiKey, settings.openRouterModel);
	}
	return new GeminiService(settings.geminiApiKey);
}

export function getActiveApiKey(settings: ObsidianGoogleLikedVideoSettings): string {
	return settings.aiProvider === 'openrouter'
		? settings.openRouterApiKey
		: settings.geminiApiKey;
}
