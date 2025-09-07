/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Modal, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import { localStorageService } from 'src/storage';
import { handleGoogleLogin, handleGoogleLogout } from 'src/auth';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import { LikedVideoApi } from 'src/api';
import GoogleLikedVideoPlugin from '../main';
import { LikedVideoListPane } from './LikedVideoListPane';
import { debugLogger } from 'src/debug';

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
                .setLimits(10, 100, 30)
                .onChange(async (value) => {
                    this.plugin.settings.fetchLimit = value;
                    await this.plugin.saveSettings();
                    this.display();
                }))
            .addText(text => text
                .setValue(`${fetchLimit}`)
                .setDisabled(true));


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
                .setButtonText(localStorageService.getRefreshToken() ? 'Logout' : 'Login')
                .onClick(async (): Promise<void> => {
                    localStorageService.getRefreshToken() ?
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

        new Setting(containerEl)
            .setHeading()
            .setName('Functions')
            .setDesc('Functions to fetch and update liked videos');


        new Setting(containerEl)
            .setName('Fetch all liked videos so far and add to local storage. This will override all the liked videos in local storage.')
            .addButton(button => button
                .setButtonText('Full scan')
                .onClick(async () => {
                    try {
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
                        await this.fetchAndUpdateLikedVideos(this.app, 20, false);
                        this.display();
                        this.updateListPaneView()
                    } catch (error) {
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));

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
        const totalLikedVideos = await this.likedVideoApi.fetchTotalLikedVideoCount();
        new Notice(`${totalLikedVideos} videos in total`);

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
            const unlikedVideos = storedLikedVideos.filter(video => !fetchedLikedVideoIdsSet.has(video.id));
            updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos.filter(video => fetchedLikedVideoIdsSet.has(video.id))];
        } else {
            updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos];
        }

        localStorageService.setLikedVideos(updatedLikedVideos);
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
            { videos: updatedLikedVideos },
            { history: true });

        new Notice(`New liked videos have been fetched and added to LocalStorage - ${newLikedVideos.length} new videos.`);
    }

}

