import { App, Modal } from 'obsidian';
import { t } from '../i18n';

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
		this.setTitle(t("summaryNote.title"));
		this.contentEl.createEl('p', { text: t("summaryNote.exists").replace("{path}", this.notePath) });
		this.contentEl.createEl('p', {
			text: this.hasSummaryBoundary
				? t("summaryNote.managedHelp")
				: t("summaryNote.unmanagedHelp"),
		});
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: t("settings.cancel") });
		cancel.addEventListener('click', () => this.choose('cancel'));
		const open = actions.createEl('button', { text: t("summaryNote.openExisting") });
		open.addEventListener('click', () => this.choose('open'));
		const separate = actions.createEl('button', { text: t("summaryNote.saveNew") });
		separate.addEventListener('click', () => this.choose('new'));
		const replace = actions.createEl('button', {
			text: t("summaryNote.replaceExisting"), cls: this.hasSummaryBoundary ? 'mod-cta' : 'mod-warning',
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
