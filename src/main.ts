/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Plugin, PluginManifest, Vault, WorkspaceLeaf } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings } from 'src/types';
import { GoogleLikedVideoSettingTab } from 'src/views/GoogleLikedVideoSettingTab';
import { LikedVideoListPane, VIEW_TYPE_LIKED_VIDEO_LIST } from 'src/views/LikedVideoListPane';
import { LikedVideoApi } from './api';

const DEFAULT_SETTINGS: ObsidianGoogleLikedVideoSettings = {
	accessToken: '',
	googleClientId: '2833248109-o6ap9n7tlsp2kno0tojefnsb15i1ecgl.apps.googleusercontent.com',
	googleClientSecret: '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',
	dailyNotePath: '',
	fetchLimit: 10
}

export const APP_ID = 'geulo-youtube-liked-video';

export default class GoogleLikedVideoPlugin extends Plugin {
	settings: ObsidianGoogleLikedVideoSettings;
	vault: Vault;
	likedVideoApi: LikedVideoApi;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
	}

	async onload() {
		await this.loadSettings();
		this.likedVideoApi = new LikedVideoApi(this?.settings);
		this.vault = this.app.vault;

		this.registerView(
			VIEW_TYPE_LIKED_VIDEO_LIST,
			(leaf) => new LikedVideoListPane(leaf, this)
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GoogleLikedVideoSettingTab(this.app, this));


		this.addRibbonIcon("youtube", "Activate Liked Video List View", () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-liked-video-list-view',
			name: 'Open Youtube Liked Video List View',
			callback: () => {
				this.activateView();
			}
		});

		this.addCommand({
			id: 'open-liked-video-setting',
			name: 'Open Youtube Liked Video Setting',
			callback: () => {
				const setting = (this.app as any).setting;
				setting.open();
				setting.openTabById(APP_ID);
			}
		});

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => { });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() { }

	reloadView() {
		this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onClose();
		this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onload();
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_LIKED_VIDEO_LIST);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_LIKED_VIDEO_LIST, active: true });
		}
		if (leaf) {
			// "Reveal" the leaf in case it is in a collapsed sidebar
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}