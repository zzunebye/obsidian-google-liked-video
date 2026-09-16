import { App, Modal } from 'obsidian';

export type CacheOwnershipChoice = 'associate' | 'replace' | 'cancel';

interface CacheOwnershipModalOptions {
	cacheLabel: string;
	currentChannelId: string;
	currentChannelTitle?: string;
	storedOwnerChannelId: string | null;
	allowAssociate: boolean;
	allowReplace: boolean;
}

class CacheOwnershipModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: CacheOwnershipModalOptions,
		private readonly resolveChoice: (choice: CacheOwnershipChoice) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		this.setTitle(options.storedOwnerChannelId === null
			? `Connect existing ${options.cacheLabel}?`
			: `Replace ${options.cacheLabel} for another account?`);
		const currentChannel = options.currentChannelTitle
			? `${options.currentChannelTitle} (${options.currentChannelId})`
			: options.currentChannelId;
		contentEl.createEl('p', {
			text: options.storedOwnerChannelId === null
				? `This vault has existing ${options.cacheLabel} that are not linked to a YouTube channel.`
				: `This vault's ${options.cacheLabel} belong to ${options.storedOwnerChannelId}. The connected channel is ${currentChannel}.`,
		});
		contentEl.createEl('p', {
			text: options.allowAssociate && options.allowReplace
				? `Use existing data with ${currentChannel}, or replace it only after current account data is fetched successfully.`
				: options.allowAssociate
					? `Use existing data with ${currentChannel} to continue.`
					: options.allowReplace
						? 'Replacement happens only after data for the connected account is fetched successfully.'
						: 'To prevent account data from mixing, this operation has been stopped.',
		});
		contentEl.createEl('p', {
			text: 'AI summaries and Obsidian notes remain shared in this vault.',
		});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.choose('cancel'));
		if (options.allowAssociate) {
			const associate = actions.createEl('button', { text: 'Use existing data' });
			associate.addEventListener('click', () => this.choose('associate'));
		}
		if (options.allowReplace) {
			const replace = actions.createEl('button', {
				text: 'Replace with connected account',
				cls: 'mod-warning',
			});
			replace.addEventListener('click', () => this.choose('replace'));
		}
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolveChoice('cancel');
	}

	private choose(choice: CacheOwnershipChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolveChoice(choice);
		this.close();
	}
}

export function chooseCacheOwnership(
	app: App,
	options: CacheOwnershipModalOptions,
): Promise<CacheOwnershipChoice> {
	return new Promise((resolve) => {
		new CacheOwnershipModal(app, options, resolve).open();
	});
}
