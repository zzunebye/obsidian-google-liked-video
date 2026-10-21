import { App, Modal, Notice, Setting } from 'obsidian';
import { GoogleClientCredentials, parseGoogleClientCredentials } from 'src/utils/googleCredentialsUtils';
import { t } from '../i18n';

const MAX_CREDENTIALS_FILE_BYTES = 1024 * 1024;

export class GoogleCredentialsImportModal extends Modal {
	private credentials: GoogleClientCredentials | null = null;
	private selectionVersion = 0;
	private saving = false;
	private fileInput!: HTMLInputElement;
	private previewEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private saveButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly isConnected: () => boolean,
		private readonly saveCredentials: (credentials: GoogleClientCredentials) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t("credentialsImport.title"));
		this.contentEl.createEl('p', {
			text: t("credentialsImport.instructions"),
		});
		this.contentEl.createEl('a', {
			text: t("credentialsImport.openConsole"),
			href: 'https://console.cloud.google.com/auth/clients',
			attr: { target: '_blank', rel: 'noopener noreferrer' },
		});
		this.contentEl.createEl('p', {
			text: t("credentialsImport.privacy"),
		});
		const fileSetting = new Setting(this.contentEl).setName(t("credentialsImport.file"));
		this.fileInput = fileSetting.controlEl.createEl('input', {
			type: 'file',
			attr: { accept: '.json,application/json', 'aria-label': t("credentialsImport.fileLabel") },
		});
		this.fileInput.addEventListener('change', () => { void this.readFile(); });
		this.statusEl = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
		this.previewEl = this.contentEl.createDiv();
		if (this.isConnected()) {
			this.contentEl.createEl('p', {
				text: t("credentialsImport.disconnectBeforeReplace"),
			});
		}
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancelButton = actions.createEl('button', { text: t("settings.cancel") });
		cancelButton.addEventListener('click', () => this.close());
		this.saveButton = actions.createEl('button', { text: t("credentialsImport.save"), cls: 'mod-cta' });
		this.saveButton.disabled = true;
		this.saveButton.addEventListener('click', () => { void this.save(); });
		this.fileInput.focus();
	}

	onClose(): void {
		this.selectionVersion += 1;
		this.credentials = null;
		this.contentEl.empty();
	}

	private async readFile(): Promise<void> {
		const version = ++this.selectionVersion;
		this.credentials = null;
		this.previewEl.empty();
		this.saveButton.disabled = true;
		this.statusEl.setText('');
		const file = this.fileInput.files?.[0];
		if (!file) return;
		if (file.size > MAX_CREDENTIALS_FILE_BYTES) {
			this.statusEl.setText(t("credentialsImport.fileTooLarge"));
			return;
		}
		this.statusEl.setText(t("credentialsImport.reading"));
		try {
			const text = await file.text();
			if (version !== this.selectionVersion) return;
			const credentials = parseGoogleClientCredentials(text);
			this.credentials = credentials;
			const details = this.previewEl.createEl('dl');
			details.createEl('dt', { text: t("credentialsImport.clientType") });
			details.createEl('dd', { text: credentials.clientType === 'web' ? t("credentialsImport.web") : t("credentialsImport.desktop") });
			if (credentials.projectId) {
				details.createEl('dt', { text: t("credentialsImport.project") });
				details.createEl('dd', { text: credentials.projectId });
			}
			details.createEl('dt', { text: t("credentialsImport.clientId") });
			details.createEl('dd', { text: credentials.clientId });
			this.previewEl.createEl('p', {
				text: t("credentialsImport.saveHelp"),
			});
			this.statusEl.setText(t("credentialsImport.ready"));
			this.saveButton.disabled = this.isConnected();
		} catch (error) {
			if (version !== this.selectionVersion) return;
			this.statusEl.setText(error instanceof Error ? error.message : t("credentialsImport.readFailed"));
		}
	}

	private async save(): Promise<void> {
		if (!this.credentials || this.saving) return;
		if (this.isConnected()) {
			this.statusEl.setText(t("credentialsImport.disconnectBeforeReplace"));
			this.saveButton.disabled = true;
			return;
		}
		this.saving = true;
		this.saveButton.disabled = true;
		this.fileInput.disabled = true;
		try {
			await this.saveCredentials(this.credentials);
			new Notice(t("settings.credentialsImported"));
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : t("credentialsImport.saveFailed");
			this.statusEl.setText(message);
			new Notice(message);
		} finally {
			this.saving = false;
			this.fileInput.disabled = false;
			this.saveButton.disabled = !this.credentials || this.isConnected();
		}
	}
}
