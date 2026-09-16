import {
	ItemView,
	Menu,
	MenuItem,
	ViewStateResult,
	WorkspaceLeaf,
	Notice,
} from "obsidian";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { localStorageService } from "src/storage";
import { debugLogger } from "src/debug";
import { PlaylistInfo } from "src/types";
import { YouTubeRequestError } from "src/services/youtubeApiClient";
import { confirmDangerousAction } from "src/utils/confirmationUtils";
import GoogleLikedVideoPlugin from "../main";
import { PluginContext } from "../store/pluginContext";
import { UserPlaylistsView } from "./UserPlaylistsView";
import type { UserPlaylistsViewState } from "./UserPlaylistsView";
import { VIEW_TYPE_PLAYLIST_VIDEOS } from "./PlaylistVideosPane";

function readBrowsingState(state: unknown): UserPlaylistsViewState {
	const saved = typeof state === "object" && state !== null
		? state as Record<string, unknown> : {};
	const sortOption = saved.sortOption ?? localStorageService.getPlaylistsSortOption();
	const sortOrder = saved.sortOrder ?? localStorageService.getPlaylistsSortOrder();
	return {
		searchTerm: typeof saved.searchTerm === "string" ? saved.searchTerm : "",
		sortOption: sortOption === "itemCount" || sortOption === "publishedAt" ? sortOption : "title",
		sortOrder: sortOrder === "DESC" ? "DESC" : "ASC",
	};
}

export const VIEW_TYPE_USER_PLAYLISTS = "user-playlists";

export class UserPlaylistsPane extends ItemView {
	root: Root | null = null;

	playlists: PlaylistInfo[] = [];
	isLoading = false;
	hasLoaded = false;
	error: string | null = null;
	plugin: GoogleLikedVideoPlugin | null = null;
	private isDeletingPlaylist = false;
	private loadRequestId = 0;
	private activeLoadId: number | null = null;
	private browsingState: UserPlaylistsViewState = readBrowsingState(undefined);

