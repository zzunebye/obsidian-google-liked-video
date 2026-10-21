import { App, Modal } from 'obsidian';
import { t } from '../i18n';

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
		const cacheLabel = options.cacheLabel === 'liked videos' ? t("settings.likedVideos") : t("settings.subscriptions");
		const formatCacheText = (key: "cacheOwnership.connectTitle" | "cacheOwnership.replaceTitle" | "cacheOwnership.unlinked" | "cacheOwnership.linked" | "cacheOwnership.useWithAccount" | "cacheOwnership.useExisting" | "cacheOwnership.replaceSafety" | "cacheOwnership.stopped") =>
			t(key).replace("{cache}", cacheLabel);
		this.setTitle(formatCacheText(options.storedOwnerChannelId === null
			? "cacheOwnership.connectTitle" : "cacheOwnership.replaceTitle"));
		const currentChannel = options.currentChannelTitle
			? `${options.currentChannelTitle} (${options.currentChannelId})`
			: options.currentChannelId;
		contentEl.createEl('p', {
			text: options.storedOwnerChannelId === null
				? formatCacheText("cacheOwnership.unlinked")
				: formatCacheText("cacheOwnership.linked").replace("{owner}", options.storedOwnerChannelId).replace("{current}", currentChannel),
		});
		contentEl.createEl('p', {
			text: options.allowAssociate && options.allowReplace
				? formatCacheText("cacheOwnership.useWithAccount").replace("{current}", currentChannel)
				: options.allowAssociate
					? formatCacheText("cacheOwnership.useExisting").replace("{current}", currentChannel)
					: options.allowReplace
						? formatCacheText("cacheOwnership.replaceSafety")
						: formatCacheText("cacheOwnership.stopped"),
		});
		contentEl.createEl('p', {
			text: t("cacheOwnership.sharedData"),
		});

		const actions = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancel = actions.createEl('button', { text: t("settings.cancel") });
		cancel.addEventListener('click', () => this.choose('cancel'));
		if (options.allowAssociate) {
			const associate = actions.createEl('button', { text: t("cacheOwnership.useExistingButton") });
			associate.addEventListener('click', () => this.choose('associate'));
		}
		if (options.allowReplace) {
			const replace = actions.createEl('button', {
				text: t("cacheOwnership.replaceButton"),
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
