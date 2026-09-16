import { App, Modal, Notice, Setting } from 'obsidian';
import { GoogleClientCredentials, parseGoogleClientCredentials } from 'src/utils/googleCredentialsUtils';

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
		this.setTitle('Import Google credentials');
		this.contentEl.createEl('p', {
			text: 'Choose the OAuth client JSON downloaded from Google Cloud Console. Web and Desktop client files are supported. If your client is already set up, you can download it when you create a new secret.',
		});
		this.contentEl.createEl('a', {
			text: 'Open Google Auth Platform → Clients',
			href: 'https://console.cloud.google.com/auth/clients',
			attr: { target: '_blank', rel: 'noopener noreferrer' },
		});
		this.contentEl.createEl('p', {
			text: 'The file is read on this device. Your client secret is saved in Obsidian SecretStorage only when you choose Save credentials.',
		});
		const fileSetting = new Setting(this.contentEl).setName('Credentials JSON');
		this.fileInput = fileSetting.controlEl.createEl('input', {
			type: 'file',
			attr: { accept: '.json,application/json', 'aria-label': 'Google OAuth credentials JSON' },
		});
		this.fileInput.addEventListener('change', () => { void this.readFile(); });
		this.statusEl = this.contentEl.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
		this.previewEl = this.contentEl.createDiv();
		if (this.isConnected()) {
			this.contentEl.createEl('p', {
				text: 'You can preview a file here. Disconnect your Google account in settings before replacing credentials.',
			});
		}
		const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
		const cancelButton = actions.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());
		this.saveButton = actions.createEl('button', { text: 'Save credentials', cls: 'mod-cta' });
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
			this.statusEl.setText('This file is too large. Choose an OAuth client JSON file smaller than 1 MB.');
			return;
		}
		this.statusEl.setText('Reading credentials…');
		try {
			const text = await file.text();
			if (version !== this.selectionVersion) return;
			const credentials = parseGoogleClientCredentials(text);
			this.credentials = credentials;
			const details = this.previewEl.createEl('dl');
			details.createEl('dt', { text: 'Client type' });
			details.createEl('dd', { text: credentials.clientType === 'web' ? 'Web application' : 'Installed application (Desktop)' });
			if (credentials.projectId) {
				details.createEl('dt', { text: 'Project' });
				details.createEl('dd', { text: credentials.projectId });
			}
			details.createEl('dt', { text: 'Client ID' });
			details.createEl('dd', { text: credentials.clientId });
			this.previewEl.createEl('p', {
				text: 'Saving replaces your configured client ID and secret. Then use Connect with Google in settings to sign in.',
			});
			this.statusEl.setText('Credentials ready to import. Google connection has not been checked.');
			this.saveButton.disabled = this.isConnected();
		} catch (error) {
			if (version !== this.selectionVersion) return;
			this.statusEl.setText(error instanceof Error ? error.message : 'Could not read the selected file. Please choose it again.');
		}
	}

	private async save(): Promise<void> {
		if (!this.credentials || this.saving) return;
		if (this.isConnected()) {
			this.statusEl.setText('Disconnect your Google account in settings before replacing credentials.');
			this.saveButton.disabled = true;
			return;
		}
		this.saving = true;
		this.saveButton.disabled = true;
		this.fileInput.disabled = true;
		try {
			await this.saveCredentials(this.credentials);
			new Notice('Google credentials imported. Use Connect with Google to sign in.');
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not save Google credentials. Please try again.';
			this.statusEl.setText(message);
			new Notice(message);
		} finally {
			this.saving = false;
			this.fileInput.disabled = false;
			this.saveButton.disabled = !this.credentials || this.isConnected();
		}
	}
}
