import { App, Modal, Notice, SearchComponent, setIcon } from 'obsidian';
import { PlaylistApi } from 'src/api';
import { debugLogger } from 'src/debug';
import { PlaylistInfo } from 'src/types';

export class AddToPlaylistModal extends Modal {
	private playlists: PlaylistInfo[] = [];
	private visible = false;
	private busy = false;
	private searchInput!: HTMLInputElement;
	private listEl!: HTMLElement;
	private selectedId = '';
	private selectionEl!: HTMLElement;
	private static nextGroupId = 0;
	private readonly groupName = `geulo-playlist-${AddToPlaylistModal.nextGroupId++}`;
	private statusEl!: HTMLElement;
	private addButton!: HTMLButtonElement;
	private retryButton!: HTMLButtonElement;

	constructor(app: App, private api: PlaylistApi, private videoId: string, private videoTitle: string) {
		super(app);
		this.setTitle('Add to playlist');
	}

	onOpen(): void {
		this.visible = true;
		this.contentEl.empty();
		this.modalEl.addClass('geulo-add-playlist-modal');
		this.contentEl.addClass('geulo-add-playlist');
		const video = this.contentEl.createDiv({ cls: 'geulo-add-playlist__video' });
		setIcon(video.createSpan({ cls: 'geulo-add-playlist__video-icon' }), 'youtube');
		const videoText = video.createDiv();
		videoText.createDiv({ text: 'Adding video', cls: 'geulo-add-playlist__eyebrow' });
		videoText.createDiv({ text: this.videoTitle, cls: 'geulo-add-playlist__video-title' });
		const search = new SearchComponent(this.contentEl.createDiv({ cls: 'geulo-add-playlist__search' }));
		this.searchInput = search.inputEl;
		this.searchInput.setAttribute('aria-label', 'Search playlists');
		search.setPlaceholder('Search your playlists…').onChange(() => this.filterPlaylists());
		this.statusEl = this.contentEl.createDiv({ cls: 'geulo-add-playlist__status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.listEl = this.contentEl.createDiv({ cls: 'geulo-add-playlist__list', attr: { role: 'radiogroup', 'aria-label': 'Your playlists' } });
		const footer = this.contentEl.createDiv({ cls: 'geulo-add-playlist__footer' });
		this.selectionEl = footer.createDiv({ cls: 'geulo-add-playlist__selection', text: 'Choose a playlist to continue' });
		const actions = footer.createDiv({ cls: 'geulo-add-playlist__actions' });
		this.retryButton = actions.createEl('button', { text: 'Retry loading' });
		this.retryButton.addEventListener('click', () => { void this.loadPlaylists(); });
		const cancelButton = actions.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());
		this.addButton = actions.createEl('button', { text: 'Add to playlist', cls: 'mod-cta' });
		this.addButton.disabled = true;
		this.addButton.addEventListener('click', () => { void this.addVideo(); });
		this.contentEl.createDiv({
			cls: 'geulo-add-playlist__note',
			text: '50 units per addition, plus playlist lookup and duplicate checks.',
		});
		void this.loadPlaylists();
	}

	onClose(): void {
		this.visible = false;
		this.contentEl.empty();
	}

	private async loadPlaylists(): Promise<void> {
		if (this.busy) return;
		this.setBusy(true);
		this.retryButton.hide();
		this.statusEl.setText('Loading your playlists…');
		try {
			const playlists = await this.api.fetchUserPlaylists();
			if (!this.visible) return;
			this.playlists = playlists.filter((playlist) => playlist.isOwnedByUser)
				.sort((left, right) => left.title.localeCompare(right.title));
			this.filterPlaylists();
		} catch (error: unknown) {
			debugLogger.error('Failed to load playlists for adding a video:', error);
			if (!this.visible) return;
			this.statusEl.setText('Could not load your playlists. Please try again.');
			this.retryButton.show();
		} finally {
			if (this.visible) {
				this.setBusy(false);
				this.searchInput.focus();
			}
		}
	}

	private filterPlaylists(): void {
		const query = this.searchInput.value.trim().toLowerCase();
		const matches = this.playlists.filter((playlist) => playlist.title.toLowerCase().includes(query));
		if (!matches.some((playlist) => playlist.id === this.selectedId)) this.selectedId = '';
		this.listEl.empty();
		for (const playlist of matches) {
			const row = this.listEl.createEl('label', { cls: 'geulo-add-playlist__row' });
			const radio = row.createEl('input', { type: 'radio', attr: { name: this.groupName, 'aria-label': playlist.title } });
			radio.value = playlist.id;
			radio.checked = playlist.id === this.selectedId;
			radio.disabled = this.busy;
			const thumbnail = row.createDiv({ cls: 'geulo-add-playlist__thumbnail' });
			setIcon(thumbnail, 'list-video');
			if (playlist.thumbnailUrl) {
				const img = thumbnail.createEl('img', { attr: { src: playlist.thumbnailUrl, alt: '', loading: 'lazy' } });
				img.addEventListener('error', () => img.remove(), { once: true });
			}
			const info = row.createDiv({ cls: 'geulo-add-playlist__info' });
			info.createDiv({ text: playlist.title, cls: 'geulo-add-playlist__title' });
			const metadata = [`${playlist.itemCount} ${playlist.itemCount === 1 ? 'video' : 'videos'}`];
			const duplicateTitle = this.playlists.some((other) => other.id !== playlist.id && other.title === playlist.title);
			if (duplicateTitle && playlist.publishedAt) {
				const date = new Date(playlist.publishedAt);
				if (!Number.isNaN(date.getTime())) metadata.push(`Created ${date.toLocaleDateString()}`);
			}
			info.createDiv({ text: metadata.join(' · '), cls: 'geulo-add-playlist__meta' });
			if (playlist.description) info.createDiv({ text: playlist.description, cls: 'geulo-add-playlist__description' });
			radio.setAttribute('aria-label', [playlist.title, ...metadata, playlist.description].filter(Boolean).join(', '));
			radio.addEventListener('change', () => {
				this.selectedId = playlist.id;
				this.updateSelection();
			});
		}
		this.statusEl.setText(`${matches.length} ${matches.length === 1 ? 'playlist' : 'playlists'}`);
		if (matches.length === 0) {
			const empty = this.listEl.createDiv({ cls: 'geulo-add-playlist__empty' });
			setIcon(empty.createDiv(), 'list-video');
			empty.createEl('strong', { text: this.playlists.length === 0 ? 'No playlists yet' : 'No matching playlists' });
			empty.createEl('p', { text: this.playlists.length === 0
				? 'Create a playlist on YouTube, then reopen this window.' : 'Try a different name or clear your search.' });
		}
		this.updateSelection();
	}

	private updateSelection(): void {
		const selected = this.playlists.find((playlist) => playlist.id === this.selectedId);
		this.selectionEl.setText(selected ? `Selected: ${selected.title}` : 'Choose a playlist to continue');
		this.addButton.disabled = this.busy || !selected;
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.searchInput.disabled = busy;
		this.listEl.setAttribute('aria-busy', String(busy));
		this.listEl.querySelectorAll('input').forEach((input) => { input.disabled = busy; });
		this.updateSelection();
	}

	private async addVideo(): Promise<void> {
		if (this.busy) return;
		const playlist = this.playlists.find((item) => item.id === this.selectedId);
		if (!playlist) return;
		this.setBusy(true);
		this.statusEl.setText('Checking and adding video…');
		this.addButton.setText('Adding…');
		try {
			const result = await this.api.addVideoToPlaylist(playlist.id, this.videoId);
			new Notice(result === 'added' ? `Added to ${playlist.title}` : `This video is already in ${playlist.title}`);
			if (this.visible) this.close();
		} catch (error: unknown) {
			debugLogger.error('Failed to add video to playlist:', error);
			const message = error instanceof Error ? error.message : 'Could not add video to playlist';
			if (this.visible) this.statusEl.setText(`${message}. You can try again; playlist membership will be checked first.`);
			else new Notice(message);
		} finally {
			if (this.visible) {
				this.setBusy(false);
				this.addButton.setText('Add to playlist');
			}
		}
	}
}
