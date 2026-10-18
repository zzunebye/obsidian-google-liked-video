import { App, Modal } from 'obsidian';

type SummaryNoteChoice = 'open' | 'replace' | 'new' | 'cancel';

class SummaryNoteModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly notePath: string,
		private readonly hasSummaryBoundary: boolean,
		private readonly resolveChoice: (choice: SummaryNoteChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Save AI summary');
		this.contentEl.createEl('p', { text: `A summary already exists in ${this.notePath}.` });
		this.contentEl.createEl('p', {
			text: this.hasSummaryBoundary
				? 'Open the existing note, replace its summary, or save this version as a separate note. Replacing keeps content outside the summary, including note properties.'
				: 'Open the existing note or save this version as a separate note to keep its content. Replace existing note overwrites the entire note body, including your edits, with this summary. Note properties are kept.',
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.choose('cancel'));
		const open = actions.createEl('button', { text: 'Open existing note' });
		open.addEventListener('click', () => this.choose('open'));
		const separate = actions.createEl('button', { text: 'Save as new note' });
		separate.addEventListener('click', () => this.choose('new'));
		const replace = actions.createEl('button', {
			text: 'Replace existing note', cls: this.hasSummaryBoundary ? 'mod-cta' : 'mod-warning',
		});
		replace.addEventListener('click', () => this.choose('replace'));
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

export function chooseSummaryNoteAction(app: App, notePath: string, hasSummaryBoundary: boolean): Promise<SummaryNoteChoice> {
	return new Promise(resolve => new SummaryNoteModal(app, notePath, hasSummaryBoundary, resolve).open());
}
