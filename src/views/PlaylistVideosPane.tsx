import { ItemView, Menu, MenuItem, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { Root, createRoot } from "react-dom/client";
import { localStorageService } from "src/storage";
import { PlaylistSource, PlaylistInfo } from "src/types";
import { confirmDangerousAction } from "src/utils/confirmationUtils";
import GoogleLikedVideoPlugin from "../main";
import { PluginContext } from "../store/pluginContext";
import { PlaylistVideosView } from "./PlaylistVideosView";

interface IPlaylistVideosViewPersistedState {
    playlistSource?: PlaylistSource;
    playlistInfo?: PlaylistInfo;
}

export const VIEW_TYPE_PLAYLIST_VIDEOS = "playlist-videos";

export class PlaylistVideosPane extends ItemView implements IPlaylistVideosViewPersistedState {
    root: Root | null = null;

    /// Persisted State
    playlistSource: PlaylistSource;
    playlistInfo: PlaylistInfo;
    plugin: GoogleLikedVideoPlugin | null = null;
    private isDeletingPlaylist = false;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: GoogleLikedVideoPlugin,
        playlistSource?: PlaylistSource,
        playlistInfo?: PlaylistInfo
    ) {
        super(leaf);
        this.plugin = plugin;
        this.playlistSource = playlistSource || { type: 'liked' };
        this.playlistInfo = playlistInfo || { id: 'liked', title: 'Loading...', description: '', itemCount: 0, isOwnedByUser: false };
    }

    onPaneMenu(menu: Menu, source: string): void {
        super.onPaneMenu(menu, source);

        menu.addItem((item: MenuItem) => {
            item.setTitle("Refresh Videos");
            item.setIcon("refresh-cw");
            item.onClick(() => {
                if (this.plugin?.playlistApi) {
                    this.plugin.playlistApi.clearCache(this.playlistSource);
                }
                this.renderView();
            });
        });

        menu.addItem((item: MenuItem) => {
            item.setTitle("Back to Playlists");
            item.setIcon("arrow-left");
            item.onClick(() => {
                void this.plugin?.activatePlaylistsView();
            });
        });
    }

    getViewType(): string {
        return VIEW_TYPE_PLAYLIST_VIDEOS;
    }

    getDisplayText(): string {
        // Use actual playlist title if available, otherwise show generic title
        return this.playlistInfo && this.playlistInfo.title !== 'Loading...'
            ? this.playlistInfo.title
            : 'Playlist Videos';
    }

    getIcon(): string {
        return "play-circle";
    }

    async onOpen() {
        this.root = createRoot(this.containerEl.children[1]);
        // Only render if we have real playlist data (not defaults)
        if (this.playlistInfo.id !== 'liked' || this.playlistInfo.title !== 'Loading...') {
            this.renderView();
        }
    }

    private renderView() {
        if (!this.root) return;

        this.root.render(
            <StrictMode>
                <PluginContext.Provider value={this.plugin}>
                    <PlaylistVideosView
                        playlistSource={this.playlistSource}
                        playlistInfo={this.playlistInfo}
                        onDeletePlaylist={() => this.handleDeletePlaylist()}
                    />
                </PluginContext.Provider>
            </StrictMode>
        );
    }

    private async handleDeletePlaylist(): Promise<void> {
        if (
            this.isDeletingPlaylist ||
            this.playlistInfo.isOwnedByUser !== true ||
            !this.plugin?.playlistApi
        ) {
            return;
        }

        this.isDeletingPlaylist = true;

        try {
            const confirmed = await confirmDangerousAction(
                this.app,
                `"${this.playlistInfo.title}"\n\nYouTube에서 영구 삭제되며 복구할 수 없음`,
                {
                    title: "YouTube 플레이리스트 삭제",
                    confirmText: "영구 삭제",
                },
            );

            if (!confirmed) return;

            await this.plugin.playlistApi.deletePlaylist(this.playlistInfo.id);
            localStorageService.unpinPlaylist(this.playlistInfo.id);
            localStorageService.removeSavedPlaylist(this.playlistInfo.id);
            new Notice(`Playlist "${this.playlistInfo.title}" deleted from YouTube.`);
            this.app.workspace
                .getLeavesOfType("user-playlists")
                .forEach((leaf) => leaf.detach());
            this.leaf.detach();
            await this.plugin.activatePlaylistsView();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            new Notice(`Failed to delete playlist: ${message}`);
        } finally {
            this.isDeletingPlaylist = false;
        }
    }

    async onClose() {
        this.root?.unmount();
    }

    async setState(state: IPlaylistVideosViewPersistedState, result: ViewStateResult): Promise<void> {
        if (state.playlistSource) {
            this.playlistSource = state.playlistSource;
        }
        if (state.playlistInfo) {
            this.playlistInfo = state.playlistInfo;
        }

        // Re-render with new state
        this.renderView();

        return super.setState(state, result);
    }

    getState(): Record<string, unknown> {
        return {
            playlistSource: this.playlistSource,
            playlistInfo: this.playlistInfo,
        };
    }
}
