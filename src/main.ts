import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { isAIProvider, ObsidianGoogleLikedVideoSettings, YouTubeVideo } from 'src/types';
import { GoogleLikedVideoSettingTab } from 'src/views/GoogleLikedVideoSettingTab';
import { LikedVideoListPane, VIEW_TYPE_LIKED_VIDEO_LIST } from 'src/views/LikedVideoListPane';
import { UserPlaylistsPane, VIEW_TYPE_USER_PLAYLISTS } from 'src/views/UserPlaylistsPane';
import { PlaylistVideosPane, VIEW_TYPE_PLAYLIST_VIDEOS } from 'src/views/PlaylistVideosPane';
import { LikedVideoApi, PlaylistApi } from './api';
import { localStorageService } from './storage';
import { debugLogger } from './debug';
import { UI_TEXT } from './constants/uiText';
import { categoriesService } from './categoriesService';
import { FEATURE_ANNOUNCEMENT, LEGACY_ANNOUNCEMENT_ID, FeatureIntroModal } from './components/FeatureIntroModal';
import { computeExpectedNotePath, getExpectedNotePath, generateVideoNoteContent, sanitizeFileName, getVideoUrl, linkToDailyNote } from './utils/noteUtils';
import { ensureVideoNoteId, findVideoNote } from './utils/videoNoteUtils';
import { DEFAULT_TEMPLATE } from './utils/templateConstants';
import { createNotesForNewVideos, fetchAndMergeLikedVideos } from './services/likedVideoFetchService';
import { TemplateService } from './services/templateService';
import { createAIService, getActiveApiKey } from './services/aiServiceFactory';
import { SummaryStorageService } from './services/summaryStorageService';
import { LikedVideoStorageService } from './services/likedVideoStorageService';
import { googleTokenStorageService } from './services/googleTokenStorageService';
import { migrateLegacyGoogleSecrets, splitGoogleSecretsFromPluginData } from './services/googleClientSecretMigration';
import { CommentService } from './services/commentService';

const DEFAULT_SETTINGS: ObsidianGoogleLikedVideoSettings = {
	googleClientId: '',
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
	openWebViewerInSplitPane: false,
	showVideoTags: true,
	enableAISummary: false,
	geminiApiKey: '',
	aiProvider: 'gemini',
	openRouterApiKey: '',
	openRouterModel: 'google/gemini-3-flash-preview',
	summaryPrompt: 'Summarize this YouTube video. Include the main topics discussed, key takeaways, and any notable quotes or insights. Format with markdown headers and bullet points.',
}

export const APP_ID = 'geulo-youtube-liked-video';

export default class GoogleLikedVideoPlugin extends Plugin {
	settings: ObsidianGoogleLikedVideoSettings = { ...DEFAULT_SETTINGS };
	vault = this.app.vault;
	likedVideoApi!: LikedVideoApi;
	playlistApi!: PlaylistApi;
	commentService!: CommentService;
	summaryStorage!: SummaryStorageService;
	likedVideoStorage?: LikedVideoStorageService;
	autoFetchInterval: ReturnType<typeof setInterval> | null = null;
	isFetching = false;
	settingTabRef: GoogleLikedVideoSettingTab | null = null;
	private featureAnnouncementModal: FeatureIntroModal | null = null;

