/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Modal, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import { localStorageService, setLikedVideos } from 'src/storage';
import { handleGoogleLogin } from 'src/auth';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import { LikedVideoApi, sendRequest } from 'src/api';
import GoogleLikedVideoPlugin from '../main';
import { LikedVideoListView } from './LikedVideoListView';

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;
    likedVideoApi: LikedVideoApi;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.likedVideoApi = new LikedVideoApi(this.plugin.settings);
    }

    sendRequestWithSettings = (url: string, headers: Record<string, string>): Promise<Response> => sendRequest(url, headers, this.plugin.settings);
    updateView(): void {
        this.app.workspace.getActiveViewOfType(LikedVideoListView)?.onClose();
        this.app.workspace.getActiveViewOfType(LikedVideoListView)?.onOpen();
    }
    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        const likedVideos = localStorageService.getLikedVideos();
        const likedVideosCount = likedVideos.length;
        console.log(likedVideosCount);
        const maxVideos = 5000;
        const progressValue = likedVideosCount / maxVideos;

        new Setting(containerEl)
            .setName('Quota')
            .setDesc('Quota of the liked videos')
            .addProgressBar(progressBar => progressBar
                .setValue(progressValue * 100))
            .addText(text => text
                .setDisabled(true)
                .setValue(`${likedVideosCount} / ${maxVideos} (${(progressValue * 100).toFixed(2)}%)`))


        new Setting(containerEl)
            .setHeading()
            .setName('Setup')
            .setDesc('Setup the plugin');


        new Setting(containerEl)
            .setName('Client ID')
            .setDesc('Client ID on your own')
            .addText(text => text
                .setPlaceholder('Enter your client ID')
                .setValue(this.plugin.settings.googleClientId)
                .onChange(async (value) => {
                    this.plugin.settings.googleClientId = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Client Secret')
            .setDesc('Client Secret on your own')
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
                    await handleGoogleLogin(this.plugin.settings);
                }));


        new Setting(containerEl)
            .setHeading()
            .setName('Paths')
            .setDesc('Paths to save the data');


        new Setting(containerEl)
            .setName('Daily Note Folder')
            .setDesc('Folder to save the daily note')
            .addText(text => text
                .setPlaceholder('Enter your daily note folder')
                .setValue(this.plugin.settings.dailyNotePath)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNotePath = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setHeading()
            .setName('Testing functions')
            .setDesc('Testing functions');

        new Setting(containerEl)
            .setName('Test Fetch Recent Liked Videos')
            .addButton(button => button
                .setButtonText('Fetch')
                .onClick(async () => {
                    // fetch https://youtube.googleapis.com/youtube/v3/videos?part=snippet%2CcontentDetails%2Cstatistics&myRating=like HTTP GET with 
                    // 'bearer ${this.plugin.settings.accessToken}' as authorization header
                    // show the response in the modal
                    try {
                        const url = 'https://youtube.googleapis.com/youtube/v3/videos?part=snippet%2CcontentDetails%2Cstatistics&myRating=like';

                        const response = await this.sendRequestWithSettings(url, {});
                        const data = await response.json();
                        console.log(data);

                        // show the data in the modal
                        new Modal(this.app).setTitle('result').setContent(JSON.stringify(data, null, 2)).open();

                    } catch (error) {
                        console.log('error', error)
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));



        new Setting(containerEl)
            .setName('Fetch All Liked Videos so far and add to LocalStorage')
            .addButton(button => button
                .setButtonText('Fetch')
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
                            console.log('response is returned', response.items.length);
                            allLikedVideos = allLikedVideos.concat(response.items);
                            if (response.nextPageToken === undefined || response.nextPageToken === '' || response.nextPageToken === null) {
                                console.log('No more liked videos');
                                break;
                            } else {
                                console.log('nextPageToken', response.nextPageToken);
                                nextPageToken = response.nextPageToken;
                            }
                        } while (nextPageToken !== undefined);

                        // Save the fetched videos to LocalStorage
                        setLikedVideos(allLikedVideos);
                        this.app.workspace.getActiveViewOfType(LikedVideoListView)?.setState(
                            { videos: allLikedVideos },
                            { history: true });
                        this.display();
                        this.updateView()
                        new Notice(`All liked videos have been fetched and saved to LocalStorage - ${allLikedVideos.length} videos`);

                    } catch (error) {
                        console.log('error', error)
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));

        new Setting(containerEl)
            .setName('Fetch All Liked Videos so far, compare to the stored videos and filter/add the new videos to LocalStorage')
            .addButton(button => button
                .setButtonText('Fetch')
                .onClick(async () => {
                    try {
                        await this.fetchAndUpdateLikedVideos(this.app, 20, false);
                        this.display();
                        this.updateView()
                    } catch (error) {
                        console.log('error', error)
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));

        new Setting(containerEl)
            .setName("Fetch Latest Liked Videos")
            .addButton(button => button
                .setButtonText('Fetch')
                .onClick(async () => {

                    const likedVideos = localStorageService.getLikedVideos();
                    const lastLikedVideoId = localStorageService.getLastLikedVideoId();

                    // Get the latest liked videos from the API
                    const latestLikedVideosFromAPI = await this.likedVideoApi.fetchLikedVideos(10, likedVideos[0]?.id);

                    // Compare to the latest liked video saved on LocalStorage. 
                    // If the last Id cannot be found, then fetch all the liked videos from the API
                    // However, maybe the last liked video on local storage is deleted from the API list (If the user unliked it)
                    // In that case, fetch all the liked videos from the API

                    let newLikedVideos: YouTubeVideo[] = [];

                    // Check if the last liked video ID exists in the latest liked videos from the API
                    const lastLikedVideoExists: boolean = latestLikedVideosFromAPI?.items?.some(video => video.id === lastLikedVideoId) ?? false;

                    if (!lastLikedVideoExists) {
                        // If the last liked video ID does not exist, fetch all liked videos from the API
                        const allLikedVideosFromAPI = await this.likedVideoApi.fetchLikedVideos();
                        newLikedVideos = allLikedVideosFromAPI.items;
                    } else {
                        // If the last liked video ID exists, find the new liked videos
                        let foundLastLikedVideo = false;
                        for (const video of latestLikedVideosFromAPI.items) {
                            if (video.id === lastLikedVideoId) {
                                foundLastLikedVideo = true;
                                break;
                            }
                            newLikedVideos.push(video);
                        }
                        if (!foundLastLikedVideo) {
                            // If the last liked video ID was not found in the latest liked videos, fetch all liked videos from the API
                            const allLikedVideosFromAPI = await this.likedVideoApi.fetchLikedVideos();
                            newLikedVideos = allLikedVideosFromAPI.items;
                        }
                    }

                    if (newLikedVideos.length > 0) {
                        likedVideos.unshift(...newLikedVideos);
                    }
                    new Modal(this.app).setTitle('result').setContent(`${likedVideos.length} videos`).open();

                    setLikedVideos(likedVideos);
                }));


        new Setting(containerEl)
            .setName('Get the stored liked videos from local storage')
            .addButton(button => button
                .setButtonText('Get')
                .onClick(async () => {
                    const likedVideos: YouTubeVideo[] = localStorageService.getLikedVideos();
                    new Modal(this.app).setTitle('result').setContent(`${likedVideos.length} videos`).open();
                }));



        new Setting(containerEl)
            .setName('Fetch Today\'s Liked Videos and add to Daily Note')
            .addButton(button => button
                .setButtonText('Fetch')
                .onClick(async () => {
                    try {
                        const url = 'https://youtube.googleapis.com/youtube/v3/videos?'
                            + 'part=snippet,statistics'
                            + '&myRating=like';

                        const response = await this.likedVideoApi.sendRequest(url, {});
                        const data: YouTubeVideosResponse = await response.json();

                        // show the data in the modal
                        new Modal(this.app).setTitle('result').setContent(JSON.stringify(data, null, 2)).open();

                        // find daily note folder
                        const dailyNoteFolder = this.app.vault.getFolderByPath(this.plugin.settings.dailyNotePath);
                        if (!dailyNoteFolder) {
                            console.log('Daily Note folder not found');
                            return;
                        }
                        const dateNow = window.moment();

                        const dailyNotes = getAllDailyNotes();
                        if (!dailyNotes) {
                            console.log('No daily notes found');
                            return;
                        }
                        const todayDailyNote: TFile = getDailyNote(dateNow, dailyNotes);
                        console.log('todayDailyNote', todayDailyNote);

                        // add liked videos to the daily note
                        if (todayDailyNote) {
                            const fileContent = await this.app.vault.read(todayDailyNote);
                            const likedVideosContent = data.items.map((video: YouTubeVideo) => {
                                return `- [${video.snippet.title}](https://www.youtube.com/watch?v=${video.id})`;
                            }).join('\n');

                            const updatedContent = `${fileContent}\n\n## Liked Videos\n${likedVideosContent}`;
                            await this.app.vault.modify(todayDailyNote, updatedContent);
                            new Notice('Liked videos added to today\'s daily note.');
                        } else {
                            console.log('Today\'s daily note not found');
                        }


                    } catch (error) {
                        console.log('error', error)
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));

        new Setting(containerEl)
            .setName('My Playlists')
            .addButton(button => button
                .setButtonText('Fetch')
                .onClick(async () => {
                    try {
                        const data = await this.likedVideoApi.fetchPlaylists();

                        // show the data in the modal
                        new Modal(this.app).setTitle('result').setContent(JSON.stringify(data, null, 2)).open();

                    } catch (error) {
                        console.log('error', error)
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));
    }
    async fetchAndUpdateLikedVideos(app: App, limit = 50, repetitive = false): Promise<void> {
        console.log('Fetching all liked videos...');
        const totalLikedVideos = await this.likedVideoApi.fetchTotalLikedVideoCount();
        console.log(`Total liked videos: ${totalLikedVideos}`);
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
            if (unlikedVideos.length > 0) {
                new Modal(app).setTitle('Unliked Videos').setContent(JSON.stringify(unlikedVideos, null, 2)).open();
            }
            updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos.filter(video => fetchedLikedVideoIdsSet.has(video.id))];
        } else {
            updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos];
        }

        setLikedVideos(updatedLikedVideos);
        this.app.workspace.getActiveViewOfType(LikedVideoListView)?.setState(
            { videos: updatedLikedVideos },
            { history: true });

        new Notice(`New liked videos have been fetched and added to LocalStorage - ${newLikedVideos.length} new videos.`);
    }

}

