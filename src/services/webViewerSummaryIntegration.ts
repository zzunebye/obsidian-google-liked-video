import { Component, Notice, Platform } from 'obsidian';
import type { Menu, View, WorkspaceLeaf } from 'obsidian';
import { debugLogger } from 'src/debug';
import type GoogleLikedVideoPlugin from 'src/main';
import type { PlaylistInfo, YouTubeVideo } from 'src/types';
import { isYouTubeVideo } from 'src/utils/youtubeVideoValidation';
import { VIEW_TYPE_TRANSCRIPT } from 'src/views/TranscriptPane';
import { PlaylistVideosPane, VIEW_TYPE_PLAYLIST_VIDEOS } from 'src/views/PlaylistVideosPane';
import { getActiveApiKey } from './aiServiceFactory';
import { YouTubeApiClient, YouTubeRequestError } from './youtubeApiClient';

interface ViewerElement extends HTMLElement {
	getURL(): string;
}

interface NativeMenuFactory {
	buildFromTemplate(items: unknown[]): unknown;
}

interface WebViewerMenuAction {
	label: string;
	icon: string;
	section: 'geulo-video' | 'geulo-playlist';
	enabled: boolean;
	click: () => void;
}

interface YouTubePageContext {
	videoId: string | null;
	playlistId: string | null;
	hasPlaylistContext: boolean;
}

type ContextMenuView = View & { displayContextMenu?: (event: Event) => void };
type ElectronWindow = Window & { electron?: { remote?: { Menu?: NativeMenuFactory } } };

function getPageContext(view: View): YouTubePageContext | null {
	try {
		const viewer = view.containerEl.querySelector('webview') as Partial<ViewerElement> | null;
		const value: unknown = typeof viewer?.getURL === 'function' ? viewer.getURL() : view.getState().url;
		if (typeof value !== 'string') return null;
		const url = new URL(value);
		if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) return null;
		let id: string | null = null;
		if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
		else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
			id = url.pathname === '/watch'
				? url.searchParams.get('v')
				: url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/)?.[1] ?? null;
		}
		const list = url.searchParams.get('list');
		return {
			videoId: id && /^[\w-]{11}$/.test(id) ? id : null,
			playlistId: list && /^[A-Za-z0-9_-]+$/.test(list) ? list : null,
			hasPlaylistContext: url.pathname.replace(/\/$/, '') === '/playlist' || url.searchParams.has('list'),
		};
	} catch {
		// A Web Viewer can be detached or still loading while its menu opens.
		return null;
	}
}

export class WebViewerSummaryIntegration extends Component {
	private active = false;
	private readonly restoreMenus = new Map<View, () => void>();
	private readonly opening = new Set<string>();
	private readonly videoRequests = new Map<string, Promise<YouTubeVideo>>();
	private readonly controller = new AbortController();

	constructor(private readonly plugin: GoogleLikedVideoPlugin, private readonly client: YouTubeApiClient) {
		super();
	}

	onload(): void {
		if (Platform.isMobile) return;
		this.active = true;
		const workspace = this.plugin.app.workspace;
		workspace.onLayoutReady(() => this.syncViews());
		this.registerEvent(workspace.on('layout-change', () => this.syncViews()));
		this.registerEvent(workspace.on('active-leaf-change', () => this.syncViews()));
	}

	onunload(): void {
		this.active = false;
		this.controller.abort();
		this.restoreMenus.forEach(restore => restore());
		this.restoreMenus.clear();
	}

