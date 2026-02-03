/* eslint-disable @typescript-eslint/no-var-requires */
import { App, Notice, Plugin, PluginManifest, Vault, WorkspaceLeaf } from 'obsidian';
import { ObsidianGoogleLikedVideoSettings, YouTubeVideo, YouTubeVideosResponse } from 'src/types';
import { GoogleLikedVideoSettingTab } from 'src/views/GoogleLikedVideoSettingTab';
import { LikedVideoListPane, VIEW_TYPE_LIKED_VIDEO_LIST } from 'src/views/LikedVideoListPane';
import { UserPlaylistsPane, VIEW_TYPE_USER_PLAYLISTS } from 'src/views/UserPlaylistsPane';
import { PlaylistVideosPane, VIEW_TYPE_PLAYLIST_VIDEOS } from 'src/views/PlaylistVideosPane';
import { LikedVideoApi, PlaylistApi } from './api';
import { localStorageService } from './storage';
import { debugLogger } from './debug';
import { UI_TEXT } from './constants/uiText';
import { categoriesService } from './categoriesService';
import { FeatureIntroModal } from './components/FeatureIntroModal';
import { getExpectedNotePath, generateVideoNoteContent, sanitizeFileName, getVideoUrl, linkToDailyNote } from './utils/noteUtils';
import { DEFAULT_TEMPLATE } from './utils/templateConstants';
import { TemplateService } from './services/templateService';

const DEFAULT_SETTINGS: ObsidianGoogleLikedVideoSettings = {
	accessToken: '',
	googleClientId: '',
	googleClientSecret: '',
	dailyNotePath: '',
	videoNotePath: '',
	organizeByChannel: false,
	fetchLimit: 10,
	fullFetchLimit: 100,
	autoFetchEnabled: false,
	autoFetchInterval: 60,
	fetchOnStartup: false,
	lastAutoFetchTime: 0,
	lastSeenVersion: '',
	autoCreateNoteEnabled: false,
	linkToDailyNote: false,
	fullFetchOnEveryAutoFetch: false,
	enableTemplateSystem: false,
	customTemplate: DEFAULT_TEMPLATE,
	openInObsidianWebViewer: false,
}

export const APP_ID = 'geulo-youtube-liked-video';

