import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { isAIProvider, isShortVideoMaxDurationSeconds, isSummaryLineHeight, ObsidianGoogleLikedVideoSettings, OPENAI_MODEL_PRESETS, OPENROUTER_MODEL_PRESETS, TRANSCRIPT_LANGUAGE_OPTIONS, YouTubeVideo } from 'src/types';
import { GoogleLikedVideoSettingTab } from 'src/views/GoogleLikedVideoSettingTab';
import { LikedVideoListPane, VIEW_TYPE_LIKED_VIDEO_LIST } from 'src/views/LikedVideoListPane';
import { UserPlaylistsPane, VIEW_TYPE_USER_PLAYLISTS } from 'src/views/UserPlaylistsPane';
import { PlaylistVideosPane, VIEW_TYPE_PLAYLIST_VIDEOS } from 'src/views/PlaylistVideosPane';
import { SubscriptionPane, VIEW_TYPE_SUBSCRIPTIONS } from 'src/views/SubscriptionPane';
import { TranscriptPane, VIEW_TYPE_TRANSCRIPT } from 'src/views/TranscriptPane';
import type { VideoTranscript } from 'src/services/transcriptService';
import type { TranscriptReaderMode } from 'src/utils/transcriptUtils';
import { LikedVideoApi, PlaylistApi } from './api';
import { getValidAccessToken } from './auth';
import { localStorageService } from './storage';
import { debugLogger } from './debug';
import { UI_TEXT } from './constants/uiText';
import { categoriesService } from './categoriesService';
import { FEATURE_ANNOUNCEMENT, LEGACY_ANNOUNCEMENT_ID, FeatureIntroModal } from './components/FeatureIntroModal';
import { linkToDailyNote } from './utils/noteUtils';
import { DEFAULT_TEMPLATE } from './utils/templateConstants';
import { createNotesForNewVideos, fetchAndMergeLikedVideos } from './services/likedVideoFetchService';
import { createAIService, getActiveApiKey } from './services/aiServiceFactory';
import { SummaryStorageService } from './services/summaryStorageService';
import { LikedVideoStorageService } from './services/likedVideoStorageService';
import { googleTokenStorageService } from './services/googleTokenStorageService';
import { migrateLegacyGoogleSecrets, splitGoogleSecretsFromPluginData } from './services/googleClientSecretMigration';
import { CommentService } from './services/commentService';
import { SubscriptionService } from './services/subscriptionService';
import { SubscriptionStorageService } from './services/subscriptionStorageService';
import { vaultLocalStorageService } from './services/vaultLocalStorageService';
import { VideoNoteIndexService } from './services/videoNoteIndexService';
import { VideoNoteService } from './services/videoNoteService';
import { YouTubeApiClient } from './services/youtubeApiClient';
import { CacheOwnershipError, YouTubeAccountIdentity, YouTubeAccountIdentityService } from './services/youtubeAccountIdentityService';
import { chooseCacheOwnership } from './ui/CacheOwnershipModal';
import { WebViewerSummaryIntegration } from './services/webViewerSummaryIntegration';
import { PlaylistImportService } from './services/playlistImportService';

const DEFAULT_SETTINGS: ObsidianGoogleLikedVideoSettings = {
	googleClientId: '',
	dailyNotePath: '',
	videoNotePath: '',
	organizeByChannel: false,
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
	transcriptLanguage: 'auto',
	summaryLineHeight: 1.5,
	showVideoTags: true,
	shortVideoMaxDurationSeconds: 90,
	enableAISummary: false,
	geminiApiKey: '',
	aiProvider: 'openrouter',
	openRouterApiKey: '',
	openRouterModel: OPENROUTER_MODEL_PRESETS[0],
	openAIApiKey: '',
	openAIModel: OPENAI_MODEL_PRESETS[0],
	summaryPrompt: 'Summarize this YouTube video. Include the main topics discussed, key takeaways, and any notable quotes or insights. Format with markdown headers and bullet points.',
}

export const APP_ID = 'geulo-youtube-liked-video';
export type LikedVideoFetchStatus = 'idle' | 'recent' | 'full' | 'creating-notes';

export interface CacheSyncOwnership {
	ownerChannelId: string;
	replaceExisting: boolean;
}

interface CacheOwnershipContext {
	cacheLabel: string;
	ownerChannelId: string | null;
	hasData: boolean;
	assignOwner: (ownerChannelId: string) => Promise<void>;
}