	private syncViews(): void {
		if (!this.active) return;
		const leaves = this.plugin.app.workspace.getLeavesOfType('webviewer');
		const views = new Set(leaves.map(leaf => leaf.view));
		for (const [view, restore] of this.restoreMenus) {
			if (!views.has(view)) {
				restore();
				this.restoreMenus.delete(view);
			}
		}
		for (const leaf of leaves) {
			const view = leaf.view;
			if (this.restoreMenus.has(view)) continue;
			const original = view.onPaneMenu;
			const descriptor = Object.getOwnPropertyDescriptor(view, 'onPaneMenu');
			let attached = true;
			// Web Viewer has no dedicated public menu event. Wrap only this view,
			// preserve its native items, and restore the method when detached/unloaded.
			const wrapped: View['onPaneMenu'] = (menu, source) => {
				original.call(view, menu, source);
				if (attached && this.active) this.addMenuItem(menu, leaf);
			};
			view.onPaneMenu = wrapped;
			const onPageMenu = (event: Event): void => {
				if (attached && this.active) this.onPageMenu(event, leaf);
			};
			view.containerEl.addEventListener('context-menu', onPageMenu, true);
			this.restoreMenus.set(view, () => {
				attached = false;
				view.containerEl.removeEventListener('context-menu', onPageMenu, true);
				// Another plugin may have wrapped us since attachment. Do not erase it.
				if (view.onPaneMenu !== wrapped) return;
				if (descriptor) Object.defineProperty(view, 'onPaneMenu', descriptor);
				else delete (view as Partial<View>).onPaneMenu;
			});
		}
	}

	private addMenuItem(menu: Menu, sourceLeaf: WorkspaceLeaf): void {
		for (const action of this.getMenuActions(sourceLeaf)) {
			menu.addItem(item => item.setSection(action.section).setTitle(action.label)
				.setIcon(action.icon).setDisabled(!action.enabled).onClick(action.click));
		}
	}

	private getMenuActions(sourceLeaf: WorkspaceLeaf): WebViewerMenuAction[] {
		const context = getPageContext(sourceLeaf.view);
		if (!context) return [];
		const actions = context.videoId ? this.getVideoActions(context.videoId, sourceLeaf) : [];
		if (context.hasPlaylistContext) {
			const id = context.playlistId;
			const known = id ? this.plugin.playlistImports.getKnownPlaylist(id) : undefined;
			const busy = !!id && (this.plugin.playlistImports.isImporting(id) || this.opening.has(`playlist:${id}`));
			actions.push({
				label: busy ? 'Geulo: Importing playlist…' : known ? 'Geulo: Open playlist in Geulo' : 'Geulo: Import playlist to Geulo',
				icon: 'list-video', section: 'geulo-playlist', enabled: !!id && !busy,
				click: () => { if (id) void this.importOrOpenPlaylist(id, sourceLeaf); },
			});
		}
		return actions;
	}

	private getVideoActions(videoId: string, sourceLeaf: WorkspaceLeaf): WebViewerMenuAction[] {
		const readerEnabled = !this.opening.has(`reader:${videoId}`);
		const noteExists = this.plugin.videoNoteIndex.has(videoId);
		return [
			{
				label: this.plugin.summaryStorage.hasVideoSummary(videoId) ? 'Geulo: Open AI summary' : 'Geulo: Create AI summary',
				icon: 'bot', section: 'geulo-video', enabled: readerEnabled,
				click: () => { void this.openReader(videoId, sourceLeaf, 'ai'); },
			},
			{
				label: 'Geulo: Read transcript', icon: 'captions', section: 'geulo-video', enabled: readerEnabled,
				click: () => { void this.openReader(videoId, sourceLeaf, 'paragraphs'); },
			},
			{
				label: noteExists ? 'Geulo: Open video note' : 'Geulo: Create video note',
				icon: noteExists ? 'file-check' : 'file-plus', section: 'geulo-video', enabled: !this.opening.has(`note:${videoId}`),
				click: () => { void this.openVideoNote(videoId, sourceLeaf); },
			},
		];
	}

	private onPageMenu(event: Event, sourceLeaf: WorkspaceLeaf): void {
		const view: ContextMenuView = sourceLeaf.view;
		if (event.target !== view.containerEl.querySelector('webview') || !('params' in event)) return;
		const actions = this.getMenuActions(sourceLeaf);
		const factory = (window as ElectronWindow).electron?.remote?.Menu;
		const displayContextMenu = view.displayContextMenu;
		if (actions.length === 0 || typeof displayContextMenu !== 'function' || typeof factory?.buildFromTemplate !== 'function') return;
		const descriptor = Object.getOwnPropertyDescriptor(factory, 'buildFromTemplate');
		if (!descriptor?.configurable) return;
		const original = factory.buildFromTemplate;
		// The core viewer builds its native menu synchronously without an extension
		// event. Restore the factory before building so nested menus stay untouched.
		const wrapped: NativeMenuFactory['buildFromTemplate'] = items => {
			Object.defineProperty(factory, 'buildFromTemplate', descriptor);
			return original.call(factory, [
				...items,
				{ type: 'separator' },
				...actions.flatMap(({ label, enabled, click, section }, index) => [
					...(index > 0 && section !== actions[index - 1].section ? [{ type: 'separator' }] : []),
					{ label, enabled, click },
				]),
			]);
		};
		Object.defineProperty(factory, 'buildFromTemplate', { configurable: true, value: wrapped });
		try {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			displayContextMenu.call(view, event);
		} finally {
			if (factory.buildFromTemplate === wrapped) Object.defineProperty(factory, 'buildFromTemplate', descriptor);
		}
	}