	async onload() {
		debugLogger.info('Plugin loading...');
		void googleTokenStorageService.initialize(this.app.secretStorage);
		await this.loadSettings();
		const manifestDir = this.manifest.dir;
		if (!manifestDir) throw new Error('Plugin directory is unavailable.');
		const likedVideoStorage = new LikedVideoStorageService(this.app.vault.adapter, manifestDir);
		try {
			await likedVideoStorage.initialize(window.localStorage);
		} catch (error) {
			new Notice('Geulo: Could not load liked-videos.json. Existing data was preserved. Check the file and reload the plugin.', 10000);
			throw error;
		}
		this.likedVideoStorage = likedVideoStorage;
		localStorageService.initializeLikedVideos(likedVideoStorage, (error) => {
			debugLogger.error('[LikedVideoStorage] Failed to save liked-videos.json:', error);
			new Notice('Geulo: Could not save the liked video list. Recent changes are only in memory. Check disk access before closing Obsidian.', 10000);
		});
		this.likedVideoApi = new LikedVideoApi(this.settings);
		this.playlistApi = new PlaylistApi(this.settings);
		this.commentService = new CommentService(this.settings);
		debugLogger.debug('API clients initialized');

		this.summaryStorage = new SummaryStorageService(this.app.vault.adapter, manifestDir, 500);
		await this.summaryStorage.initialize();

		this.registerView(
			VIEW_TYPE_LIKED_VIDEO_LIST,
			(leaf) => new LikedVideoListPane(leaf, this)
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


		this.addRibbonIcon("tv-minimal-play", "Geulo: Open YouTube Liked Videos View", () => {
			void this.activateView();
		});

		this.addRibbonIcon("list-video", "Geulo: Open YouTube Playlists View", () => {
			void this.activatePlaylistsView();
		});

		this.addCommand({
			id: 'open-liked-video-list-view',
			name: 'Open YouTube Liked Videos View',
			callback: () => {
				void this.activateView();
			}
		});

		this.addCommand({
			id: 'open-user-playlists-view',
			name: 'Open YouTube Playlists View',
			callback: () => {
				void this.activatePlaylistsView();
			}
		});

		this.addCommand({
			id: 'show-feature-intro-modal',
			name: "What's new",
			callback: () => {
				this.showFeatureAnnouncement();
			}
		});

		this.addCommand({
			id: 'full-fetch-liked-videos',
			name: 'Full Fetch Liked Videos',
			callback: () => {
				if (!googleTokenStorageService.getAccessToken()) {
					new Notice('Geulo: Please authenticate first in plugin settings.');
					return;
				}
				void this.performAutoFetch(true);
			}
		});

		if (this.settings.fetchOnStartup && googleTokenStorageService.getAccessToken()) {
			debugLogger.info('Fetch on startup enabled, scheduling fetch in 5 seconds');
			setTimeout(() => {
				void this.performAutoFetch();
			}, 5000);
		}

		this.setupAutoFetch();

		// Initialize categories in the background
		void this.initializeCategories();

		await this.checkFeatureAnnouncement();
	}

	onunload() {
		debugLogger.info('Plugin unloading...');
		const announcementModal = this.featureAnnouncementModal;
		this.featureAnnouncementModal = null;
		announcementModal?.close();
		this.stopAutoFetch();
		void this.likedVideoStorage?.close().catch((error: unknown) => {
			debugLogger.error('[LikedVideoStorage] Failed to save on unload:', error);
			new Notice('Geulo: Could not save the liked video list before unloading.', 10000);
		});

		// Cleanup API resources
		this.likedVideoApi?.cleanup();
		this.playlistApi?.cleanup();
		this.commentService?.cleanup();

		// Cleanup summary storage
		this.summaryStorage?.cleanup();

		debugLogger.info('Plugin unloaded successfully');
	}

	async reloadView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LIKED_VIDEO_LIST);

		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof LikedVideoListPane) {
				await view.onClose();
				await view.onOpen();
			}
		}
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
			void workspace.revealLeaf(leaf);
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
			void workspace.revealLeaf(leaf);
		}
	}

	async loadSettings(): Promise<void> {
		const storedData: unknown = await this.loadData();
		const splitData = splitGoogleSecretsFromPluginData(storedData);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, splitData.settingsData);
		if (!isAIProvider(this.settings.aiProvider)) {
			this.settings.aiProvider = DEFAULT_SETTINGS.aiProvider;
		}

		await migrateLegacyGoogleSecrets(splitData, {
			migrateAccessToken: (value) => googleTokenStorageService.migrateAccessToken(value),
			migrateClientSecret: (value) => googleTokenStorageService.migrateClientSecret(value),
			persistSanitizedData: () => this.saveData(this.settings),
		});
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

	async performAutoFetch(forceFullFetch = false) {
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

			if (this.likedVideoApi && googleTokenStorageService.getAccessToken()) {
				const shouldFetchAllVideos = forceFullFetch || this.settings.fullFetchOnEveryAutoFetch;
				const fetchInterval = this.settings.autoFetchInterval;

				if (shouldFetchAllVideos) {
					debugLogger.warn(
						'⚠️ Full fetch mode enabled - fetching ALL liked videos. ' +
						'This may consume significant resources.'
					);
					new Notice(UI_TEXT.FULL_FETCH_STARTED_NOTICE);
				}

				const result = await fetchAndMergeLikedVideos(this.likedVideoApi, {
					mode: shouldFetchAllVideos ? 'full' : 'partial',
					pageSize: shouldFetchAllVideos
						? this.settings.fullFetchLimit
						: this.settings.fetchLimit,
					// Auto-fetch must not remove locally stored videos.
					keepUnfetched: true,
				});
				const { mergedVideos: updatedLikedVideos, newVideos: newLikedVideos, updatedCount } = result;

				debugLogger.autoFetch(
					shouldFetchAllVideos
						? `Fetched all videos: ${result.fetchedCount} total`
						: `Fetched limited videos: ${result.fetchedCount} (limit: ${this.settings.fetchLimit})`
				);
				if (shouldFetchAllVideos && result.fetchedCount > 2000 && fetchInterval < 120) {
					debugLogger.warn(
						`Fetched ${result.fetchedCount} videos with full fetch. ` +
						'Consider increasing auto-fetch interval to reduce resource usage.'
					);
				}

				// Save when there are new videos OR when existing videos were updated
				if (newLikedVideos.length > 0 || updatedCount > 0) {
					localStorageService.setLikedVideos(updatedLikedVideos);
					if (newLikedVideos.length > 0) {
						new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(newLikedVideos.length));
					} else {
						debugLogger.autoFetch(`Updated ${updatedCount} existing video(s) with fresh data.`);
					}

					this.settings.lastAutoFetchTime = now;
					await this.saveData(this.settings);

					await this.reloadView();
					this.settingTabRef?.display();

					await createNotesForNewVideos(
						newLikedVideos,
						this.settings.autoCreateNoteEnabled,
						(video) => this.automateVideoProcessing(video)
					);
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
			const configuredPath = this.settings?.videoNotePath?.trim() || '';
			const customPath = configuredPath;
			const organizeByChannel = configuredPath.length > 0 && (this.settings?.organizeByChannel || false);
			const channelName = video.snippet.channelTitle;

			const expectedPath = computeExpectedNotePath(
				this.app,
				baseFileName,
				customPath,
				organizeByChannel,
				channelName
			);

			const legacyPaths = configuredPath
				? [expectedPath]
				: [
					expectedPath,
					computeExpectedNotePath(this.app, baseFileName, 'Youtube', organizeByChannel, channelName),
				];
			const existingFile = findVideoNote(this.app, video.id, legacyPaths);

			if (!existingFile) {
				const fullPath = await getExpectedNotePath(
					this.app,
					baseFileName,
					customPath,
					organizeByChannel,
					channelName
				);
				const templateService = new TemplateService(this.app, this.settings);

				const videoUrl = getVideoUrl(video.id);
				const noteContent = await generateVideoNoteContent(
					video,
					videoUrl,
					this.getCategoryDisplay.bind(this),
					templateService
				);

				const newNoteFile = await this.app.vault.create(fullPath, noteContent);
				await ensureVideoNoteId(this.app, newNoteFile, video.id);
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
			} else {
				await ensureVideoNoteId(this.app, existingFile, video.id);
			}
		} catch (error) {
			console.error('Error handling video note automation:', error);
			new Notice('Failed to create video note automatically. Check console for details.');
		}
	}

	async getAISummary(title: string, description: string, videoId?: string): Promise<string> {
		debugLogger.info(`[AI Summary] getAISummary called - title: "${title}", videoId: ${videoId || 'none'}`);
		debugLogger.debug(`[AI Summary] Settings check - enabled: ${this.settings.enableAISummary}, hasApiKey: ${!!getActiveApiKey(this.settings)}`);

		if (!this.settings.enableAISummary || !getActiveApiKey(this.settings)) {
			debugLogger.debug('[AI Summary] Feature disabled or no API key - skipping');
			return "";
		}

		if (videoId) {
			try {
				debugLogger.info(`[AI Summary] Generating summary via auto-create flow for video: ${videoId}`);
				const aiService = createAIService(this.settings);
				const result = await aiService.generateVideoSummary(videoId, this.settings.summaryPrompt);
				debugLogger.info(`[AI Summary] Auto-create summary generated for video: ${videoId} - caching to file`);
				await this.summaryStorage.setVideoSummary(videoId, result, {
					title,
					channelTitle: '',
					channelId: '',
					videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
				});
				debugLogger.debug(`[AI Summary] Summary cached successfully for video: ${videoId}`);

				try {
					const oneLinerPrompt = `Condense the following video summary into a single concise sentence (max 120 chars). Return ONLY the sentence.\n\n${result.summary}`;
					const oneLiner = await aiService.generateTextCompletion(oneLinerPrompt);
					const trimmed = oneLiner.trim();
					if (trimmed) {
						await this.summaryStorage.setOneLinerSummary(videoId, trimmed);
					}
				} catch (oneLinerErr) {
					debugLogger.warn(`[AI Summary] One-liner generation failed for ${videoId}:`, oneLinerErr);
				}

				return result.summary;
			} catch (error) {
				debugLogger.error(`[AI Summary] Auto-create summary generation failed for video ${videoId}:`, error);
				return "";
			}
		}

		debugLogger.debug('[AI Summary] No videoId provided - returning empty');
		return "";
	}

	/**
	 * Initialize video categories in the background
	 */
	private async initializeCategories(): Promise<void> {
		try {
			// Load categories asynchronously without blocking plugin startup
			setTimeout(async () => {
				if (this.likedVideoApi && googleTokenStorageService.getAccessToken()) {
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

	private async checkFeatureAnnouncement(): Promise<void> {
		if (this.settings.lastSeenAnnouncementId === undefined) {
			// Legacy users have already received the 3.0 announcement; new installs skip the current one.
			const hasLegacyVersion = this.settings.lastSeenVersion || localStorageService.getLastSeenVersion();
			const baselineId = hasLegacyVersion ? LEGACY_ANNOUNCEMENT_ID : FEATURE_ANNOUNCEMENT.id;
			if (!await this.saveSeenAnnouncement(baselineId)) return;
		}

		if (this.settings.lastSeenAnnouncementId === FEATURE_ANNOUNCEMENT.id) return;

		const timeout = window.setTimeout(() => {
			if (this.settings.lastSeenAnnouncementId !== FEATURE_ANNOUNCEMENT.id) {
				this.showFeatureAnnouncement();
			}
		}, 2000);
		this.register(() => window.clearTimeout(timeout));
	}

	private showFeatureAnnouncement(): void {
		if (this.featureAnnouncementModal) return;
		const announcementId = FEATURE_ANNOUNCEMENT.id;
		const modal = new FeatureIntroModal(this.app, () => {
			if (this.featureAnnouncementModal !== modal) return;
			this.featureAnnouncementModal = null;
			void this.saveSeenAnnouncement(announcementId);
		});
		this.featureAnnouncementModal = modal;
		modal.open();
	}

	private async saveSeenAnnouncement(announcementId: string): Promise<boolean> {
		if (this.settings.lastSeenAnnouncementId === announcementId) return true;
		const previousId = this.settings.lastSeenAnnouncementId;
		this.settings.lastSeenAnnouncementId = announcementId;
		try {
			await this.saveSettings();
			return true;
		} catch (error) {
			this.settings.lastSeenAnnouncementId = previousId;
			debugLogger.error('Failed to save announcement state:', error);
			new Notice('Geulo: Could not save announcement status. It may appear again next time.');
			return false;
		}
	}
}
