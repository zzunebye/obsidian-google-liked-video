import { Notice, Setting } from 'obsidian';
import type { ExtraButtonComponent } from 'obsidian';
import { debugLogger } from 'src/debug';

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
	copyable?: boolean;
	onChange: (value: string) => void | Promise<void>;
}

export interface CollapsibleReferenceItem {
	readonly variables: readonly string[];
	readonly description?: string;
}

export interface CollapsibleReferenceSection {
	readonly title: string;
	readonly items: readonly CollapsibleReferenceItem[];
}

export function addWideTextSetting(
	containerEl: HTMLElement,
	options: WideTextSettingOptions
): Setting {
	let inputEl: HTMLInputElement | null = null;
	let copyButton: ExtraButtonComponent | null = null;
	const setting = new Setting(containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addText(text => {
			inputEl = text.inputEl;
			if (options.secret) {
				text.inputEl.type = 'password';
			}
			text.inputEl.addClass('geulo-setting-full-width-input');
			text
				.setPlaceholder(options.placeholder)
				.setValue(options.value)
				.onChange((value) => {
					copyButton?.setDisabled(value.length === 0);
					void options.onChange(value);
				});
		});

	if (options.copyable) {
		setting.addExtraButton(button => {
			copyButton = button;
			button
				.setIcon('copy')
				.setTooltip(`Copy ${options.name}`)
				.setDisabled(options.value.length === 0)
				.onClick(async () => {
					const value = inputEl?.value ?? options.value;
					if (!value) return;

					try {
						await navigator.clipboard.writeText(value);
						new Notice(`${options.name} copied to clipboard.`);
					} catch (error: unknown) {
						debugLogger.warn(`[Settings] Failed to copy ${options.name}`, error);
						new Notice(`Could not copy ${options.name}. Please try again.`);
					}
				});
		});
	}

	return setting;
}

export function createCollapsibleReference(
	containerEl: HTMLElement,
	summary: string,
	sections: readonly CollapsibleReferenceSection[]
): HTMLDetailsElement {
	const detailsEl = containerEl.createEl('details', {
		cls: 'template-variables-reference',
	});
	detailsEl.createEl('summary', { text: summary });
	const contentEl = detailsEl.createDiv('template-variables-reference__content');

	for (const section of sections) {
		contentEl.createEl('h4', {
			cls: 'template-variables-reference__heading',
			text: section.title,
		});

		for (const item of section.items) {
			const itemEl = contentEl.createDiv();
			item.variables.forEach((variable, index) => {
				if (index > 0) {
					itemEl.createSpan({ text: ', ' });
				}
				itemEl.createEl('code', { text: variable });
			});
			if (item.description) {
				itemEl.createSpan({ text: ` → ${item.description}` });
			}
		}
	}
	return detailsEl;
}
