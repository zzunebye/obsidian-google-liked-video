/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { getAccessToken, getAccessTokenExpirationTime, getRefreshToken, setLikedVideos } from 'src/storage';
import { handleGoogleLogin, refreshAccessToken } from 'src/auth';
import { ObsidianGoogleLikedVideoSettings, YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { SampleModal } from 'src/views/modals';
import { getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import { fetchPlaylists, fetchTotalLikedVideoCount } from 'src/api';

const DEFAULT_SETTINGS: ObsidianGoogleLikedVideoSettings = {
	mySetting: 'default',
	accessToken: '',
	googleClientId: '2833248109-o6ap9n7tlsp2kno0tojefnsb15i1ecgl.apps.googleusercontent.com',
	googleClientSecret: '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',
	dailyNotePath: ''
}

const APP_ID = 'youtube-liked-video-plugin';

export default class GoogleLikedVideoPlugin extends Plugin {
	settings: ObsidianGoogleLikedVideoSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});

		const ribbonIconOpenSetting = this.addRibbonIcon('cog', 'Open setting of google-ytb-liked-video-plugin', (evt: MouseEvent) => {
			// Open the setting of google-ytb-liked-video-plugin
			// new SampleSettingTab(this.app, this).display();
			// this.addSettingTab(new SampleSettingTab(this.app, this));
			// console.log('Open setting of google-ytb-liked-video-plugin');
			// this.addSettingTab(new SampleSettingTab(this.app, this));

			const setting = (this.app as any).setting;
			setting.open();
			setting.openTabById(APP_ID);

		});
		ribbonIconOpenSetting.addClass('my-plugin-ribbon-class-open-setting');

		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');


		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GoogleLikedVideoSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class GoogleLikedVideoSettingTab extends PluginSettingTab {
	plugin: GoogleLikedVideoPlugin;

	constructor(app: App, plugin: GoogleLikedVideoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

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
				.setButtonText(getRefreshToken() ? 'Logout' : 'Login')
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





						// const url = 'https://youtube.googleapis.com/youtube/v3/videos?'
						// 	+ 'part=snippet,statistics'
						// 	+ '&maxResults=50'
						// 	+ '&myRating=like';

						// const response = await sendRequest(url, {});
						// const data: YouTubeVideosResponse = await response.json();

						// new Modal(this.app).setTitle('result').setContent(`${data.pageInfo.resultsPerPage} videos found`).open();

						// setLikedVideos(data.items);





						// // find daily note folder
						// const dailyNoteFolder = this.app.vault.getFolderByPath(this.plugin.settings.dailyNotePath);
						// if (!dailyNoteFolder) {
						// 	console.log('Daily Note folder not found');
						// 	return;
						// }
						// const dateNow = window.moment();

						// const dailyNotes = getAllDailyNotes();
						// if (!dailyNotes) {
						// 	console.log('No daily notes found');
						// 	return;
						// }
						// const todayDailyNote: TFile = getDailyNote(dateNow, dailyNotes);
						// console.log('todayDailyNote', todayDailyNote);

						// // add liked videos to the daily note
						// if (todayDailyNote) {
						// 	const fileContent = await this.app.vault.read(todayDailyNote);
						// 	const likedVideosContent = data.items.map((video: YouTubeVideo) => {
						// 		return `- [${video.snippet.title}](https://www.youtube.com/watch?v=${video.id})`;
						// 	}).join('\n');

						// 	const updatedContent = `${fileContent}\n\n## Liked Videos\n${likedVideosContent}`;
						// 	await this.app.vault.modify(todayDailyNote, updatedContent);
						// 	new Notice('Liked videos added to today\'s daily note.');
						// } else {
						// 	console.log('Today\'s daily note not found');
						// }


					} catch (error) {
						console.log('error', error)
						new Modal(this.app).setTitle('error').setContent("error: " + error).open();
					}
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



function createNotice(arg0: string) {
	new Notice(arg0);
}



