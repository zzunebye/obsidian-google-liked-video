/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Editor, MarkdownView, Plugin, PluginManifest, WorkspaceLeaf } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings } from 'src/types';
import { SampleModal } from 'src/views/modals';
import { GoogleLikedVideoSettingTab } from 'src/views/GoogleLikedVideoSettingTab';
import { LikedVideoListView, VIEW_TYPE_LIKED_VIDEO_LIST } from 'src/views/LikedVideoListView';
import { LikedVideoApi } from './api';

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
	likedVideoApi: LikedVideoApi;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
	}

	async onload() {
		await this.loadSettings();
		this.likedVideoApi = new LikedVideoApi(this?.settings);

		this.registerView(
			VIEW_TYPE_LIKED_VIDEO_LIST,
			(leaf) => new LikedVideoListView(leaf, this)
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new GoogleLikedVideoSettingTab(this.app, this));


		this.addRibbonIcon("dice", "Activate Liked Video List View", () => {
			this.activateView();
		});

		const ribbonIconOpenSetting = this.addRibbonIcon('cog', 'Open setting of google-ytb-liked-video-plugin', (evt: MouseEvent) => {
			const setting = (this.app as any).setting;
			setting.open();
			setting.openTabById(APP_ID);

		});
		// Perform additional things with the ribbon
		ribbonIconOpenSetting.addClass('my-plugin-ribbon-class-open-setting');

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

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() { }

	reloadView() {
		this.app.workspace.getActiveViewOfType(LikedVideoListView)?.onClose();
		this.app.workspace.getActiveViewOfType(LikedVideoListView)?.onload();
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