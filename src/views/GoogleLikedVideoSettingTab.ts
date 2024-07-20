/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Modal, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import { localStorageService, setLikedVideos } from 'src/storage';
import { handleGoogleLogin, handleGoogleLogout } from 'src/auth';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import { LikedVideoApi } from 'src/api';
import GoogleLikedVideoPlugin from '../main';
import { LikedVideoListPane } from './LikedVideoListPane';

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;
    likedVideoApi: LikedVideoApi;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.likedVideoApi = new LikedVideoApi(this.plugin.settings);
    }

    updateView(): void {
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
            .setDesc('Numbers of video to fetch at each request')
            .addSlider(slider => slider
                .setValue(fetchLimit)
                .setLimits(10, 100, 10)
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
                                this.updateView();
                            }, () => {
                                this.display();
                                this.updateView();
                            }
                        )
                        : await handleGoogleLogin(this.plugin.settings, () => {
                            this.display();
                            this.updateView();
                        });
                }));


        new Setting(containerEl)
            .setHeading()
            .setName('Functions')
            .setDesc('Functions to fetch and update liked videos');


        new Setting(containerEl)
            .setName('Fetch all liked videos so far and add to local storage')
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
                            const response: YouTubeVideosResponse = await this.likedVideoApi.fetchLikedVideos(50, nextPageToken);
                            allLikedVideos = allLikedVideos.concat(response.items);
                            if (response.nextPageToken === undefined || response.nextPageToken === '' || response.nextPageToken === null) {
                                break;
                            } else {
                                nextPageToken = response.nextPageToken;
                            }
                        } while (nextPageToken !== undefined);

                        // Save the fetched videos to LocalStorage
                        setLikedVideos(allLikedVideos);
                        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
                            { videos: allLikedVideos },
                            { history: true });
                        this.display();
                        this.updateView()
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
                        this.updateView()
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
                    this.updateView();

                    new Notice('Liked videos have been cleared');
                }));
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

        setLikedVideos(updatedLikedVideos);
        this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.setState(
            { videos: updatedLikedVideos },
            { history: true });

        new Notice(`New liked videos have been fetched and added to LocalStorage - ${newLikedVideos.length} new videos.`);
    }

}

