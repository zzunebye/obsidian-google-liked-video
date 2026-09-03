import { Setting } from 'obsidian';

export interface MonospaceTextareaOptions {
	className: string;
	value: string;
	rows: number;
	onChange: (value: string) => void | Promise<void>;
}

export function createMonospaceTextarea(
	containerEl: HTMLElement,
	options: MonospaceTextareaOptions
): HTMLTextAreaElement {
	const wrapper = containerEl.createDiv(`${options.className}-container`);
	const textarea = wrapper.createEl('textarea', {
		cls: options.className,
		text: options.value,
	});
	textarea.rows = options.rows;
	textarea.addEventListener('change', () => {
		void options.onChange(textarea.value);
	});
	return textarea;
}

export interface WideTextSettingOptions {
	name: string;
	desc: string;
	placeholder: string;
	value: string;
	secret?: boolean;
	onChange: (value: string) => void | Promise<void>;
}

export function addWideTextSetting(
	containerEl: HTMLElement,
	options: WideTextSettingOptions
): Setting {
	return new Setting(containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addText(text => {
			if (options.secret) {
				text.inputEl.type = 'password';
			}
			text.inputEl.addClass('geulo-setting-full-width-input');
			text
				.setPlaceholder(options.placeholder)
				.setValue(options.value)
				.onChange((value) => {
					void options.onChange(value);
				});
		});
}

export function createCollapsibleHtmlReference(
	containerEl: HTMLElement,
	summary: string,
	htmlContent: string
): HTMLDetailsElement {
	const detailsEl = containerEl.createEl('details', {
		cls: 'template-variables-reference',
	});
	detailsEl.createEl('summary', { text: summary });
	detailsEl.createDiv().innerHTML = htmlContent;
	return detailsEl;
}
