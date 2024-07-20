import { App, Modal } from "obsidian";

export class GeuloModal extends Modal {
	title: string;
	message: string;
	constructor(app: App, title: string, message: string) {
		super(app);
		this.title = title;
		this.titleEl.setText(this.title);
		this.message = message;
	}

	onOpen() {
		const { contentEl } = this;
		// contentEl.setText(this.message);
		contentEl.createEl('p', { text: this.message });
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}