export default class GoogleLikedVideoPlugin extends Plugin {
	settings: ObsidianGoogleLikedVideoSettings;
	vault: Vault;
	likedVideoApi: LikedVideoApi;
	playlistApi: PlaylistApi;
	autoFetchInterval: NodeJS.Timeout | null = null;
	isFetching = false;
	paneRef: LikedVideoListPane | null = null;
	settingTabRef: GoogleLikedVideoSettingTab | null = null;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
	}

	async onload() {
		debugLogger.info('Plugin loading...');
		await this.loadSettings();
		if (this.settings) {
			this.likedVideoApi = new LikedVideoApi(this.settings);
			this.playlistApi = new PlaylistApi(this.settings);
			debugLogger.debug('API clients initialized');
		}

		this.vault = this.app.vault;

		this.registerView(
			VIEW_TYPE_LIKED_VIDEO_LIST,
			(leaf) => {
				this.paneRef = new LikedVideoListPane(leaf, this);
				return this.paneRef;
			}
		);

		this.registerView(
			VIEW_TYPE_USER_PLAYLISTS,
			(leaf) => {
				return new UserPlaylistsPane(leaf, this);
			}
		);

		this.registerView(
			VIEW_TYPE_PLAYLIST_VIDEOS,
			(leaf) => {
				// PlaylistVideosPane requires additional parameters, but we'll handle them via state
				return new PlaylistVideosPane(leaf, this, { type: 'liked' }, { id: 'liked', title: 'Loading...', description: '', itemCount: 0 });
			}
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.settingTabRef = new GoogleLikedVideoSettingTab(this.app, this);
		this.addSettingTab(this.settingTabRef);


		this.addRibbonIcon("youtube", "Geulo: Open YouTube Liked Videos View", () => {
			this.activateView();
		});

		this.addRibbonIcon("list-video", "Geulo: Open YouTube Playlists View", () => {
			this.activatePlaylistsView();
		});

		this.addCommand({
			id: 'open-liked-video-list-view',
			name: 'Open YouTube Liked Videos View',
			callback: () => {
				this.activateView();
			}
		});

		this.addCommand({
			id: 'open-user-playlists-view',
			name: 'Open YouTube Playlists View',
			callback: () => {
				this.activatePlaylistsView();
			}
		});

		this.addCommand({
			id: 'show-feature-intro-modal',
			name: 'Show Feature Introduction Modal (Dev)',
			callback: () => {
				const modal = new FeatureIntroModal(this.app);
				modal.open();
			}
		});

		this.addCommand({
			id: 'reset-version-for-testing',
			name: 'Reset Version (Dev - triggers modal on reload)',
			callback: async () => {
				this.settings.lastSeenVersion = '';
				await this.saveSettings();
				new Notice('Version reset! Reload the plugin to see the intro modal.');
			}
		});


		if (this.settings.fetchOnStartup && localStorageService.getAccessToken()) {
			debugLogger.info('Fetch on startup enabled, scheduling fetch in 5 seconds');
			setTimeout(() => {
				this.performAutoFetch();
			}, 5000);
		}

		this.setupAutoFetch();

		// Initialize categories in the background
		this.initializeCategories();

		// Check if this is a version update and show feature intro modal
		// TODO: Re-enable after implementing version-specific changelog display
		// this.checkVersionUpdate();
	}

	onunload() {
		this.stopAutoFetch();
	}

	reloadView() {
		this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onClose();
		this.app.workspace.getActiveViewOfType(LikedVideoListPane)?.onOpen();
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

	async activatePlaylistsView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_USER_PLAYLISTS);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_USER_PLAYLISTS, active: true });
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
		this.setupAutoFetch();
	}

	setupAutoFetch() {
		this.stopAutoFetch();

		if (this.settings.autoFetchEnabled && this.settings.autoFetchInterval > 0) {
			const debugConfig = debugLogger.getConfig();
			const intervalMinutes = debugConfig.autoFetchIntervalOverride || this.settings.autoFetchInterval;
			const intervalMs = intervalMinutes * 60 * 1000;

			// Display interval in appropriate units for debugging
			const displayInterval = intervalMinutes < 1
				? `${Math.round(intervalMinutes * 60)} seconds`
				: `${intervalMinutes} minutes`;

			debugLogger.autoFetch(`Setting up auto-fetch with interval: ${displayInterval}`);

			this.autoFetchInterval = setInterval(async () => {
				if (!this.isFetching) {
					await this.performAutoFetch();
				}
			}, intervalMs);
		}
	}

	stopAutoFetch() {
		if (this.autoFetchInterval) {
			clearInterval(this.autoFetchInterval);
			this.autoFetchInterval = null;
		}
	}

	async performAutoFetch() {
		if (this.isFetching) {
			debugLogger.autoFetch('Skipping auto-fetch - already fetching');
			return;
		}

		try {
			debugLogger.autoFetch('Starting auto-fetch');
			new Notice('Geulo: Auto-fetching started');
			this.isFetching = true;
			const now = Date.now();
			debugLogger.time('auto-fetch');

			if (this.likedVideoApi && localStorageService.getAccessToken()) {
				let allLikedVideos: YouTubeVideo[] = [];
				const shouldFetchAllVideos = this.settings.fullFetchOnEveryAutoFetch;
				const fetchInterval = this.settings.autoFetchInterval;

				if (shouldFetchAllVideos) {
					// Fetch all videos using pagination
					debugLogger.warn(
						'⚠️ Full fetch mode enabled - fetching ALL liked videos. ' +
						'This may consume significant resources.'
					);
					new Notice(UI_TEXT.FULL_FETCH_STARTED_NOTICE);

					let nextPageToken: string | undefined = undefined;
					do {
						const response: YouTubeVideosResponse | undefined = await this.likedVideoApi.fetchLikedVideos(this.settings.fullFetchLimit, nextPageToken);
						if (response && response.items.length > 0) {
							allLikedVideos = allLikedVideos.concat(response.items);
							nextPageToken = response.nextPageToken;
						} else {
							// No more videos or an error occurred
							nextPageToken = undefined;
						}
					} while (nextPageToken !== undefined);
					debugLogger.autoFetch(`Fetched all videos: ${allLikedVideos.length} total`);

					// Warn if we fetched a very large number of videos
					if (allLikedVideos.length > 2000 && fetchInterval < 120) {
						debugLogger.warn(
							`Fetched ${allLikedVideos.length} videos with full fetch. ` +
							`Consider increasing auto-fetch interval to reduce resource usage.`
						);
					}
				} else {
					// Fetch only limited number of videos
					const response: YouTubeVideosResponse | undefined = await this.likedVideoApi.fetchLikedVideos(this.settings.fetchLimit);
					if (response && response.items.length > 0) {
						allLikedVideos = response.items;
					}
					debugLogger.autoFetch(`Fetched limited videos: ${allLikedVideos.length} (limit: ${this.settings.fetchLimit})`);
				}

				const storedLikedVideos = localStorageService.getLikedVideos();
				const storedLikedVideoIdsSet = new Set(storedLikedVideos.map(video => video.id));

				const newLikedVideos = allLikedVideos.filter(video => !storedLikedVideoIdsSet.has(video.id));
				const updatedLikedVideos = [...newLikedVideos, ...storedLikedVideos]; // All fetched videos are now considered 'stored'

				if (newLikedVideos.length > 0) {
					localStorageService.setLikedVideos(updatedLikedVideos);
					new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(newLikedVideos.length));

					this.settings.lastAutoFetchTime = now;
					await this.saveData(this.settings);

					const view = this.paneRef;
					if (view) {
						this.reloadView();
					}
					this.settingTabRef?.display();

					if (this.settings.autoCreateNoteEnabled) {
						for (const video of newLikedVideos) {
							await this.automateVideoProcessing(video);
						}
					}
				} else {
					debugLogger.autoFetch('No new videos found during auto-fetch.');
				}
			}
		} catch (error) {
			debugLogger.error('Auto-fetch failed:', error);
			console.error('Auto-fetch failed:', error);
		} finally {
			debugLogger.timeEnd('auto-fetch');
			this.isFetching = false;
			debugLogger.autoFetch('Auto-fetch completed');
		}
	}

	async automateVideoProcessing(video: YouTubeVideo) {
		try {
			const baseFileName = sanitizeFileName(video.snippet.title);
			const customPath = this.settings?.videoNotePath || '';
			const organizeByChannel = this.settings?.organizeByChannel || false;
			const channelName = video.snippet.channelTitle;
			
			// Get the expected path for this video note
			const expectedPath = await getExpectedNotePath(
				this.app,
				baseFileName,
				customPath,
				organizeByChannel,
				channelName
			);

			// Check if a note already exists at the expected path
			const existingFile = this.app.vault.getAbstractFileByPath(expectedPath);

			if (!existingFile) {
				// Note doesn't exist, create it
				const templateService = new TemplateService(this.app, this.settings);

				const videoUrl = getVideoUrl(video.id);
				const noteContent = await generateVideoNoteContent(
					video,
					videoUrl,
					this.getCategoryDisplay.bind(this),
					templateService
				);

				const newNoteFile = await this.app.vault.create(expectedPath, noteContent);
				new Notice(`Created note: ${newNoteFile.basename}`);

				// Get AI Summary
				// TODO: Enable when auto-create summary flow is finalized and decided to be included
				// const summary = await this.getAISummary(video.snippet.title, video.snippet.description, video.id);

				// Append summary to the newly created note
				// if (summary) {
				// 	await this.app.vault.append(newNoteFile, `\n\n## AI Summary\n${summary}`);
				// }

				// Link to Daily Note
				if (this.settings.linkToDailyNote) {
					await linkToDailyNote(this.app, newNoteFile);
				}
			}
		} catch (error) {
			console.error('Error handling video note automation:', error);
			new Notice('Failed to create video note automatically. Check console for details.');
		}
	}

	async getAISummary(title: string, description: string): Promise<string> {
		// This is a placeholder for AI summary generation.
		// You can implement this using an AI service like OpenAI, etc.
		console.log("AI summary generation for video:", title);
		return "";
	}

	/**
	 * Initialize video categories in the background
	 */
	private async initializeCategories(): Promise<void> {
		try {
			// Load categories asynchronously without blocking plugin startup
			setTimeout(async () => {
				if (this.likedVideoApi && localStorageService.getAccessToken()) {
					debugLogger.info('Initializing video categories...');
					await categoriesService.loadCategories(this.likedVideoApi);
					debugLogger.info('Video categories initialized');
				} else {
					debugLogger.debug('Skipping categories initialization - no access token');
				}
			}, 2000); // Wait 2 seconds after plugin load
		} catch (error) {
			debugLogger.error('Failed to initialize categories:', error);
		}
	}

	/**
	 * Get category name for a video
	 */
	getCategoryName(categoryId: string): string {
		return categoriesService.getCategoryName(categoryId);
	}

	/**
	 * Get formatted category display
	 */
	getCategoryDisplay(categoryId: string): string {
		return categoriesService.getCategoryDisplay(categoryId);
	}

	/**
	 * Check if this is a version update and show feature intro modal
	 */
	private async checkVersionUpdate(): Promise<void> {
		const currentVersion = this.manifest.version;
		const lastSeenVersion = this.settings.lastSeenVersion;

		// Show modal if this is a new installation or version update
		if (!lastSeenVersion || this.isNewerVersion(currentVersion, lastSeenVersion)) {
			// Wait a bit for the plugin to fully load before showing the modal
			setTimeout(() => {
				const modal = new FeatureIntroModal(this.app);
				modal.open();
			}, 2000);

			// Update the last seen version
			this.settings.lastSeenVersion = currentVersion;
			await this.saveSettings();
		}
	}

	/**
	 * Compare version strings to determine if current is newer than last seen
	 */
	private isNewerVersion(current: string, lastSeen: string): boolean {
		if (!lastSeen) return true;

		const currentParts = current.split('.').map(Number);
		const lastSeenParts = lastSeen.split('.').map(Number);

		// Ensure arrays have the same length by padding with zeros
		const maxLength = Math.max(currentParts.length, lastSeenParts.length);
		while (currentParts.length < maxLength) currentParts.push(0);
		while (lastSeenParts.length < maxLength) lastSeenParts.push(0);

		for (let i = 0; i < maxLength; i++) {
			if (currentParts[i] > lastSeenParts[i]) {
				return true;
			} else if (currentParts[i] < lastSeenParts[i]) {
				return false;
			}
		}

		return false; // Versions are equal
	}
}