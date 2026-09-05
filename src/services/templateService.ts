import { App } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings } from '../types';

export class TemplateService {
	constructor(
		private app: App,
		private settings: ObsidianGoogleLikedVideoSettings
	) {}

	/**
	 * Load template from settings
	 * Returns the custom template if enabled, otherwise null (use built-in)
	 */
	loadTemplate(): string | null {
		if (!this.settings.enableTemplateSystem) {
			return null; // Use built-in template
		}

		// Return custom template from settings
		const template = this.settings.customTemplate;

		if (!template || template.trim() === '') {
			return null;
		}

		return template;
	}
}
