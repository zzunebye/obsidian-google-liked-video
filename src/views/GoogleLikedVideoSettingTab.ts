/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Modal, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import { localStorageService, setLikedVideos } from 'src/storage';
import { handleGoogleLogin } from 'src/auth';
import { YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import { fetchLikedVideos, fetchPlaylists, fetchTotalLikedVideoCount, sendRequest } from 'src/api';
import GoogleLikedVideoPlugin from 'main';

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
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

                        const response = await sendRequest(url, {});
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
                        const totalLikedVideos = await fetchTotalLikedVideoCount();
                        new Notice(`${totalLikedVideos} videos in total`);

                        // repeat fetching liked videos
                        // this works based on nextPageToken. If the fetched result has nextPageToken, fetch the next page.
                        // If the fetched result has no nextPageToken, that means we have fetched all the liked videos.
                        // Then, merge the fetched videos data and save to LocalStorage.
                        let allLikedVideos: YouTubeVideo[] = [];
                        let nextPageToken: string | undefined = undefined;
                        let count = 20;

                        do {
                            const response: YouTubeVideosResponse = await fetchLikedVideos(50, nextPageToken);
                            console.log('response is returned', response.items.length);
                            allLikedVideos = allLikedVideos.concat(response.items);
                            if (response.nextPageToken === undefined || response.nextPageToken === '' || response.nextPageToken === null) {
                                console.log('No more liked videos');
                                break;
                            } else {
                                console.log('nextPageToken', response.nextPageToken);
                                nextPageToken = response.nextPageToken;
                            }
                            count--;
                        } while (count > 0);

                        // Save the fetched videos to LocalStorage
                        setLikedVideos(allLikedVideos);
                        new Notice(`All liked videos have been fetched and saved to LocalStorage - ${allLikedVideos.length} videos`);

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
                    const latestLikedVideosFromAPI = await fetchLikedVideos(10, likedVideos[0]?.id);

                    // Compare to the latest liked video saved on LocalStorage. 
                    // If the last Id cannot be found, then fetch all the liked videos from the API
                    // However, maybe the last liked video on local storage is deleted from the API list (If the user unliked it)
                    // In that case, fetch all the liked videos from the API

                    let newLikedVideos: YouTubeVideo[] = [];

                    // Check if the last liked video ID exists in the latest liked videos from the API
                    const lastLikedVideoExists: boolean = latestLikedVideosFromAPI?.items?.some(video => video.id === lastLikedVideoId) ?? false;

                    if (!lastLikedVideoExists) {
                        // If the last liked video ID does not exist, fetch all liked videos from the API
                        const allLikedVideosFromAPI = await fetchLikedVideos();
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
                            const allLikedVideosFromAPI = await fetchLikedVideos();
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

                        const response = await sendRequest(url, {});
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
                        const data = await fetchPlaylists();

                        // show the data in the modal
                        new Modal(this.app).setTitle('result').setContent(JSON.stringify(data, null, 2)).open();

                    } catch (error) {
                        console.log('error', error)
                        new Modal(this.app).setTitle('error').setContent("error: " + error).open();
                    }
                }));
    }
    // https://youtube.googleapis.com/youtube/v3/playlists?part=snippet%2CcontentDetails&maxResults=25&mine=true

}
