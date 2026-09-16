import { Component } from 'obsidian';
import type { PlaylistApi } from 'src/api';
import { localStorageService } from 'src/storage';
import type { PlaylistInfo } from 'src/types';

interface PlaylistImportResult {
	playlist: PlaylistInfo;
	imported: boolean;
}

export class PlaylistImportService extends Component {
	private active = false;
	private readonly pending = new Map<string, Promise<PlaylistImportResult>>();

	constructor(
		private readonly api: PlaylistApi,
		private readonly getLoadedPlaylists: () => readonly PlaylistInfo[] | null,
	) { super(); }

	onload(): void { this.active = true; }
	onunload(): void { this.active = false; }

	getKnownPlaylist(id: string): PlaylistInfo | undefined {
		const loaded = this.getLoadedPlaylists()?.find(playlist => playlist.id === id);
		if (loaded) return loaded;
		const saved = localStorageService.getSavedPlaylists().find(playlist => playlist.id === id);
		return saved ? { ...saved, isOwnedByUser: false } : undefined;
	}

	isImporting(id: string): boolean { return this.pending.has(id); }

	async importPlaylist(input: string): Promise<PlaylistImportResult> {
		this.ensureActive();
		const id = this.api.extractPlaylistId(input);
		if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Enter a valid YouTube playlist URL or ID.');
		if (id === 'WL') throw new Error('YouTube does not allow importing Watch Later through its API.');
		const pending = this.pending.get(id);
		if (pending) return pending;
		const task = this.importById(id);
		this.pending.set(id, task);
		try { return await task; }
		finally { this.pending.delete(id); }
	}

	private async importById(id: string): Promise<PlaylistImportResult> {
		const known = this.getKnownPlaylist(id);
		if (known) return { playlist: known, imported: false };
		const owned = this.getLoadedPlaylists()?.filter(playlist => playlist.isOwnedByUser === true)
			?? await this.api.fetchUserPlaylists();
		this.ensureActive();
		const existing = this.getKnownPlaylist(id) ?? owned.find(playlist => playlist.id === id);
		if (existing) return { playlist: existing, imported: false };
		const playlist = await this.api.fetchPlaylistById(id);
		this.ensureActive();
		if (playlist.id !== id) throw new Error('YouTube returned a different playlist. Please try again.');
		const addedElsewhere = this.getKnownPlaylist(id);
		if (addedElsewhere) return { playlist: addedElsewhere, imported: false };
		return { playlist, imported: localStorageService.addSavedPlaylist(playlist) };
	}

	private ensureActive(): void {
		if (!this.active) throw new DOMException('Playlist import was cancelled.', 'AbortError');
	}
}
