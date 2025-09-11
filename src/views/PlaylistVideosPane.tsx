import { ItemView, Menu, MenuItem, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { Root, createRoot } from "react-dom/client";
import { StrictMode } from "react";
import GoogleLikedVideoPlugin from "../main";
import { PluginContext } from "../store/pluginContext";
import { PlaylistVideosView } from "./PlaylistVideosView";
import { PlaylistSource, PlaylistInfo } from "../api";

interface IPlaylistVideosViewPersistedState {
    playlistSource: PlaylistSource;
    playlistInfo: PlaylistInfo;
}

export const VIEW_TYPE_PLAYLIST_VIDEOS = "playlist-videos";

export class PlaylistVideosPane extends ItemView implements IPlaylistVideosViewPersistedState {
    root: Root | null = null;

    /// Persisted State
    playlistSource: PlaylistSource;
    playlistInfo: PlaylistInfo;
    plugin: GoogleLikedVideoPlugin | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: GoogleLikedVideoPlugin,
        playlistSource?: PlaylistSource,
        playlistInfo?: PlaylistInfo
    ) {
        super(leaf);
        this.plugin = plugin;
        this.playlistSource = playlistSource || { type: 'liked' };
        this.playlistInfo = playlistInfo || { id: 'liked', title: 'Loading...', description: '', itemCount: 0 };
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
                this.plugin?.activatePlaylistsView();
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
                    />
                </PluginContext.Provider>
            </StrictMode>
        );
    }

    async onClose() {
        this.root?.unmount();
    }

    async setState(state: IPlaylistVideosViewPersistedState & any, result: ViewStateResult): Promise<void> {
        console.log('PlaylistVideosPane setState called with:', state);

        if (state.playlistSource) {
            this.playlistSource = state.playlistSource;
            console.log('Updated playlistSource to:', this.playlistSource);
        }
        if (state.playlistInfo) {
            this.playlistInfo = state.playlistInfo;
            console.log('Updated playlistInfo to:', this.playlistInfo);
        }

        // Re-render with new state
        this.renderView();

        return super.setState(state, result);
    }

    getState(): IPlaylistVideosViewPersistedState {
        return {
            playlistSource: this.playlistSource,
            playlistInfo: this.playlistInfo,
        };
    }
}