	private async importOrOpenPlaylist(id: string, sourceLeaf: WorkspaceLeaf): Promise<void> {
		const key = `playlist:${id}`;
		if (!this.active || this.opening.has(key) || this.plugin.playlistImports.isImporting(id)) return;
		this.opening.add(key);
		let loading: Notice | undefined;
		try {
			const known = this.plugin.playlistImports.getKnownPlaylist(id);
			if (known) {
				await this.openPlaylist(known, sourceLeaf);
				return;
			}
			loading = new Notice('Geulo: Importing playlist…', 0);
			const result = await this.plugin.playlistImports.importPlaylist(id);
			if (!this.active) return;
			if (result.imported) new Notice(`Geulo: Imported "${result.playlist.title}". Find it in My Playlists.`);
			else await this.openPlaylist(result.playlist, sourceLeaf);
		} catch (error: unknown) {
			if (!this.active) return;
			debugLogger.error('[Web Viewer] Could not import or open playlist', id, error);
			new Notice(error instanceof YouTubeRequestError && error.kind === 'auth'
				? 'Geulo: Reconnect YouTube in plugin settings to import this playlist.'
				: `Geulo: Could not import or open playlist. ${error instanceof Error ? error.message : 'Please try again.'}`);
		} finally {
			loading?.hide();
			this.opening.delete(key);
		}
	}

