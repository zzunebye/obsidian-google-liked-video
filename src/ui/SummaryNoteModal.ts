import { App, Modal } from 'obsidian';

type SummaryNoteChoice = 'replace' | 'new' | 'cancel';

class SummaryNoteModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly notePath: string,
		private readonly canReplace: boolean,
		private readonly resolveChoice: (choice: SummaryNoteChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Save AI summary');
		this.contentEl.createEl('p', { text: `A summary already exists in ${this.notePath}.` });
		this.contentEl.createEl('p', {
			text: this.canReplace
				? 'Replace the existing summary, including any edits within it, or save this version as a separate note. Content outside the summary is kept.'
				: 'The existing summary cannot be safely separated from the rest of this note. Save this version as a new note to keep the original intact.',
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.choose('cancel'));
		const separate = actions.createEl('button', { text: 'Save as new note' });
		separate.addEventListener('click', () => this.choose('new'));
		if (this.canReplace) {
			const replace = actions.createEl('button', { text: 'Replace existing summary', cls: 'mod-cta' });
			replace.addEventListener('click', () => this.choose('replace'));
		}
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolveChoice('cancel');
	}

	private choose(choice: SummaryNoteChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveChoice(choice);
		this.close();
	}
}

export function chooseSummaryNoteAction(app: App, notePath: string, canReplace: boolean): Promise<SummaryNoteChoice> {
	return new Promise(resolve => new SummaryNoteModal(app, notePath, canReplace, resolve).open());
}
