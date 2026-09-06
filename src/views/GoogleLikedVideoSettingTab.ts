import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import { localStorageService } from 'src/storage';
import { googleTokenStorageService } from 'src/services/googleTokenStorageService';
import { handleGoogleLogin, handleGoogleLogout } from 'src/auth';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, isAIProvider, ObsidianGoogleLikedVideoSettings } from 'src/types';
import GoogleLikedVideoPlugin from '../main';
import { LikedVideoListPane, VIEW_TYPE_LIKED_VIDEO_LIST } from './LikedVideoListPane';
import { debugLogger, DebugConfig } from 'src/debug';
import { confirmAction } from '../ui/ConfirmationModal';
import { UI_TEXT } from '../constants/uiText';
import { DEFAULT_TEMPLATE, TEMPLATE_VARIABLES_REFERENCE } from '../utils/templateConstants';
import { PlaylistVideosPane } from './PlaylistVideosPane';
import { createNotesForNewVideos, fetchAndMergeLikedVideos, FetchAndMergeLikedVideosResult } from '../services/likedVideoFetchService';
import { addWideTextSetting, createCollapsibleReference, createMonospaceTextarea } from '../utils/settingUiUtils';

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async updateListPaneView(): Promise<void> {
        const likedVideoViews = this.app.workspace
            .getLeavesOfType(VIEW_TYPE_LIKED_VIDEO_LIST)
            .map(leaf => leaf.view)
            .filter((view): view is LikedVideoListPane => view instanceof LikedVideoListPane);

        await Promise.all(likedVideoViews.map(async view => {
            await view.onClose();
            await view.onOpen();
        }));
    }

    updatePlaylistVideosPaneView(): void {
        void this.app.workspace.getActiveViewOfType(PlaylistVideosPane)?.onClose();
        void this.app.workspace.getActiveViewOfType(PlaylistVideosPane)?.onOpen();
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const refreshToken = googleTokenStorageService.getRefreshToken();
        const isLoggedIn = refreshToken !== null && refreshToken !== '';

        this.renderSetupSection(containerEl, refreshToken);
        this.renderSyncSection(containerEl, isLoggedIn);
        new Setting(containerEl).setHeading().setName('Video display');
        this.renderLikedVideoViewModeSetting(containerEl);
        this.renderOpenInWebViewerSetting(containerEl);
        this.renderVideoTagsSetting(containerEl);

        if (isLoggedIn) {
            this.renderVideoNotesSection(containerEl);
            this.renderTemplateSection(containerEl);
            this.renderAISection(containerEl);
        }

        this.renderDataManagementSection(containerEl);
        this.renderDebugSection(containerEl);
    }

    private async saveSetting<K extends keyof ObsidianGoogleLikedVideoSettings>(
        key: K,
        value: ObsidianGoogleLikedVideoSettings[K],
        refresh: { display?: boolean; listPane?: boolean; playlistPane?: boolean } = {}
    ): Promise<void> {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
        if (refresh.display) {
            this.display();
        }
        if (refresh.listPane) {
            await this.updateListPaneView();
        }
        if (refresh.playlistPane) {
            this.updatePlaylistVideosPaneView();
        }
    }

    private async applyManualFetchResult(
        result: FetchAndMergeLikedVideosResult,
        notice: string
    ): Promise<void> {
        localStorageService.setLikedVideos(result.mergedVideos);
        this.display();
        await this.updateListPaneView();
        new Notice(notice);

        const createdCount = await createNotesForNewVideos(
            result.newVideos,
            this.plugin.settings.autoCreateNoteEnabled,
            (video) => this.plugin.automateVideoProcessing(video)
        );
        if (createdCount > 0) {
            new Notice(`Created ${createdCount} new video notes`);
        }
    }

    private showError(error: unknown): void {
        new Modal(this.app).setTitle(UI_TEXT.ERROR_TITLE).setContent(UI_TEXT.ERROR_MESSAGE(error)).open();
    }

    private renderSyncSection(containerEl: HTMLElement, isLoggedIn: boolean): void {
        new Setting(containerEl).setHeading().setName('Sync');
        this.renderStoredVideosAndFetchLimit(containerEl);
        if (isLoggedIn) {
            this.renderAutoFetchSection(containerEl);
        }
        this.renderManualFetchSettings(containerEl, isLoggedIn);
    }

    private renderStoredVideosAndFetchLimit(containerEl: HTMLElement): void {
        const likedVideosCount = localStorageService.getLikedVideos().length;
        const fetchLimit = this.plugin.settings.fetchLimit;

        const storedVideosSetting = new Setting(containerEl)
            .setName('Stored videos')
            .setDesc('Liked videos saved in this vault.');
        storedVideosSetting.controlEl.createSpan({
            cls: 'geulo-stored-video-count',
            text: likedVideosCount.toLocaleString(),
        });

        new Setting(containerEl)
            .setName('Fetch Limit')
            .setDesc('Maximum number of recent videos to check per fetch. Full scans ignore this limit.')
            .addSlider(slider => slider
                .setValue(fetchLimit)
                .setLimits(10, 50, 10)
                .onChange(async (value) => {
                    await this.saveSetting('fetchLimit', value);
                }));
    }

    private renderOpenInWebViewerSetting(containerEl: HTMLElement): void {
        const viewerEl = containerEl.createDiv();
        new Setting(viewerEl)
            .setName('Open videos in Obsidian Web Viewer')
            .setDesc('Open videos inside Obsidian. Requires the Web Viewer core plugin.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openInObsidianWebViewer)
                .onChange(async (value) => {
                    openInSetting.settingEl.hidden = !value;
                    await this.saveSetting('openInObsidianWebViewer', value);
                }));

        const openInSetting = new Setting(viewerEl)
            .setName('Open in')
            .setClass('geulo-web-viewer-option')
            .addDropdown(dropdown => dropdown
                .addOption('tab', 'New tab')
                .addOption('split', 'Split pane')
                .setValue(this.plugin.settings.openWebViewerInSplitPane ? 'split' : 'tab')
                .onChange(async (value) => {
                    await this.saveSetting('openWebViewerInSplitPane', value === 'split');
                }));
        openInSetting.settingEl.hidden = !this.plugin.settings.openInObsidianWebViewer;
    }

    private renderLikedVideoViewModeSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Liked video view mode')
            .setDesc('Choose how liked videos are displayed.')
            .addDropdown(dropdown => dropdown
                .addOption('pagination', 'Pagination')
                .addOption('infinite', 'Infinite scroll')
                .setValue(localStorageService.getLikedVideoDisplayMode())
                .onChange(async (value) => {
                    const displayMode = value === 'infinite' ? 'infinite' : 'pagination';
                    localStorageService.setLikedVideoDisplayMode(displayMode);
                    await this.updateListPaneView();
                }));
    }

    private renderVideoTagsSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Show video tags')
            .setDesc('Display responsive YouTube tag chips on video cards.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showVideoTags)
                .onChange(async (value) => {
                    await this.saveSetting('showVideoTags', value, {
                        listPane: true,
                        playlistPane: true,
                    });
                }));
    }

    private renderVideoNotesSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName('Video notes')
            .setDesc('Configure the video note settings');

        new Setting(containerEl)
            .setName('Video note location')
            .setDesc('Specify where video notes should be created. Leave empty to use Obsidian\'s default new file location, or enter a custom folder path.')
            .addText(text => text
                .setPlaceholder('e.g. Youtube, Youtube/Videos')
                .setValue(this.plugin.settings.videoNotePath)
                .onChange(async (value) => {
                    await this.saveSetting('videoNotePath', value.trim());
                }));

        new Setting(containerEl)
            .setName('Organize by channel')
            .setDesc('Create subfolders for each channel (e.g., Youtube/Channel Name/video.md). Only applies when using a custom video note location.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.organizeByChannel)
                .setDisabled(!this.plugin.settings.videoNotePath || !this.plugin.settings.videoNotePath.trim())
                .onChange(async (value) => {
                    await this.saveSetting('organizeByChannel', value);
                }));

        new Setting(containerEl)
            .setName('Automatically create notes')
            .setDesc('If enabled, a new note will be created for each new video fetched.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCreateNoteEnabled)
                .onChange(async (value) => {
                    await this.saveSetting('autoCreateNoteEnabled', value, { display: true });
                }));

        if (this.plugin.settings.autoCreateNoteEnabled) {
            new Setting(containerEl)
                .setName('Link to daily note')
                .setDesc('If enabled, a link to the new video note will be added to your daily note.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.linkToDailyNote)
                    .onChange(async (value) => {
                        await this.saveSetting('linkToDailyNote', value);
                    }));
        }
    }

    private renderTemplateSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName('Template System')
            .setDesc('Customize video note templates');

        new Setting(containerEl)
            .setName('Enable custom templates')
            .setDesc('Use custom markdown templates for video notes instead of the default format')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTemplateSystem)
                .onChange(async (value) => {
                    await this.saveSetting('enableTemplateSystem', value, { display: true });
                }));

        if (!this.plugin.settings.enableTemplateSystem) {
            return;
        }

        const editorEl = containerEl.createEl('details', { cls: 'geulo-settings-details' });
        editorEl.createEl('summary', { text: 'Edit template' });

        new Setting(editorEl)
            .setName('Custom template')
            .setDesc('Edit your video note template directly. Use {{variable}} syntax for dynamic content.')
            .addButton(button => button
                .setButtonText('Reset to Default')
                .onClick(async () => {
                    const confirmed = await confirmAction(
                        this.app,
                        'This will reset your template to the default. Any customizations will be lost.',
                        {
                            title: 'Reset Template?',
                            confirmText: 'Reset',
                            cancelText: 'Cancel',
                            type: 'warning'
                        }
                    );
                    if (confirmed.confirmed) {
                        await this.saveSetting('customTemplate', DEFAULT_TEMPLATE, { display: true });
                        new Notice('Template reset to default');
                    }
                }));

        createMonospaceTextarea(editorEl, {
            className: 'template-textarea',
            value: this.plugin.settings.customTemplate,
            rows: 20,
            onChange: async (value) => {
                await this.saveSetting('customTemplate', value);
            },
        });

        createCollapsibleReference(
            editorEl,
            '📖 Available Variables (click to expand)',
            TEMPLATE_VARIABLES_REFERENCE
        );
    }

    private renderAISection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName('[Experimental] AI Features')
            .setDesc('Configure AI-powered features');

        new Setting(containerEl)
            .setName('Enable AI Summary')
            .setDesc('Generate video summaries with your selected AI provider. Requires an API key for that provider.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAISummary)
                .onChange(async (value) => {
                    await this.saveSetting('enableAISummary', value, {
                        display: true,
                        listPane: true,
                        playlistPane: true,
                    });
                }));

        if (!this.plugin.settings.enableAISummary) {
            return;
        }

        new Setting(containerEl)
            .setName('AI Provider')
            .setDesc('Choose which AI provider to use for video summaries.')
            .addDropdown(dropdown => {
                for (const provider of AI_PROVIDERS) {
                    dropdown.addOption(provider, AI_PROVIDER_LABELS[provider]);
                }
                dropdown
                    .setValue(this.plugin.settings.aiProvider)
                    .onChange(async (value) => {
                        if (!isAIProvider(value)) return;
                        await this.saveSetting('aiProvider', value, { display: true });
                    });
            });

        if (this.plugin.settings.aiProvider === 'gemini') {
            addWideTextSetting(containerEl, {
                name: 'Gemini API Key',
                desc: 'Use a Google AI Studio API key for the Google Gemini provider. Get a key at aistudio.google.com/app/apikey.',
                placeholder: 'Enter your Gemini API key',
                value: this.plugin.settings.geminiApiKey,
                secret: true,
                onChange: async (value) => {
                    await this.saveSetting('geminiApiKey', value);
                },
            });
        } else {
            addWideTextSetting(containerEl, {
                name: 'OpenRouter API Key',
                desc: 'Use an OpenRouter API key for the OpenRouter provider. Get a key at openrouter.ai/keys.',
                placeholder: 'sk-or-...',
                value: this.plugin.settings.openRouterApiKey,
                secret: true,
                onChange: async (value) => {
                    await this.saveSetting('openRouterApiKey', value);
                },
            });

            addWideTextSetting(containerEl, {
                name: 'Model ID',
                desc: 'Enter a Gemini model ID from OpenRouter (e.g. google/gemini-3-flash-preview).',
                placeholder: 'google/gemini-3-flash-preview',
                value: this.plugin.settings.openRouterModel,
                onChange: async (value) => {
                    await this.saveSetting('openRouterModel', value);
                },
            });
        }

        new Setting(containerEl)
            .setName('Summary Prompt')
            .setDesc('Customize the instructions sent to your selected AI provider when generating video summaries.');

        createMonospaceTextarea(containerEl, {
            className: 'summary-prompt-textarea',
            value: this.plugin.settings.summaryPrompt,
            rows: 5,
            onChange: async (value) => {
                await this.saveSetting('summaryPrompt', value);
            },
        });
    }

    private renderAutoFetchSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Enable automatic fetch')
            .setDesc('Automatically fetch liked videos at regular intervals')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFetchEnabled)
                .onChange(async (value) => {
                    await this.saveSetting('autoFetchEnabled', value, { display: true, listPane: true });
                }));

        if (!this.plugin.settings.autoFetchEnabled) {
            return;
        }

        new Setting(containerEl)
            .setName('Fetch interval')
            .setDesc('How often to automatically fetch videos (in minutes)')
            .addDropdown(dropdown => {
                const debugConfig = debugLogger.getConfig();
                if (debugConfig.enabled) {
                    dropdown.addOption('0.083', '🔧 5 seconds (Debug)');
                    dropdown.addOption('1', '🔧 1 minute (Debug)');
                }

                dropdown
                    .addOption('10', '10 minutes')
                    .addOption('30', '30 minutes')
                    .addOption('60', '1 hour')
                    .addOption('120', '2 hours')
                    .addOption('360', '6 hours')
                    .addOption('720', '12 hours')
                    .addOption('1440', '24 hours')
                    .setValue(String(this.plugin.settings.autoFetchInterval))
                    .onChange(async (value) => {
                        const interval = parseFloat(value);
                        await this.saveSetting('autoFetchInterval', interval, { display: true, listPane: true });
                        if (interval < 1) {
                            new Notice('⚠️ Debug mode: Using very short fetch interval!');
                        }
                    });

                return dropdown;
            });

        new Setting(containerEl)
            .setName('Full fetch on every auto-fetch')
            .setDesc(UI_TEXT.FULL_FETCH_WARNING_DESC)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fullFetchOnEveryAutoFetch)
                .onChange(async (value) => {
                    if (value && !this.plugin.settings.fullFetchOnEveryAutoFetch) {
                        const result = await confirmAction(
                            this.app,
                            UI_TEXT.FULL_FETCH_CONFIRM_MESSAGE,
                            {
                                title: UI_TEXT.FULL_FETCH_WARNING_TITLE,
                                confirmText: 'Yes, Enable Full Fetch',
                                cancelText: 'Cancel',
                                type: 'warning',
                                showRememberChoice: false
                            }
                        );

                        if (!result.confirmed) {
                            toggle.setValue(false);
                            return;
                        }
                    }

                    await this.saveSetting('fullFetchOnEveryAutoFetch', value, { display: true });
                    if (value) {
                        new Notice(UI_TEXT.FULL_FETCH_ENABLED_NOTICE);
                    }
                }));

        if (this.plugin.settings.fullFetchOnEveryAutoFetch && this.plugin.settings.autoCreateNoteEnabled) {
            new Setting(containerEl)
                .setName('⚠️ Warning')
                .setDesc(UI_TEXT.FULL_FETCH_NOT_RECOMMEND_AUTO_VIDEO_NOTE_WARNING)
                .setClass('setting-item-info');
        }

        new Setting(containerEl)
            .setName('Fetch on startup')
            .setDesc('Automatically fetch videos when Obsidian starts')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fetchOnStartup)
                .onChange(async (value) => {
                    await this.saveSetting('fetchOnStartup', value);
                }));

        if (this.plugin.settings.lastAutoFetchTime > 0) {
            const lastFetch = new Date(this.plugin.settings.lastAutoFetchTime);
            const intervalDisplay = this.plugin.settings.autoFetchInterval < 1
                ? `${Math.round(this.plugin.settings.autoFetchInterval * 60)}s`
                : `${this.plugin.settings.autoFetchInterval}min`;

            new Setting(containerEl)
                .setName('Last auto-fetch')
                .setDesc(`Last: ${lastFetch.toLocaleString()} (every ${intervalDisplay})`);
        }
    }

    private renderManualFetchSettings(containerEl: HTMLElement, isLoggedIn: boolean): void {

        if (isLoggedIn) {
            new Setting(containerEl)
                .setName('Full scan')
                .setDesc('Check all liked videos and replace the saved list with the results. Videos no longer returned by YouTube are removed from this list.')
                .addButton(button => button
                    .setButtonText('Full scan')
                    .onClick(async () => {
                        try {
                            const totalLikedVideos = await this.plugin.likedVideoApi.fetchTotalLikedVideoCount();
                            new Notice(`${totalLikedVideos} videos in total`);

                            const result = await fetchAndMergeLikedVideos(this.plugin.likedVideoApi, {
                                mode: 'full',
                                pageSize: this.plugin.settings.fullFetchLimit,
                                keepUnfetched: false,
                            });

                            await this.applyManualFetchResult(
                                result,
                                `All liked videos have been fetched and saved to LocalStorage - ${result.mergedVideos.length} videos`
                            );
                        } catch (error) {
                            this.showError(error);
                        }
                    }));

            new Setting(containerEl)
                .setName('Fetch recent videos')
                .setDesc('Check recent liked videos up to the Fetch Limit above. Add new videos and update matching saved videos, keeping the rest of your saved list.')
                .addButton(button => button
                    .setButtonText('Fetch recent videos')
                    .onClick(async () => {
                        try {
                            const result = await fetchAndMergeLikedVideos(this.plugin.likedVideoApi, {
                                mode: 'partial',
                                pageSize: this.plugin.settings.fetchLimit,
                                keepUnfetched: true,
                            });

                            await this.applyManualFetchResult(
                                result,
                                UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(result.newVideos.length)
                            );
                        } catch (error) {
                            console.error(error);
                            this.showError(error);
                        }
                    }));
        }

    }

    private renderDataManagementSection(containerEl: HTMLElement): void {
        const storedCount = localStorageService.getLikedVideos().length;
        new Setting(containerEl).setHeading().setName('Data management');
        new Setting(containerEl)
            .setName('Clear saved liked videos')
            .setDesc('Remove the saved liked-video list from this vault. YouTube likes, existing video notes, playlists, and saved summaries are kept.')
            .addButton(button => button
                .setButtonText('Clear saved videos')
                .setWarning()
                .setDisabled(storedCount === 0)
                .onClick(async () => {
                    const result = await confirmAction(
                        this.app,
                        `Remove all ${localStorageService.getLikedVideos().length} saved liked videos from this vault?\n\nThis does not unlike videos on YouTube or delete existing video notes, playlists, or saved summaries.\n\nTo repopulate the list, run a Full scan. Videos no longer available from YouTube may not be restored.`,
                        {
                            title: 'Clear saved liked videos?',
                            confirmText: 'Clear saved videos',
                            cancelText: 'Cancel',
                            type: 'danger',
                            showRememberChoice: false,
                        }
                    );
                    if (!result.confirmed) {
                        return;
                    }
                    localStorageService.setLikedVideos([]);
                    this.display();
                    await this.updateListPaneView();
                    new Notice('Saved liked-video list cleared. YouTube likes and existing notes were kept.');
                }));
    }

    private renderSetupSection(containerEl: HTMLElement, refreshToken: string | null): void {
        const isLoggedIn = Boolean(refreshToken);

        new Setting(containerEl)
            .setHeading()
            .setName('Google connection');

        new Setting(containerEl)
            .setName(isLoggedIn ? 'Connected to Google' : 'Not connected to Google')
            .setDesc(isLoggedIn
                ? 'Your Google account is connected. You can fetch your liked videos.'
                : 'Enter your Google API credentials below, then connect your account.')
            .addButton(button => button
                .setButtonText(isLoggedIn ? 'Disconnect' : 'Connect with Google')
                .onClick(async (): Promise<void> => {
                    const refreshDisplay = async () => {
						this.plugin.commentService.resetIdentityCache();
                        this.display();
                        await this.updateListPaneView();
                    };
                    if (isLoggedIn) {
                        await handleGoogleLogout(this.plugin.settings, refreshDisplay, refreshDisplay);
                    } else {
                        await handleGoogleLogin(this.plugin.settings, refreshDisplay);
                    }
                }));

        const credentialsEl = containerEl.createEl('details', {
            cls: 'geulo-google-credentials',
        });
        credentialsEl.open = !isLoggedIn;
        credentialsEl.createEl('summary', { text: 'Google API credentials' });

        new Setting(credentialsEl)
            .setName('Open Youtube Data API Console')
            .setDesc('Click the button below to open the Google Developer Console, where you can manage your Google APIs and credentials.')
            .addButton(button => button
                .setButtonText('Open Google Developer Console')
                .onClick(async () => {
                    window.open('https://console.cloud.google.com/apis/api/youtube.googleapis.com', '_blank');
                }));

        new Setting(credentialsEl)
            .setName('Client ID')
            .setDesc('Client ID required to authenticate your Google account and access the YouTube Data API v3.')
            .addText(text => text
                .setPlaceholder('Enter your client ID')
                .setValue(this.plugin.settings.googleClientId)
                .onChange(async (value) => {
                    await this.saveSetting('googleClientId', value);
                }));

        new Setting(credentialsEl)
            .setName('Client secret')
            .setDesc('Client secret for accessing the YouTube Data API v3')
            .addText(text => {
                text.inputEl.type = 'password';
                text
                    .setPlaceholder('Enter your client secret')
                    .setValue(googleTokenStorageService.getClientSecret())
                    .onChange((value) => {
                        try {
                            googleTokenStorageService.setClientSecret(value);
                        } catch (error) {
                            if (error instanceof Error) {
                                new Notice('Failed to save the Google client secret.');
                                this.display();
                                return;
                            }
                            throw error;
                        }
                    });
            });

    }

    private renderDebugSection(containerEl: HTMLElement): void {
        const debugConfig = debugLogger.getConfig();
        if (!debugConfig.enabled) {
            return;
        }

        new Setting(containerEl)
            .setHeading()
            .setName('🔧 Debug Settings')
            .setDesc('Development mode only');

        new Setting(containerEl)
            .setName('Log Level')
            .setDesc('Set the verbosity of debug logs')
            .addDropdown(dropdown => dropdown
                .addOption('error', 'Error')
                .addOption('warn', 'Warning')
                .addOption('info', 'Info')
                .addOption('debug', 'Debug')
                .addOption('verbose', 'Verbose')
                .setValue(debugConfig.logLevel)
                .onChange((value) => {
                    debugLogger.updateConfig({ logLevel: value as DebugConfig['logLevel'] });
                    new Notice(`Debug log level set to: ${value}`);
                }));

        new Setting(containerEl)
            .setName('Log API Calls')
            .setDesc('Log all API requests and responses')
            .addToggle(toggle => toggle
                .setValue(debugConfig.logApiCalls)
                .onChange(value => {
                    debugLogger.updateConfig({ logApiCalls: value });
                }));

        new Setting(containerEl)
            .setName('Log State Changes')
            .setDesc('Log state updates and changes')
            .addToggle(toggle => toggle
                .setValue(debugConfig.logStateChanges)
                .onChange(value => {
                    debugLogger.updateConfig({ logStateChanges: value });
                }));

        new Setting(containerEl)
            .setName('Log Auto-Fetch')
            .setDesc('Log automatic fetch operations')
            .addToggle(toggle => toggle
                .setValue(debugConfig.logAutoFetch)
                .onChange(value => {
                    debugLogger.updateConfig({ logAutoFetch: value });
                }));

        new Setting(containerEl)
            .setName('Auto-Fetch Interval Override (minutes)')
            .setDesc('Override auto-fetch interval for testing (0 = use normal setting)')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(debugConfig.autoFetchIntervalOverride || 0))
                .onChange(value => {
                    const minutes = parseInt(value) || 0;
                    debugLogger.updateConfig({
                        autoFetchIntervalOverride: minutes > 0 ? minutes : undefined
                    });
                    if (minutes > 0) {
                        new Notice(`Auto-fetch interval overridden to ${minutes} minutes. Restart plugin to apply.`);
                    }
                }));

        new Setting(containerEl)
            .setName('Force Fetch Now')
            .setDesc('Trigger an immediate fetch for testing')
            .addButton(button => button
                .setButtonText('Fetch Now')
                .onClick(async () => {
                    debugLogger.info('Manual debug fetch triggered');
                    await this.plugin.performAutoFetch();
                }));

        new Setting(containerEl)
            .setName('Debug Console Commands')
            .setDesc('Enable: enableGeuloDebug() | Disable: disableGeuloDebug()');
    }
}
