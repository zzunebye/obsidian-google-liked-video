/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Modal, Notice, PluginSettingTab, Setting } from 'obsidian';
import { localStorageService } from 'src/storage';
import { handleGoogleLogin, handleGoogleLogout } from 'src/auth';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LikedVideoApi } from 'src/api';
import GoogleLikedVideoPlugin from '../main';
import { LikedVideoListPane } from './LikedVideoListPane';
import { debugLogger } from 'src/debug';
import { confirmAction } from '../ui/ConfirmationModal';
import { UI_TEXT } from '../constants/uiText';
import { DEFAULT_TEMPLATE, TEMPLATE_VARIABLES_REFERENCE } from '../utils/templateConstants';

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;
    likedVideoApi: LikedVideoApi;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.likedVideoApi = new LikedVideoApi(this.plugin.settings);
    }

    updateListPaneView(): void {
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onClose();
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onOpen();
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        const likedVideos = localStorageService.getLikedVideos();
        const likedVideosCount = likedVideos.length;
        const maxVideos = 5000;
        const progressValue = likedVideosCount / maxVideos;
        const fetchLimit = this.plugin.settings.fetchLimit;

        const refreshToken = localStorageService.getRefreshToken();

        new Setting(containerEl)
            .setName('Quota')
            .setDesc('Displays the quota of liked videos fetched from the YouTube Data API v3, indicating how many videos you can store (up to 5000).')
            .addProgressBar(progressBar => progressBar
                .setValue(progressValue * 100))
            .addText(text => text
                .setDisabled(true)
                .setValue(`${likedVideosCount} / ${maxVideos} (${(progressValue * 100).toFixed(2)}%)`))

        new Setting(containerEl)
            .setName('Fetch Limit')
            .setDesc('Numbers of liked videos to fetch at each time of API request. Set this up to your rate of your video consumption pattern.')
            .addSlider(slider => slider
                .setValue(fetchLimit)
                .setLimits(10, 50, 10)
                .onChange(async (value) => {
                    this.plugin.settings.fetchLimit = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addText(text => text
                .setValue(`${fetchLimit}`)
                .setDisabled(true));

        new Setting(containerEl)
            .setName('Open Videos in Obsidian Web Viewer')
            .setDesc('If enabled, videos will be opened in the Obsidian web viewer instead of the OS\'s default browser even when its \'Open external links\' option is turned off. You need to ENABLE THE "WEB VIEWER" CORE PLUGIN for this to work.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openInObsidianWebViewer)
                .onChange(async (value) => {
                    this.plugin.settings.openInObsidianWebViewer = value;
                    await this.plugin.saveSettings();
                }));

        if (refreshToken !== null && refreshToken !== "") {
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
                        this.plugin.settings.videoNotePath = value.trim();
                        await this.plugin.saveSettings();
                        // Refresh the display to update the organize by channel toggle state
                        // this.display();
                    }));

            new Setting(containerEl)
                .setName('Organize by channel')
                .setDesc('Create subfolders for each channel (e.g., Youtube/Channel Name/video.md). Only applies when using a custom video note location.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.organizeByChannel)
                    .setDisabled(!this.plugin.settings.videoNotePath || !this.plugin.settings.videoNotePath.trim())
                    .onChange(async (value) => {
                        this.plugin.settings.organizeByChannel = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Automatically create notes')
                .setDesc('If enabled, a new note will be created for each new video fetched.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.autoCreateNoteEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.autoCreateNoteEnabled = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            if (this.plugin.settings.autoCreateNoteEnabled) {
                new Setting(containerEl)
                    .setName('Link to daily note')
                    .setDesc('If enabled, a link to the new video note will be added to your daily note.')
                    .addToggle(toggle => toggle
                        .setValue(this.plugin.settings.linkToDailyNote)
                        .onChange(async (value) => {
                            this.plugin.settings.linkToDailyNote = value;
                            await this.plugin.saveSettings();
                        }));
            }

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
                        this.plugin.settings.enableTemplateSystem = value;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh to show/hide template settings
                    }));

            if (this.plugin.settings.enableTemplateSystem) {
                // Custom Template Textarea
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
                                this.plugin.settings.customTemplate = DEFAULT_TEMPLATE;
                                await this.plugin.saveSettings();
                                this.display();
                                new Notice('Template reset to default');
                            }
                        }));

                // Add textarea below the setting
                const textareaContainer = containerEl.createDiv('template-textarea-container');
                const textarea = textareaContainer.createEl('textarea', {
                    cls: 'template-textarea',
                    text: this.plugin.settings.customTemplate
                });
                textarea.rows = 20;
                textarea.style.width = '100%';
                textarea.style.fontFamily = 'monospace';
                textarea.style.fontSize = '12px';
                textarea.style.resize = 'vertical';
                textarea.style.minHeight = '300px';
                textarea.style.padding = '10px';
                textarea.style.borderRadius = '4px';
                textarea.style.border = '1px solid var(--background-modifier-border)';
                textarea.style.backgroundColor = 'var(--background-primary)';

                textarea.addEventListener('change', async () => {
                    this.plugin.settings.customTemplate = textarea.value;
                    await this.plugin.saveSettings();
                });

                // Collapsible Variable Reference Section
                const detailsEl = containerEl.createEl('details', {
                    cls: 'template-variables-reference'
                });
                detailsEl.style.marginTop = '16px';
                detailsEl.style.padding = '12px';
                detailsEl.style.backgroundColor = 'var(--background-secondary)';
                detailsEl.style.borderRadius = '8px';

                const summaryEl = detailsEl.createEl('summary', {
                    text: '📖 Available Variables (click to expand)'
                });
                summaryEl.style.cursor = 'pointer';
                summaryEl.style.fontWeight = 'bold';
                summaryEl.style.marginBottom = '8px';

                const referenceContent = detailsEl.createDiv();
                referenceContent.innerHTML = TEMPLATE_VARIABLES_REFERENCE;
            }
        // Debug settings - only show in development mode
        if (true) {
            // AI Features section
            new Setting(containerEl)
                .setHeading()
                .setName('AI Features')
                .setDesc('Configure AI-powered features');

            new Setting(containerEl)
                .setName('Enable AI Summary [Experimental]')
                .setDesc('Use Google Gemini to generate AI summaries of YouTube videos. Requires a Gemini API key.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enableAISummary)
                    .onChange(async (value) => {
                        this.plugin.settings.enableAISummary = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }));

            if (this.plugin.settings.enableAISummary) {
                new Setting(containerEl)
                    .setName('AI Provider')
                    .setDesc('Choose which AI provider to use for video summaries.')
                    .addDropdown(dropdown => dropdown
                        .addOption('gemini', 'Google Gemini')
                        .addOption('openrouter', 'OpenRouter (experimental)')
                        .setValue(this.plugin.settings.aiProvider)
                        .onChange(async (value: 'gemini' | 'openrouter') => {
                            this.plugin.settings.aiProvider = value;
                            await this.plugin.saveSettings();
                            this.display();
                        }));

                if (this.plugin.settings.aiProvider === 'gemini') {
                    new Setting(containerEl)
                        .setName('Gemini API Key')
                        .setDesc('Your Google Gemini API key. Get one from [Google AI Studio] (https://aistudio.google.com/app/apikey). Only Google AI Studio support video_url at this time. Vertex AI does not support video_url yet.')
                        .addText(text => {
                            text.inputEl.type = 'password';
                            text.inputEl.style.width = '100%';
                            text
                                .setPlaceholder('Enter your Gemini API key')
                                .setValue(this.plugin.settings.geminiApiKey)
                                .onChange(async (value) => {
                                    this.plugin.settings.geminiApiKey = value;
                                    await this.plugin.saveSettings();
                                });
                        });
                } else {
                    new Setting(containerEl)
                        .setName('OpenRouter API Key')
                        .setDesc('Your OpenRouter API key. Get one from openrouter.ai/keys.')
                        .addText(text => {
                            text.inputEl.type = 'password';
                            text.inputEl.style.width = '100%';
                            text
                                .setPlaceholder('sk-or-...')
                                .setValue(this.plugin.settings.openRouterApiKey)
                                .onChange(async (value) => {
                                    this.plugin.settings.openRouterApiKey = value;
                                    await this.plugin.saveSettings();
                                });
                        });

                    new Setting(containerEl)
                        .setName('Model ID')
                        .setDesc('Enter a Gemini model ID from OpenRouter (e.g. google/gemini-3-flash-preview).')
                        .addText(text => {
                            text.inputEl.style.width = '100%';
                            text
                                .setPlaceholder('google/gemini-3-flash-preview')
                                .setValue(this.plugin.settings.openRouterModel)
                                .onChange(async (value) => {
                                    this.plugin.settings.openRouterModel = value;
                                    await this.plugin.saveSettings();
                                });
                        });
                }

                new Setting(containerEl)
                    .setName('Summary Prompt')
                    .setDesc('Customize the prompt sent to Gemini when generating video summaries.');

                const promptContainer = containerEl.createDiv('summary-prompt-container');
                const promptTextarea = promptContainer.createEl('textarea', {
                    cls: 'summary-prompt-textarea',
                    text: this.plugin.settings.summaryPrompt
                });
                promptTextarea.rows = 5;
                promptTextarea.style.width = '100%';
                promptTextarea.style.fontFamily = 'monospace';
                promptTextarea.style.fontSize = '12px';
                promptTextarea.style.resize = 'vertical';
                promptTextarea.style.minHeight = '80px';
                promptTextarea.style.padding = '10px';
                promptTextarea.style.borderRadius = '4px';
                promptTextarea.style.border = '1px solid var(--background-modifier-border)';
                promptTextarea.style.backgroundColor = 'var(--background-primary)';

                promptTextarea.addEventListener('change', async () => {
                    this.plugin.settings.summaryPrompt = promptTextarea.value;
                    await this.plugin.saveSettings();
                });
            }
        }


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
                        this.plugin.settings.autoFetchEnabled = value;
                        await this.plugin.saveSettings();
                        this.display();
                        this.updateListPaneView();
                    }));


            if (this.plugin.settings.autoFetchEnabled) {
                new Setting(containerEl)
                    .setName('Fetch interval')
                    .setDesc('How often to automatically fetch videos (in minutes)')
                    .addDropdown(dropdown => {
                        // Add debug option for 5 seconds if in debug mode
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
                                this.plugin.settings.autoFetchInterval = parseFloat(value);
                                await this.plugin.saveSettings();

                                if (parseFloat(value) < 1) {
                                    new Notice('⚠️ Debug mode: Using very short fetch interval!');
                                }
                                this.updateListPaneView();
                                this.display();
                            });

                        return dropdown;
                    });

                new Setting(containerEl)
                    .setName('Full fetch on every auto-fetch')
                    .setDesc(UI_TEXT.FULL_FETCH_WARNING_DESC)
                    .addToggle(toggle => toggle
                        .setValue(this.plugin.settings.fullFetchOnEveryAutoFetch)
                        .onChange(async (value) => {
                            // If user is ENABLING full fetch, show confirmation modal
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
                                    // User cancelled - don't change the setting
                                    // Reset the toggle to its previous state
                                    toggle.setValue(false);
                                    return;
                                }
                            }

                            // Apply the setting change
                            this.plugin.settings.fullFetchOnEveryAutoFetch = value;
                            await this.plugin.saveSettings();

                            // Show toast notice when enabled
                            if (value) {
                                new Notice(UI_TEXT.FULL_FETCH_ENABLED_NOTICE);
                            }

                            // Refresh display to show/hide conditional warnings
                            this.display();
                        }));

                // Show recommendations when full fetch is enabled
                if (this.plugin.settings.fullFetchOnEveryAutoFetch) {
                    if (this.plugin.settings.autoCreateNoteEnabled) {
                        new Setting(containerEl)
                            .setName('⚠️ Warning')
                            .setDesc(UI_TEXT.FULL_FETCH_NOT_RECOMMEND_AUTO_VIDEO_NOTE_WARNING)
                            .setClass('setting-item-info');
                    }
                }

                new Setting(containerEl)
                    .setName('Fetch on startup')
                    .setDesc('Automatically fetch videos when Obsidian starts')
                    .addToggle(toggle => toggle
                        .setValue(this.plugin.settings.fetchOnStartup)
                        .onChange(async (value) => {
                            this.plugin.settings.fetchOnStartup = value;
                            await this.plugin.saveSettings();
                        }));

                if (this.plugin.settings.lastAutoFetchTime > 0) {
                    const lastFetch = new Date(this.plugin.settings.lastAutoFetchTime);

                    // Format the interval display
                    const intervalDisplay = this.plugin.settings.autoFetchInterval < 1
                        ? `${Math.round(this.plugin.settings.autoFetchInterval * 60)}s`
                        : `${this.plugin.settings.autoFetchInterval}min`;

                    new Setting(containerEl)
                        .setName('Last auto-fetch')
                        .setDesc(`Last: ${lastFetch.toLocaleString()} (every ${intervalDisplay})`);
                }
            }
        }

        new Setting(containerEl)
            .setHeading()
            .setName('Functions')
            .setDesc('Functions to fetch and update liked videos');
        if (refreshToken !== null && refreshToken !== "") {


            new Setting(containerEl)
                .setName('Fetch all liked videos so far and add to local storage. This will override all the liked videos in local storage.')
                .addButton(button => button
                    .setButtonText('Full scan')
                    .onClick(async () => {
                        try {
                            // Store existing videos before fetch to identify new ones
                            const storedLikedVideosBefore = localStorageService.getLikedVideos();
                            const storedVideoIdsSet = new Set(storedLikedVideosBefore.map(v => v.id));

                            /// get number of the videos in the liked videos
                            const totalLikedVideos = await this.likedVideoApi.fetchTotalLikedVideoCount();
                            new Notice(`${totalLikedVideos} videos in total`);

                            // repeat fetching liked videos
                            // this works based on nextPageToken. If the fetched result has nextPageToken, fetch the next page.
                            // If the fetched result has no nextPageToken, that means we have fetched all the liked videos.
                            // Then, merge the fetched videos data and save to LocalStorage.
                            let allLikedVideos: YouTubeVideo[] = [];
                            let nextPageToken: string | undefined = undefined;

                            do {
                                const response: YouTubeVideosResponse = await this.likedVideoApi.fetchLikedVideos(this.plugin.settings.fullFetchLimit, nextPageToken);
                                allLikedVideos = allLikedVideos.concat(response.items);
                                if (response.nextPageToken === undefined || response.nextPageToken === '' || response.nextPageToken === null) {
                                    break;
                                } else {
                                    nextPageToken = response.nextPageToken;
                                }
                            } while (nextPageToken !== undefined);

                            // Save the fetched videos to LocalStorage
                            localStorageService.setLikedVideos(allLikedVideos);
                            this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
                                { videos: allLikedVideos },
                                { history: true });
                            this.display();
                            this.updateListPaneView()
                            new Notice(`All liked videos have been fetched and saved to LocalStorage - ${allLikedVideos.length} videos`);

                            // Auto-create notes for new videos if enabled
                            const newLikedVideos = allLikedVideos.filter(v => !storedVideoIdsSet.has(v.id));
                            if (this.plugin.settings.autoCreateNoteEnabled && newLikedVideos.length > 0) {
                                for (const video of newLikedVideos) {
                                    await this.plugin.automateVideoProcessing(video);
                                }
                                new Notice(`Created ${newLikedVideos.length} new video notes`);
                            }

                        } catch (error) {
                            new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                        }
                    }));

            new Setting(containerEl)
                .setName('Fetch all liked videos so far, compare to the stored videos and filter/add the new videos to local storage')
                .addButton(button => button
                    .setButtonText('Fetch')
                    .onClick(async () => {
                        try {
                            // Store existing videos before fetch to identify new ones
                            const storedLikedVideosBefore = localStorageService.getLikedVideos();
                            const storedVideoIdsSet = new Set(storedLikedVideosBefore.map(v => v.id));

                            /// get number of the videos in the liked videos
                            // const totalLikedVideos = await this.likedVideoApi.fetchTotalLikedVideoCount();
                            // new Notice(`${totalLikedVideos} videos in total`);

                            // repeat fetching liked videos
                            // this works based on nextPageToken. If the fetched result has nextPageToken, fetch the next page.
                            // If the fetched result has no nextPageToken, that means we have fetched all the liked videos.
                            // Then, merge the fetched videos data and save to LocalStorage.
                            let allLikedVideos: YouTubeVideo[] = [];
                            let nextPageToken: string | undefined = undefined;

                            const response: YouTubeVideosResponse = await this.likedVideoApi.fetchLikedVideos(this.plugin.settings.fetchLimit, nextPageToken);
                            allLikedVideos = allLikedVideos.concat(response.items);

                            // Save the fetched videos to LocalStorage
                            localStorageService.setLikedVideos(allLikedVideos);
                            this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
                                { videos: allLikedVideos },
                                { history: true });
                            this.display();
                            this.updateListPaneView()

                            new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(response.items?.length || 0));

                            // Auto-create notes for new videos if enabled
                            const newLikedVideos = allLikedVideos.filter(v => !storedVideoIdsSet.has(v.id));
                            if (this.plugin.settings.autoCreateNoteEnabled && newLikedVideos.length > 0) {
                                for (const video of newLikedVideos) {
                                    await this.plugin.automateVideoProcessing(video);
                                }
                                new Notice(`Created ${newLikedVideos.length} new video notes`);
                            }

                        } catch (error) {
                            console.error(error);
                            new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                        }
                    }));
        }

        new Setting(containerEl)
            .setName('Clear local storage')
            .addButton(button => button
                .setButtonText('Clear stored liked videos in local storage')
                .onClick(async () => {
                    localStorageService.setLikedVideos([]);
                    this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
                        { videos: [] },
                        { history: true });

                    this.display();
                    this.updateListPaneView();

                    new Notice('Liked videos have been cleared');
                }));

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
                    this.plugin.settings.googleClientId = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Client secret')
            .setDesc('Client secret for accessing the YouTube Data API v3')
            .addText(text => text
                .setPlaceholder('Enter your client secret')
                .setValue(this.plugin.settings.googleClientSecret)
                .onChange(async (value) => {
                    this.plugin.settings.googleClientSecret = value;
                    await this.plugin.saveSettings();
                }));


        new Setting(containerEl)
            .setName('Login with Google')
            .setDesc('Login to your Google account')
            .addButton(button => button
                .setButtonText(refreshToken ? 'Logout' : 'Login')
                .onClick(async (): Promise<void> => {
                    refreshToken ?
                        await handleGoogleLogout(this.plugin.settings,
                            () => {
                                this.display();
                                this.updateListPaneView();
                            }, () => {
                                this.display();
                                this.updateListPaneView();
                            }
                        )
                        : await handleGoogleLogin(this.plugin.settings, () => {
                            this.display();
                            this.updateListPaneView();
                        });
                }));
        // Debug settings - only show in development mode
        const debugConfig = debugLogger.getConfig();
        if (debugConfig.enabled) {
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
                    .onChange((value: any) => {
                        debugLogger.updateConfig({ logLevel: value });
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

    async fetchAndUpdateLikedVideos(app: App, limit = 50, repetitive = false): Promise<void> {
        let allLikedVideos: YouTubeVideo[] = [];
        let nextPageToken: string | undefined = undefined;
        do {
            const response: YouTubeVideosResponse = await this.likedVideoApi.fetchLikedVideos(limit, nextPageToken);
            allLikedVideos = allLikedVideos.concat(response.items);
            nextPageToken = response.nextPageToken;
        } while (repetitive && nextPageToken);

        const storedLikedVideos = localStorageService.getLikedVideos();
        const storedLikedVideoIdsSet = new Set(storedLikedVideos.map(video => video.id));

        const newLikedVideos = allLikedVideos.filter(video => !storedLikedVideoIdsSet.has(video.id));
        const fetchedLikedVideoIdsSet = new Set(allLikedVideos.map(video => video.id));

        if (newLikedVideos.length > 0) {
            new Modal(app).setTitle('New Liked Videos').setContent(JSON.stringify(newLikedVideos, null, 2)).open();
        }

        let updatedLikedVideos;
        if (repetitive) {
            updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos.filter(video => fetchedLikedVideoIdsSet.has(video.id))];
        } else {
            updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos];
        }
        localStorageService.setLikedVideos(updatedLikedVideos);
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
            { videos: updatedLikedVideos },
            { history: true });

        new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(newLikedVideos.length));

        // Automatically create notes for new videos if enabled
        if (this.plugin.settings.autoCreateNoteEnabled) {
            for (const video of newLikedVideos) {
                await this.plugin.automateVideoProcessing(video);
            }
        }
    }

}