export default class GoogleLikedVideoPlugin extends Plugin {
	settings: ObsidianGoogleLikedVideoSettings = { ...DEFAULT_SETTINGS };
	vault = this.app.vault;
	likedVideoApi!: LikedVideoApi;
	playlistApi!: PlaylistApi;
	playlistImports!: PlaylistImportService;
	commentService!: CommentService;
	subscriptionService!: SubscriptionService;
	summaryStorage!: SummaryStorageService;
	videoNoteIndex!: VideoNoteIndexService;
	videoNotes!: VideoNoteService;
	accountIdentityService!: YouTubeAccountIdentityService;
	likedVideoStorage?: LikedVideoStorageService;
	autoFetchInterval: number | null = null;
	isFetching = false;
	private fetchStatus: LikedVideoFetchStatus = 'idle';
	private fetchStatusListeners = new Set<(status: LikedVideoFetchStatus) => void>();
	private settingsListeners = new Set<() => void>();
	private ownershipWarnings = new Set<string>();
	settingTabRef: GoogleLikedVideoSettingTab | null = null;
	private featureAnnouncementModal: FeatureIntroModal | null = null;

	async onload() {
		vaultLocalStorageService.initialize(this.app);
		debugLogger.initialize();
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
		const youtubeApiClient = new YouTubeApiClient(
			() => getValidAccessToken(this.settings.googleClientId),
		);
		this.accountIdentityService = new YouTubeAccountIdentityService(youtubeApiClient);
		this.likedVideoApi = new LikedVideoApi(
			youtubeApiClient,
			() => this.requireLikedVideoCacheOwnership(),
		);
		this.playlistApi = new PlaylistApi(youtubeApiClient);
		this.playlistImports = this.addChild(new PlaylistImportService(this.playlistApi, () => {
			const pane = this.app.workspace.getLeavesOfType(VIEW_TYPE_USER_PLAYLISTS)
				.map(leaf => leaf.view).find((view): view is UserPlaylistsPane =>
					view instanceof UserPlaylistsPane && view.hasLoaded);
			return pane?.playlists ?? null;
		}));
		this.commentService = new CommentService(youtubeApiClient, this.accountIdentityService);
		const subscriptionStorage = new SubscriptionStorageService(this.app.vault.adapter, manifestDir);
		this.subscriptionService = new SubscriptionService(youtubeApiClient, subscriptionStorage);
		try {
			await this.subscriptionService.initialize();
		} catch (error) {
			debugLogger.error('[SubscriptionStorage] Failed to load subscriptions.json:', error);
			new Notice('Geulo: Could not load subscriptions.json. The saved file was preserved; use Load subscriptions to replace it.', 10000);
		}
		debugLogger.debug('API clients initialized');

		this.summaryStorage = new SummaryStorageService(this.app.vault.adapter, manifestDir, 500);
		await this.summaryStorage.initialize();
		this.videoNoteIndex = new VideoNoteIndexService(this.app);
		this.videoNotes = new VideoNoteService(this);

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

		this.registerView(
			VIEW_TYPE_SUBSCRIPTIONS,
			(leaf) => new SubscriptionPane(leaf, this),
		);
		this.registerView(VIEW_TYPE_TRANSCRIPT, (leaf) => new TranscriptPane(leaf, this));
		this.addChild(new WebViewerSummaryIntegration(this, youtubeApiClient));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.settingTabRef = new GoogleLikedVideoSettingTab(this.app, this);
		this.addSettingTab(this.settingTabRef);


		this.addRibbonIcon("thumbs-up", "Geulo: Open YouTube Liked Videos View", () => {
			void this.activateView();
		});

		this.addRibbonIcon("list-video", "Geulo: Open YouTube Playlists View", () => {
			void this.activatePlaylistsView();
		});

		this.addRibbonIcon("rss", "Geulo: Open YouTube Subscriptions View", () => {
			void this.activateSubscriptionsView();
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
			id: 'open-subscriptions-view',
			name: 'Open YouTube Subscriptions View',
			callback: () => {
				void this.activateSubscriptionsView();
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
			window.setTimeout(() => {
				void this.performAutoFetch(false, true, false);
			}, 5000);
		}

		this.setupAutoFetch();

		// Initialize categories in the background
		void this.initializeCategories();

		await this.checkFeatureAnnouncement();
	}

	async openTranscriptPane(video: YouTubeVideo, transcript?: VideoTranscript, displayMode: TranscriptReaderMode = 'paragraphs'): Promise<void> {
		const leaf = this.app.workspace.getLeaf('split');
		await leaf.setViewState({ type: VIEW_TYPE_TRANSCRIPT, state: { video, transcript, displayMode }, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	onunload() {
		debugLogger.info('Plugin unloading...');
		const announcementModal = this.featureAnnouncementModal;
		this.featureAnnouncementModal = null;
		announcementModal?.close();
		this.stopAutoFetch();
		this.videoNotes?.destroy();
		this.videoNoteIndex?.destroy();
		this.fetchStatusListeners.clear();
		void this.likedVideoStorage?.close().catch((error: unknown) => {
			debugLogger.error('[LikedVideoStorage] Failed to save on unload:', error);
			new Notice('Geulo: Could not save the liked video list before unloading.', 10000);
		});

		// Cleanup API resources
		this.likedVideoApi?.cleanup();
		this.playlistApi?.cleanup();
		this.commentService?.cleanup();
		this.subscriptionService?.clear();

		// Cleanup summary storage
		this.summaryStorage?.cleanup();

		debugLogger.info('Plugin unloaded successfully');
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
			await workspace.revealLeaf(leaf);
			if (leaf.view instanceof LikedVideoListPane) leaf.view.focusList();
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

	async activateSubscriptionsView(): Promise<void> {
		const { workspace } = this.app;
		const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_SUBSCRIPTIONS)[0];
		const leaf = existingLeaf ?? workspace.getRightLeaf(false);
		if (!existingLeaf) {
			await leaf?.setViewState({ type: VIEW_TYPE_SUBSCRIPTIONS, active: true });
		}
		if (leaf) void workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const storedData: unknown = await this.loadData();
		const splitData = splitGoogleSecretsFromPluginData(storedData);
		const settingsData = { ...splitData.settingsData };
		const hasDeprecatedFetchLimits = Object.prototype.hasOwnProperty.call(settingsData, 'fetchLimit')
			|| Object.prototype.hasOwnProperty.call(settingsData, 'fullFetchLimit');
		delete settingsData.fetchLimit;
		delete settingsData.fullFetchLimit;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
		if (!isAIProvider(this.settings.aiProvider)) {
			this.settings.aiProvider = DEFAULT_SETTINGS.aiProvider;
		}
		if (!isShortVideoMaxDurationSeconds(this.settings.shortVideoMaxDurationSeconds)) {
			this.settings.shortVideoMaxDurationSeconds = DEFAULT_SETTINGS.shortVideoMaxDurationSeconds;
		}
		if (!isSummaryLineHeight(this.settings.summaryLineHeight)) {
			this.settings.summaryLineHeight = DEFAULT_SETTINGS.summaryLineHeight;
		}
		if (typeof this.settings.transcriptLanguage !== 'string'
			|| !Object.prototype.hasOwnProperty.call(TRANSCRIPT_LANGUAGE_OPTIONS, this.settings.transcriptLanguage)) {
			this.settings.transcriptLanguage = DEFAULT_SETTINGS.transcriptLanguage;
		}

		await migrateLegacyGoogleSecrets(splitData, {
			migrateAccessToken: (value) => googleTokenStorageService.migrateAccessToken(value),
			migrateClientSecret: (value) => googleTokenStorageService.migrateClientSecret(value),
			persistSanitizedData: () => this.saveData(this.settings),
		});
		if (hasDeprecatedFetchLimits) {
			await this.saveData(this.settings);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.settingsListeners.forEach(listener => listener());
		this.setupAutoFetch();
	}

	subscribeSettings(listener: () => void): () => void {
		this.settingsListeners.add(listener);
		return () => { this.settingsListeners.delete(listener); };
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

			this.autoFetchInterval = window.setInterval(() => {
				if (!this.isFetching) {
					void this.performAutoFetch(false, true, false);
				}
			}, intervalMs);
		}
	}

	stopAutoFetch() {
		if (this.autoFetchInterval) {
			window.clearInterval(this.autoFetchInterval);
			this.autoFetchInterval = null;
		}
	}

	getFetchStatus(): LikedVideoFetchStatus {
		return this.fetchStatus;
	}

	subscribeFetchStatus(listener: (status: LikedVideoFetchStatus) => void): () => void {
		this.fetchStatusListeners.add(listener);
		return () => this.fetchStatusListeners.delete(listener);
	}

	private setFetchStatus(status: LikedVideoFetchStatus): void {
		this.fetchStatus = status;
		this.isFetching = status !== 'idle';
		this.fetchStatusListeners.forEach((listener) => listener(status));
	}

	resetGoogleAccountIdentity(): void {
		this.accountIdentityService.reset();
		this.videoNotes?.resetLikedState();
		this.ownershipWarnings.clear();
	}

	async prepareSubscriptionSync(): Promise<CacheSyncOwnership | null> {
		const snapshot = this.subscriptionService.getSnapshot();
		return this.prepareCacheSyncOwnership({
			cacheLabel: 'subscriptions',
			ownerChannelId: this.subscriptionService.getOwnerChannelId(),
			hasData: snapshot !== null && (
				snapshot.channels.length > 0
				|| snapshot.videos.length > 0
				|| snapshot.failedChannels.length > 0
			),
			assignOwner: (ownerChannelId) => this.subscriptionService.setOwnerChannelId(ownerChannelId),
		}, true);
	}

	async requireSubscriptionCacheOwnership(): Promise<void> {
		const snapshot = this.subscriptionService.getSnapshot();
		await this.requireCacheOwnership({
			cacheLabel: 'subscriptions',
			ownerChannelId: this.subscriptionService.getOwnerChannelId(),
			hasData: snapshot !== null && (
				snapshot.channels.length > 0
				|| snapshot.videos.length > 0
				|| snapshot.failedChannels.length > 0
			),
			assignOwner: (ownerChannelId) => this.subscriptionService.setOwnerChannelId(ownerChannelId),
		});
	}

	private prepareLikedVideoSync(interactive: boolean): Promise<CacheSyncOwnership | null> {
		return this.prepareCacheSyncOwnership({
			cacheLabel: 'liked videos',
			ownerChannelId: localStorageService.getLikedVideoOwnerChannelId(),
			hasData: localStorageService.getLikedVideos().length > 0,
			assignOwner: (ownerChannelId) => localStorageService.setLikedVideoOwnerChannelId(ownerChannelId),
		}, interactive);
	}

	private async requireLikedVideoCacheOwnership(): Promise<void> {
		await this.requireCacheOwnership({
			cacheLabel: 'liked videos',
			ownerChannelId: localStorageService.getLikedVideoOwnerChannelId(),
			hasData: localStorageService.getLikedVideos().length > 0,
			assignOwner: (ownerChannelId) => localStorageService.setLikedVideoOwnerChannelId(ownerChannelId),
		});
	}

	private async prepareCacheSyncOwnership(
		context: CacheOwnershipContext,
		interactive: boolean,
	): Promise<CacheSyncOwnership | null> {
		let identity: YouTubeAccountIdentity;
		try {
			identity = await this.accountIdentityService.getCurrentIdentity();
		} catch (error) {
			debugLogger.error(`[Cache ownership] Could not identify the account for ${context.cacheLabel}:`, error);
			new Notice(`Geulo: Could not verify which Google account owns the ${context.cacheLabel}. ${error instanceof Error ? error.message : 'Please reconnect and try again.'}`, 10000);
			return null;
		}

		if (context.ownerChannelId === identity.channelId) {
			this.clearOwnershipWarnings(context.cacheLabel);
			return { ownerChannelId: identity.channelId, replaceExisting: false };
		}
		if (context.ownerChannelId === null && !context.hasData) {
			try {
				await context.assignOwner(identity.channelId);
				this.clearOwnershipWarnings(context.cacheLabel);
				return { ownerChannelId: identity.channelId, replaceExisting: false };
			} catch (error) {
				debugLogger.error(`[Cache ownership] Could not save the owner for ${context.cacheLabel}:`, error);
				new Notice(`Geulo: Could not save the Google account for the ${context.cacheLabel}. Existing data was preserved.`, 10000);
				return null;
			}
		}
		if (!interactive) {
			this.warnAboutUnresolvedOwnership(context, identity);
			return null;
		}

		const choice = await chooseCacheOwnership(this.app, {
			cacheLabel: context.cacheLabel,
			currentChannelId: identity.channelId,
			currentChannelTitle: identity.channelTitle,
			storedOwnerChannelId: context.ownerChannelId,
			allowAssociate: context.ownerChannelId === null,
			allowReplace: true,
		});
		if (choice === 'cancel') return null;
		if (choice === 'replace') {
			return { ownerChannelId: identity.channelId, replaceExisting: true };
		}

		try {
			await context.assignOwner(identity.channelId);
			this.clearOwnershipWarnings(context.cacheLabel);
			return { ownerChannelId: identity.channelId, replaceExisting: false };
		} catch (error) {
			debugLogger.error(`[Cache ownership] Could not associate ${context.cacheLabel}:`, error);
			new Notice(`Geulo: Could not link the existing ${context.cacheLabel} to this Google account. Existing data was preserved.`, 10000);
			return null;
		}
	}

	private async requireCacheOwnership(context: CacheOwnershipContext): Promise<void> {
		let identity: YouTubeAccountIdentity;
		try {
			identity = await this.accountIdentityService.getCurrentIdentity();
		} catch (error) {
			throw new CacheOwnershipError(
				`Could not verify which Google account owns the ${context.cacheLabel}. ${error instanceof Error ? error.message : 'Please reconnect and try again.'}`,
			);
		}

		if (context.ownerChannelId === identity.channelId) return;
		if (context.ownerChannelId === null && !context.hasData) {
			try {
				await context.assignOwner(identity.channelId);
			} catch (error) {
				debugLogger.error(`[Cache ownership] Could not save the owner for ${context.cacheLabel}:`, error);
				throw new CacheOwnershipError(
					`Could not save the Google account for the ${context.cacheLabel}. No YouTube change was made.`,
				);
			}
			return;
		}
		if (context.ownerChannelId !== null) {
			throw new CacheOwnershipError(
				`The connected YouTube account does not own the saved ${context.cacheLabel}. Load the ${context.cacheLabel} and confirm replacement before changing them.`,
			);
		}

		const choice = await chooseCacheOwnership(this.app, {
			cacheLabel: context.cacheLabel,
			currentChannelId: identity.channelId,
			currentChannelTitle: identity.channelTitle,
			storedOwnerChannelId: null,
			allowAssociate: true,
			allowReplace: false,
		});
		if (choice !== 'associate') {
			throw new CacheOwnershipError(`The ${context.cacheLabel} were not changed because their Google account is not confirmed.`);
		}
		try {
			await context.assignOwner(identity.channelId);
		} catch (error) {
			debugLogger.error(`[Cache ownership] Could not associate ${context.cacheLabel}:`, error);
			throw new CacheOwnershipError(
				`Could not link the existing ${context.cacheLabel} to this Google account. No YouTube change was made.`,
			);
		}
	}

	private warnAboutUnresolvedOwnership(
		context: CacheOwnershipContext,
		identity: YouTubeAccountIdentity,
	): void {
		const key = `${context.cacheLabel}:${context.ownerChannelId ?? 'unowned'}:${identity.channelId}`;
		if (this.ownershipWarnings.has(key)) return;
		this.ownershipWarnings.add(key);
		new Notice(
			`Geulo: Automatic ${context.cacheLabel} sync was skipped because the saved data belongs to an unconfirmed or different Google account. Run it manually to review the change.`,
			10000,
		);
	}

	private clearOwnershipWarnings(cacheLabel: string): void {
		for (const warning of this.ownershipWarnings) {
			if (warning.startsWith(`${cacheLabel}:`)) this.ownershipWarnings.delete(warning);
		}
	}

	async performAutoFetch(
		forceFullFetch = false,
		useConfiguredMode = true,
		interactiveOwnership = true,
	): Promise<void> {
		if (this.isFetching) {
			debugLogger.autoFetch('Skipping auto-fetch - already fetching');
			return;
		}
		if (!this.likedVideoApi || !googleTokenStorageService.getAccessToken()) {
			new Notice('Geulo: Connect your Google account before fetching liked videos.');
			return;
		}

		const ownership = await this.prepareLikedVideoSync(interactiveOwnership);
		if (!ownership) return;
		const shouldFetchAllVideos = ownership.replaceExisting || forceFullFetch ||
			(useConfiguredMode && this.settings.fullFetchOnEveryAutoFetch);
		try {
			debugLogger.autoFetch('Starting auto-fetch');
			new Notice(shouldFetchAllVideos
				? 'Geulo: Full liked-video sync started'
				: 'Geulo: Checking the 50 most recent liked videos');
			this.setFetchStatus(shouldFetchAllVideos ? 'full' : 'recent');
			const now = Date.now();
			debugLogger.time('auto-fetch');

			if (this.likedVideoApi && googleTokenStorageService.getAccessToken()) {
				const fetchInterval = this.settings.autoFetchInterval;

				if (shouldFetchAllVideos) {
					debugLogger.warn(
						'⚠️ Full fetch mode enabled - fetching ALL liked videos. ' +
						'This may consume significant resources.'
					);
					new Notice(UI_TEXT.FULL_FETCH_STARTED_NOTICE);
				}

				const likedCheckpoint = this.videoNotes.getLikedStateCheckpoint();
				const result = await fetchAndMergeLikedVideos(this.likedVideoApi, {
					mode: shouldFetchAllVideos ? 'full' : 'partial',
					keepUnfetched: !shouldFetchAllVideos,
					allowEmptyFullReplacement: ownership.replaceExisting,
				});
				if (!this.videoNotes.isLikedStateCurrent(likedCheckpoint)) return;
				const { mergedVideos: updatedLikedVideos, newVideos: newLikedVideos, updatedCount } = result;

				debugLogger.autoFetch(
					shouldFetchAllVideos
						? `Fetched all videos: ${result.fetchedCount} total`
						: `Fetched recent videos: ${result.fetchedCount} (limit: 50)`
				);
				if (shouldFetchAllVideos && result.fetchedCount > 2000 && fetchInterval < 120) {
					debugLogger.warn(
						`Fetched ${result.fetchedCount} videos with full fetch. ` +
						'Consider increasing auto-fetch interval to reduce resource usage.'
					);
				}

				if (shouldFetchAllVideos || newLikedVideos.length > 0 || updatedCount > 0) {
					await localStorageService.setLikedVideosForOwner(
						updatedLikedVideos,
						ownership.ownerChannelId,
					);
					await this.videoNotes.syncLikedVideos(result.fetchedVideoIds, shouldFetchAllVideos, likedCheckpoint);
					if (!this.videoNotes.isLikedStateCurrent(likedCheckpoint)) return;
					if (shouldFetchAllVideos) {
						new Notice(UI_TEXT.NOTICE_ALL_VIDEOS_SAVED(updatedLikedVideos.length));
					} else if (newLikedVideos.length > 0) {
						new Notice(UI_TEXT.NOTICE_NEW_VIDEOS_FETCHED(newLikedVideos.length));
					} else {
						debugLogger.autoFetch(`Updated ${updatedCount} existing video(s) with fresh data.`);
					}

					if (newLikedVideos.length > 0 && this.settings.autoCreateNoteEnabled) {
						this.setFetchStatus('creating-notes');
					}
					await createNotesForNewVideos(
						newLikedVideos,
						this.settings.autoCreateNoteEnabled,
						async (video) => {
							if (this.videoNotes.isLikedStateCurrent(likedCheckpoint)) await this.automateVideoProcessing(video);
						}
					);
				} else {
					await this.videoNotes.syncLikedVideos(result.fetchedVideoIds, false, likedCheckpoint);
					debugLogger.autoFetch('No new videos found during auto-fetch.');
				}
				this.settings.lastAutoFetchTime = now;
				await this.saveData(this.settings);
				this.settingTabRef?.update();
			}
		} catch (error) {
			debugLogger.error('Auto-fetch failed:', error);
			console.error('Auto-fetch failed:', error);
			new Notice(`Geulo: Could not fetch liked videos. ${error instanceof Error ? error.message : 'Please try again.'}`);
		} finally {
			debugLogger.timeEnd('auto-fetch');
			this.setFetchStatus('idle');
			debugLogger.autoFetch('Auto-fetch completed');
		}
	}

	async automateVideoProcessing(video: YouTubeVideo): Promise<void> {
		try {
			const { file, created } = await this.videoNotes.getOrCreate(video, undefined, { reuseConfirmedRating: true });
			if (created) {
				new Notice(`Created note: ${file.basename}`);
				if (this.settings.linkToDailyNote) await linkToDailyNote(this.app, file);
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
	private initializeCategories(): void {
		window.setTimeout(() => {
			if (this.likedVideoApi && googleTokenStorageService.getAccessToken()) {
				debugLogger.info('Initializing video categories...');
				void categoriesService.loadCategories(this.likedVideoApi)
					.then(() => debugLogger.info('Video categories initialized'))
					.catch((error: unknown) => {
						debugLogger.error('Failed to initialize categories:', error);
					});
			} else {
				debugLogger.debug('Skipping categories initialization - no access token');
			}
		}, 2000); // Wait 2 seconds after plugin load
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
