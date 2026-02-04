import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf, Notice } from "obsidian";
import { PlaylistInfo } from "src/api";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import GoogleLikedVideoPlugin from "../main";
import { PluginContext } from "../store/pluginContext";
import { UserPlaylistsView } from "./UserPlaylistsView";
import { localStorageService } from "../storage";
import { VIEW_TYPE_PLAYLIST_VIDEOS } from "./PlaylistVideosPane";

interface IUserPlaylistsPaneState {
    playlists: PlaylistInfo[];
    isLoading: boolean;
    error: string | null;
}

export const VIEW_TYPE_USER_PLAYLISTS = "user-playlists";

export class UserPlaylistsPane extends ItemView implements IUserPlaylistsPaneState {
    root: Root | null = null;

    /// Persisted State
    playlists: PlaylistInfo[] = [];
    isLoading = false;
    error: string | null = null;
    plugin: GoogleLikedVideoPlugin | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: GoogleLikedVideoPlugin,
    ) {
        super(leaf);
        this.plugin = plugin;
    }

    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source)
        menu.addItem((item: MenuItem) => {
            item.setTitle("Refresh Playlists");
            item.setIcon("refresh-cw");
            item.onClick(() => {
                this.loadPlaylists();
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

    async onOpen() {
        this.root = createRoot(this.containerEl.children[1]);
        this.renderView();

        // Load playlists after rendering initial view
        await this.loadPlaylists();
    }

    private async loadPlaylists() {
        if (!this.plugin?.playlistApi) {
            this.error = "Playlist API not available";
            this.renderView();
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.renderView();

        try {
            // Load both user playlists from YouTube and saved playlists from local storage
            const [userPlaylists, savedPlaylists] = await Promise.all([
                this.plugin.playlistApi.fetchUserPlaylists().catch(error => {
                    console.warn('Failed to load user playlists:', error);
                    // Show user-friendly error message for authentication issues
                    if (error.message.includes('403') || error.message.includes('quota')) {
                        new Notice('YouTube API quota exceeded. Please try again later.');
                    } else if (error.message.includes('401') || error.message.includes('token')) {
                        new Notice('Authentication expired. Please refresh your login.');
                    } else {
                        new Notice(`Failed to load YouTube playlists: ${error.message}`);
                    }
                    return [];
                }),
                Promise.resolve(localStorageService.getSavedPlaylists())
            ]);

            // Combine and deduplicate playlists (user playlists take precedence)
            const userPlaylistIds = new Set(userPlaylists.map(p => p.id));
            const uniqueSavedPlaylists = savedPlaylists.filter(p => !userPlaylistIds.has(p.id));

            // Convert saved playlists to PlaylistInfo format
            const savedPlaylistInfos: PlaylistInfo[] = uniqueSavedPlaylists.map(saved => ({
                id: saved.id,
                title: saved.title,
                description: saved.description,
                itemCount: saved.itemCount,
                thumbnailUrl: saved.thumbnailUrl
            }));

            // Combine all playlists (user playlists first, then saved playlists)
            this.playlists = [...userPlaylists, ...savedPlaylistInfos];
            this.error = null;
        } catch (error) {
            console.error('Failed to load playlists:', error);
            this.error = `Failed to load playlists: ${error.message || 'Unknown error'}`;
            this.playlists = [];
            new Notice(`Failed to load playlists: ${error.message || 'Unknown error'}`);
        } finally {
            this.isLoading = false;
            this.renderView();
        }
    }

    private renderView() {
        if (!this.root) return;

        this.root.render(
            <StrictMode>
                <PluginContext.Provider value={this.plugin}>
                    <UserPlaylistsView
                        playlists={this.playlists}
                        isLoading={this.isLoading}
                        error={this.error}
                        onPlaylistSelect={(playlist: PlaylistInfo) => this.openPlaylistVideos(playlist)}
                        onRetry={() => this.loadPlaylists()}
                        onAddPlaylist={(playlistId: string) => this.handleAddPlaylist(playlistId)}
                    />
                </PluginContext.Provider>
            </StrictMode>
        );
    }

    private async handleAddPlaylist(playlistId: string): Promise<boolean> {
        if (!this.plugin?.playlistApi) {
            throw new Error("Playlist API not available");
        }

        try {
            // Fetch playlist info from YouTube API
            const playlistInfo = await this.plugin.playlistApi.fetchPlaylistById(playlistId);

            // Try to add to local storage
            const success = localStorageService.addSavedPlaylist(playlistInfo);

            if (success) {
                // Reload playlists to include the new one
                await this.loadPlaylists();
                new Notice(`Playlist "${playlistInfo.title}" added successfully!`);
                return true;
            } else {
                return false; // Already exists
            }
        } catch (error) {
            console.error('Failed to add playlist:', error);
            throw error; // Re-throw to be handled by the UI
        }
    }

    async onClose() {
        this.root?.unmount();
    }

    // Open the playlist videos pane for the selected playlist
    private async openPlaylistVideos(playlist: PlaylistInfo) {
        const { workspace } = this.app;

        // Create playlist source based on the playlist type
        const playlistSource = { type: 'playlist' as const, playlistId: playlist.id };

        // Check if a playlist videos view with this specific playlist ID already exists
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_PLAYLIST_VIDEOS);

        // Find a leaf that's already showing this specific playlist
        for (const existingLeaf of leaves) {
            const view = existingLeaf.view;
            if (view && 'playlistInfo' in view) {
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
                    playlistInfo: playlist
                }
            };

            console.log('UserPlaylistsPane setting view state:', viewState);

            await leaf.setViewState(viewState);

            // Reveal the leaf
            workspace.revealLeaf(leaf);
        }
    }

    async setState(state: IUserPlaylistsPaneState, result: ViewStateResult): Promise<void> {
        if (state.playlists) {
            this.playlists = state.playlists;
        }
        if (state.isLoading !== undefined) {
            this.isLoading = state.isLoading;
        }
        if (state.error !== undefined) {
            this.error = state.error;
        }
        return super.setState(state, result);
    }

    getState(): Record<string, unknown> {
        return {
            playlists: this.playlists,
            isLoading: this.isLoading,
            error: this.error,
        };
    }
}