	constructor(leaf: WorkspaceLeaf, plugin: GoogleLikedVideoPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	onPaneMenu(menu: Menu, source: string): void {
		super.onPaneMenu(menu, source);
		menu.addItem((item: MenuItem) => {
			item.setTitle("Refresh Playlists");
			item.setIcon("refresh-cw");
			item.setDisabled(this.isLoading);
			item.onClick(() => {
				void this.loadPlaylists();
			});
		});

		menu.addItem((item: MenuItem) => {
			item.setTitle("Clear Cache");
			item.setIcon("trash-2");
			item.onClick(() => {
				if (this.plugin?.playlistApi) {
					this.plugin.playlistApi.clearAllCaches();
					new Notice("Playlist cache cleared");
				}
			});
		});
	}

	getViewType(): string {
		return VIEW_TYPE_USER_PLAYLISTS;
	}

	getDisplayText(): string {
		return "My Playlists";
	}

	getIcon(): string {
		return "list-video";
	}

	async onOpen(): Promise<void> {
		this.root = createRoot(this.containerEl.children[1]);
		await this.loadPlaylists();
	}

	private mergeSavedPlaylists(playlists: PlaylistInfo[]): PlaylistInfo[] {
		const playlistIds = new Set(playlists.map((playlist) => playlist.id));
		const savedPlaylists = localStorageService.getSavedPlaylists()
			.filter((saved) => !playlistIds.has(saved.id))
			.map((saved): PlaylistInfo => ({
				id: saved.id,
				title: saved.title,
				description: saved.description,
				itemCount: saved.itemCount,
				thumbnailUrl: saved.thumbnailUrl,
				publishedAt: saved.publishedAt,
				isOwnedByUser: false,
			}));
		return [...playlists, ...savedPlaylists];
	}

	private async loadPlaylists(): Promise<void> {
		if (!this.root || this.activeLoadId !== null) return;
		const requestId = ++this.loadRequestId;
		this.activeLoadId = requestId;
		this.isLoading = true;
		this.error = null;

		try {
			this.playlists = this.mergeSavedPlaylists(this.playlists);
			this.renderView();
			if (!this.plugin?.playlistApi) throw new Error("Playlist API not available");
			const userPlaylists = await this.plugin.playlistApi.fetchUserPlaylists();
			if (this.activeLoadId !== requestId) return;
			this.playlists = this.mergeSavedPlaylists(userPlaylists);
			this.hasLoaded = true;
		} catch (error) {
			if (this.activeLoadId !== requestId) return;
			debugLogger.error("Failed to load playlists:", error);
			if (error instanceof YouTubeRequestError
				&& error.reasons.some((reason) => reason === "quotaExceeded" || reason === "dailyLimitExceeded")) {
				this.error = "YouTube API quota exceeded. Please try again later.";
			} else if (error instanceof YouTubeRequestError && error.kind === "auth") {
				this.error = "Authentication expired. Please refresh your login.";
			} else if (error instanceof YouTubeRequestError && error.status === 403) {
				this.error = "YouTube did not allow access to these playlists.";
			} else {
				this.error = `Failed to load playlists: ${error instanceof Error ? error.message : "Unknown error"}`;
			}
			new Notice(this.error);
		} finally {
			if (this.activeLoadId === requestId) {
				this.activeLoadId = null;
				this.isLoading = false;
				this.renderView();
			}
		}
	}

	private renderView() {
		if (!this.root) return;

		this.root.render(
			<StrictMode>
				<PluginContext.Provider value={this.plugin}>
					<UserPlaylistsView
						browsingState={this.browsingState}
						onStateChange={(state) => {
							this.browsingState = { ...this.browsingState, ...state };
							this.renderView();
							this.app.workspace.requestSaveLayout();
						}}
						playlists={this.playlists}
						isLoading={this.isLoading}
						hasLoaded={this.hasLoaded}
						error={this.error}
						onPlaylistSelect={(playlist: PlaylistInfo) => {
							void this.openPlaylistVideos(playlist);
						}}
						onRefresh={() => {
							void this.loadPlaylists();
						}}
						onAddPlaylist={(playlistId: string) =>
							this.handleAddPlaylist(playlistId)
						}
						onDeletePlaylist={(playlist: PlaylistInfo) =>
							this.handleDeletePlaylist(playlist)
						}
					/>
				</PluginContext.Provider>
			</StrictMode>,
		);
	}

	private async handleDeletePlaylist(playlist: PlaylistInfo): Promise<void> {
		const root = this.root;
		if (
			!root || this.isDeletingPlaylist ||
			playlist.isOwnedByUser !== true ||
			!this.plugin?.playlistApi
		) {
			return;
		}

		this.isDeletingPlaylist = true;

		try {
			const confirmed = await confirmDangerousAction(
				this.app,
				`"${playlist.title}"\n\nYouTube에서 영구 삭제되며 복구할 수 없음`,
				{
					title: "YouTube 플레이리스트 삭제",
					confirmText: "영구 삭제",
				},
			);

			if (!confirmed || this.root !== root) return;

			await this.plugin.playlistApi.deletePlaylist(playlist.id);
			localStorageService.unpinPlaylist(playlist.id);
			localStorageService.removeSavedPlaylist(playlist.id);
			if (this.root !== root) return;
			this.activeLoadId = null;
			this.isLoading = false;
			this.playlists = this.playlists.filter(
				(item) => item.id !== playlist.id,
			);
			this.renderView();
			new Notice(`Playlist "${playlist.title}" deleted from YouTube.`);
		} catch (error) {
			if (this.root !== root) return;
			const message =
				error instanceof Error ? error.message : "Unknown error";
			new Notice(`Failed to delete playlist: ${message}`);
		} finally {
			this.isDeletingPlaylist = false;
		}
	}

	private async handleAddPlaylist(playlistId: string): Promise<boolean> {
		const root = this.root;
		if (!root) return false;
		if (!this.plugin?.playlistApi) {
			throw new Error("Playlist API not available");
		}

		try {
			// Fetch playlist info from YouTube API
			const playlistInfo =
				await this.plugin.playlistApi.fetchPlaylistById(playlistId);
			if (this.root !== root) return false;

			// Try to add to local storage
			const success = localStorageService.addSavedPlaylist(playlistInfo);

			if (success) {
				this.playlists = this.mergeSavedPlaylists(this.playlists);
				this.renderView();
				// Reload playlists to include the new one
				await this.loadPlaylists();
				if (this.root !== root) return true;
				new Notice(
					`Playlist "${playlistInfo.title}" added successfully!`,
				);
				return true;
			} else {
				return false; // Already exists
			}
		} catch (error) {
			console.error("Failed to add playlist:", error);
			throw error; // Re-throw to be handled by the UI
		}
	}

	async onClose(): Promise<void> {
		this.activeLoadId = null;
		this.isLoading = false;
		this.root?.unmount();
		this.root = null;
	}

	// Open the playlist videos pane for the selected playlist
	private async openPlaylistVideos(playlist: PlaylistInfo) {
		const { workspace } = this.app;

		// Create playlist source based on the playlist type
		const playlistSource = {
			type: "playlist" as const,
			playlistId: playlist.id,
		};

		// Check if a playlist videos view with this specific playlist ID already exists
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_PLAYLIST_VIDEOS);

		// Find a leaf that's already showing this specific playlist
		for (const existingLeaf of leaves) {
			const view = existingLeaf.view;
			if (view && "playlistInfo" in view) {
				// Type-safe check for playlist view
				const playlistView = view as { playlistInfo?: PlaylistInfo };
				if (playlistView.playlistInfo?.id === playlist.id) {
					leaf = existingLeaf;
					break;
				}
			}
		}

		// If no existing leaf for this playlist, create a new one
		if (!leaf) {
			// Create a new leaf in the right sidebar
			leaf = workspace.getRightLeaf(false);
		}

		if (leaf) {
			const viewState = {
				type: VIEW_TYPE_PLAYLIST_VIDEOS,
				active: true,
				state: {
					playlistSource,
					playlistInfo: playlist,
				},
			};

			await leaf.setViewState(viewState);

			// Reveal the leaf
			void workspace.revealLeaf(leaf);
		}
	}

	async setState(
		state: unknown,
		result: ViewStateResult,
	): Promise<void> {
		this.browsingState = readBrowsingState(state);
		this.renderView();
		return super.setState(state, result);
	}

	getState(): Record<string, unknown> {
		return { ...this.browsingState };
	}
}