	private async openPlaylist(playlist: PlaylistInfo, sourceLeaf: WorkspaceLeaf): Promise<void> {
		const workspace = this.plugin.app.workspace;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_PLAYLIST_VIDEOS).find(leaf =>
			leaf.view instanceof PlaylistVideosPane && leaf.view.playlistInfo.id === playlist.id);
		const leaf = existing ?? this.createResultLeaf(sourceLeaf);
		if (!existing) await leaf.setViewState({
			type: VIEW_TYPE_PLAYLIST_VIDEOS, active: true,
			state: { playlistSource: { type: 'playlist', playlistId: playlist.id }, playlistInfo: playlist },
		});
		await workspace.revealLeaf(leaf);
	}

	private async openReader(videoId: string, sourceLeaf: WorkspaceLeaf, displayMode: 'ai' | 'paragraphs'): Promise<void> {
		const key = `reader:${videoId}`;
		if (!this.active || this.opening.has(key)) return;
		if (displayMode === 'ai' && !this.plugin.summaryStorage.hasVideoSummary(videoId)
			&& (!this.plugin.settings.enableAISummary || !getActiveApiKey(this.plugin.settings))) {
			new Notice('Geulo: Enable AI summaries and configure your AI provider in plugin settings.');
			return;
		}
		this.opening.add(key);
		let loading: Notice | undefined;
		try {
			const workspace = this.plugin.app.workspace;
			const existing = workspace.getLeavesOfType(VIEW_TYPE_TRANSCRIPT).find(leaf => {
				const video: unknown = leaf.view.getState().video;
				return isYouTubeVideo(video) && video.id === videoId;
			});
			if (existing) {
				await existing.setViewState({
					type: VIEW_TYPE_TRANSCRIPT,
					state: { ...existing.view.getState(), displayMode }, active: true,
				});
				await workspace.revealLeaf(existing);
				return;
			}
			loading = new Notice(displayMode === 'ai' ? 'Geulo: Opening AI summary…' : 'Geulo: Opening transcript…', 0);
			const video = await this.getVideo(videoId);
			if (!this.active) return;
			// Anchor the result beside the originating viewer even if focus changed
			// while metadata loaded. The captured ID also survives YouTube navigation.
			const leaf = this.createResultLeaf(sourceLeaf);
			await leaf.setViewState({ type: VIEW_TYPE_TRANSCRIPT, state: { video, displayMode }, active: true });
			await workspace.revealLeaf(leaf);
		} catch (error: unknown) {
			if (!this.active) return;
			debugLogger.error('[Web Viewer] Could not open reader', videoId, error);
			new Notice(error instanceof YouTubeRequestError && error.kind === 'auth'
				? 'Geulo: Reconnect YouTube in plugin settings to load this video’s details.'
				: 'Geulo: Could not load this video. Check its availability and try again.');
		} finally {
			loading?.hide();
			this.opening.delete(key);
		}
	}

	private async openVideoNote(videoId: string, sourceLeaf: WorkspaceLeaf): Promise<void> {
		const key = `note:${videoId}`;
		if (!this.active || this.opening.has(key)) return;
		this.opening.add(key);
		let loading: Notice | undefined;
		try {
			let file = this.plugin.videoNoteIndex.get(videoId);
			if (!file) {
				loading = new Notice('Geulo: Opening video note…', 0);
				const video = await this.getVideo(videoId);
				if (!this.active) return;
				const result = await this.plugin.videoNotes.getOrCreate(video);
				file = result.file;
				if (result.created) new Notice(`Created note: ${file.basename}`);
			} else {
				await this.plugin.videoNotes.refreshLiked(videoId, file);
			}
			if (!this.active) return;
			const workspace = this.plugin.app.workspace;
			const filePath = file.path;
			const existing = workspace.getLeavesOfType('markdown').find(leaf => leaf.view.getState().file === filePath);
			const leaf = existing ?? this.createResultLeaf(sourceLeaf);
			if (!existing) await leaf.openFile(file);
			await workspace.revealLeaf(leaf);
		} catch (error: unknown) {
			if (!this.active) return;
			debugLogger.error('[Web Viewer] Could not open video note', videoId, error);
			new Notice(error instanceof YouTubeRequestError && error.kind === 'auth'
				? 'Geulo: Reconnect YouTube in plugin settings to load this video’s details.'
				: 'Geulo: Could not create or open this video note. Check its file path and try again.');
		} finally {
			loading?.hide();
			this.opening.delete(key);
		}
	}

	private createResultLeaf(sourceLeaf: WorkspaceLeaf): WorkspaceLeaf {
		const workspace = this.plugin.app.workspace;
		return workspace.getLeavesOfType('webviewer').includes(sourceLeaf)
			? workspace.createLeafBySplit(sourceLeaf, 'vertical') : workspace.getLeaf('tab');
	}

	private async getVideo(videoId: string): Promise<YouTubeVideo> {
		const cached = this.plugin.likedVideoStorage?.getVideos().find(video => video.id === videoId)
			?? this.plugin.subscriptionService.getSnapshot()?.videos.find(video => video.id === videoId)
			?? this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TRANSCRIPT)
				.map(leaf => leaf.view.getState().video).find((video): video is YouTubeVideo => isYouTubeVideo(video) && video.id === videoId);
		if (cached) return cached;
		const pending = this.videoRequests.get(videoId);
		if (pending) return pending;
		const request = this.fetchVideo(videoId);
		this.videoRequests.set(videoId, request);
		try { return await request; }
		finally { this.videoRequests.delete(videoId); }
	}

	private async fetchVideo(videoId: string): Promise<YouTubeVideo> {
		const response = await this.client.request('GET',
			`videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(videoId)}`,
			{ signal: this.controller.signal });
		const data: unknown = response.json;
		const items: unknown = data && typeof data === 'object' && 'items' in data
			? (data as { items: unknown }).items : undefined;
		const video: unknown = Array.isArray(items) ? items.find((item: unknown) => isYouTubeVideo(item) && item.id === videoId) : undefined;
		if (!isYouTubeVideo(video)) throw new Error('YouTube did not return this video’s details.');
		return { ...video, pulled_at: new Date().toISOString() };
	}
}
