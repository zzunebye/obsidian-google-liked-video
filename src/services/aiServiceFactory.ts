import { getLanguage } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings } from '../types';
import { AIService, GeminiService } from './geminiService';
import { OpenAIService } from './openAIService';
import { OpenRouterService } from './openRouterService';

export function createAIService(settings: ObsidianGoogleLikedVideoSettings): AIService {
	const transcriptLanguage = settings.transcriptLanguage === 'auto'
		? getLanguage()
		: settings.transcriptLanguage;

	switch (settings.aiProvider) {
		case 'openrouter':
			return new OpenRouterService(
				settings.openRouterApiKey,
				settings.openRouterModel,
				transcriptLanguage,
			);
		case 'openai':
			return new OpenAIService(
				settings.openAIApiKey,
				settings.openAIModel,
				transcriptLanguage,
			);
		case 'gemini':
			return new GeminiService(settings.geminiApiKey);
	}

	const unsupportedProvider: never = settings.aiProvider;
	throw new Error(`Unsupported AI provider: ${String(unsupportedProvider)}`);
}

export function getActiveApiKey(settings: ObsidianGoogleLikedVideoSettings): string {
	switch (settings.aiProvider) {
		case 'openrouter':
			return settings.openRouterApiKey;
		case 'openai':
			return settings.openAIApiKey;
		case 'gemini':
			return settings.geminiApiKey;
	}

	const unsupportedProvider: never = settings.aiProvider;
	throw new Error(`Unsupported AI provider: ${String(unsupportedProvider)}`);
}
