/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import { localStorageService } from 'src/storage';
import { handleGoogleLogin, handleGoogleLogout } from 'src/auth';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, isAIProvider, ObsidianGoogleLikedVideoSettings } from 'src/types';
import GoogleLikedVideoPlugin from '../main';
import { LikedVideoListPane } from './LikedVideoListPane';
import { debugLogger, DebugConfig } from 'src/debug';
import { confirmAction } from '../ui/ConfirmationModal';
import { UI_TEXT } from '../constants/uiText';
import { DEFAULT_TEMPLATE, TEMPLATE_VARIABLES_REFERENCE } from '../utils/templateConstants';
import { PlaylistVideosPane } from './PlaylistVideosPane';
import { createNotesForNewVideos, fetchAndMergeLikedVideos, FetchAndMergeLikedVideosResult } from '../services/likedVideoFetchService';
import { addWideTextSetting, createCollapsibleHtmlReference, createMonospaceTextarea } from '../utils/settingUiUtils';

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    updateListPaneView(): void {
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onClose();
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onOpen();
    }

    updatePlaylistVideosPaneView(): void {
        this.app.workspace.getActiveViewOfType(PlaylistVideosPane)?.onClose();
        this.app.workspace.getActiveViewOfType(PlaylistVideosPane)?.onOpen();
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const refreshToken = localStorageService.getRefreshToken();
        const isLoggedIn = refreshToken !== null && refreshToken !== '';

        this.renderQuotaSection(containerEl);
        this.renderOpenInWebViewerSetting(containerEl);

        if (isLoggedIn) {
            this.renderVideoNotesSection(containerEl);
            this.renderTemplateSection(containerEl);
            this.renderAISection(containerEl);
            this.renderAutoFetchSection(containerEl);
        }

        this.renderFunctionsSection(containerEl, isLoggedIn);
        this.renderSetupSection(containerEl, refreshToken);
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
            this.updateListPaneView();
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
        this.updateListPaneView();
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

    private renderQuotaSection(containerEl: HTMLElement): void {
        const likedVideosCount = localStorageService.getLikedVideos().length;
        const maxVideos = 5000;
        const progressValue = likedVideosCount / maxVideos;
        const fetchLimit = this.plugin.settings.fetchLimit;

        new Setting(containerEl)
            .setName('Quota')
            .setDesc('Displays the quota of liked videos fetched from the YouTube Data API v3, indicating how many videos you can store (up to 5000).')
            .addProgressBar(progressBar => progressBar
                .setValue(progressValue * 100))
            .addText(text => text
                .setDisabled(true)
                .setValue(`${likedVideosCount} / ${maxVideos} (${(progressValue * 100).toFixed(2)}%)`));

        new Setting(containerEl)
            .setName('Fetch Limit')
            .setDesc('Numbers of liked videos to fetch at each time of API request. Set this up to your rate of your video consumption pattern.')
            .addSlider(slider => slider
                .setValue(fetchLimit)
                .setLimits(10, 50, 10)
                .onChange(async (value) => {
                    await this.saveSetting('fetchLimit', value, { display: true });
                }))
            .addText(text => text
                .setValue(`${fetchLimit}`)
                .setDisabled(true));
    }

    private renderOpenInWebViewerSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Open Videos in Obsidian Web Viewer')
            .setDesc('If enabled, videos will be opened in the Obsidian web viewer instead of the OS\'s default browser even when its \'Open external links\' option is turned off. You need to ENABLE THE "WEB VIEWER" CORE PLUGIN for this to work.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openInObsidianWebViewer)
                .onChange(async (value) => {
                    await this.saveSetting('openInObsidianWebViewer', value);
                }));
    }

    private renderVideoNotesSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName('Video notes')
            .setDesc('Configure the video note settings');

        new Setting(containerEl)
            .setName('Video note location')
            .setDesc('Specify where video notes should be created. Leave empty to use Obsidian\'s default new file location, or enter a custom folder path. Default is \'Youtube\'.')
            .addText(text => text
                .setPlaceholder('e.g. Youtube, Youtube/Videos (Default is \'Youtube\')')
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

        new Setting(containerEl)
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

        createMonospaceTextarea(containerEl, {
            className: 'template-textarea',
            value: this.plugin.settings.customTemplate,
            rows: 20,
            onChange: async (value) => {
                await this.saveSetting('customTemplate', value);
            },
        });

        createCollapsibleHtmlReference(
            containerEl,
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
            .setDesc('Use Google Gemini to generate AI summaries of YouTube videos. Requires a Gemini API key.')
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
                desc: 'Your Google Gemini API key. Get one from [Google AI Studio] (https://aistudio.google.com/app/apikey). Only Google AI Studio support video_url at this time. Vertex AI does not support video_url yet.',
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
                desc: 'Your OpenRouter API key. Get one from openrouter.ai/keys.',
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
            .setDesc('Customize the prompt sent to Gemini when generating video summaries.');

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
            .setHeading()
            .setName('Automatic Fetch')
            .setDesc('Configure automatic fetching of liked videos');

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

    private renderFunctionsSection(containerEl: HTMLElement, isLoggedIn: boolean): void {
        new Setting(containerEl)
            .setHeading()
            .setName('Functions')
            .setDesc('Functions to fetch and update liked videos');

        if (isLoggedIn) {
            new Setting(containerEl)
                .setName('Fetch all liked videos so far and add to local storage. This will override all the liked videos in local storage.')
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
                .setName('Fetch all liked videos so far, compare to the stored videos and filter/add the new videos to local storage')
                .addButton(button => button
                    .setButtonText('Fetch')
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

        new Setting(containerEl)
            .setName('Clear local storage')
            .addButton(button => button
                .setButtonText('Clear stored liked videos in local storage')
                .onClick(async () => {
                    localStorageService.setLikedVideos([]);
                    this.display();
                    this.updateListPaneView();
                    new Notice('Liked videos have been cleared');
                }));
    }

    private renderSetupSection(containerEl: HTMLElement, refreshToken: string | null): void {
        new Setting(containerEl)
            .setHeading()
            .setName('Setup')
            .setDesc('Setup the plugin');

        new Setting(containerEl)
            .setName('Open Youtube Data API Console')
            .setDesc('Click the button below to open the Google Developer Console, where you can manage your Google APIs and credentials.')
            .addButton(button => button
                .setButtonText('Open Google Developer Console')
                .onClick(async () => {
                    window.open('https://console.cloud.google.com/apis/api/youtube.googleapis.com', '_blank');
                }));

        new Setting(containerEl)
            .setName('Client ID')
            .setDesc('Client ID required to authenticate your Google account and access the YouTube Data API v3.')
            .addText(text => text
                .setPlaceholder('Enter your client ID')
                .setValue(this.plugin.settings.googleClientId)
                .onChange(async (value) => {
                    await this.saveSetting('googleClientId', value);
                }));

        new Setting(containerEl)
            .setName('Client secret')
            .setDesc('Client secret for accessing the YouTube Data API v3')
            .addText(text => text
                .setPlaceholder('Enter your client secret')
                .setValue(this.plugin.settings.googleClientSecret)
                .onChange(async (value) => {
                    await this.saveSetting('googleClientSecret', value);
                }));

        new Setting(containerEl)
            .setName('Login with Google')
            .setDesc('Login to your Google account')
            .addButton(button => button
                .setButtonText(refreshToken ? 'Logout' : 'Login')
                .onClick(async (): Promise<void> => {
                    const refreshDisplay = () => {
                        this.display();
                        this.updateListPaneView();
                    };
                    if (refreshToken) {
                        await handleGoogleLogout(this.plugin.settings, refreshDisplay, refreshDisplay);
                    } else {
                        await handleGoogleLogin(this.plugin.settings, refreshDisplay);
                    }
                }));
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
