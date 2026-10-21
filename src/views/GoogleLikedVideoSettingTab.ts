import { AbstractInputSuggest, App, getLanguage, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { getFormatLocale, t } from '../i18n';
import { localStorageService } from 'src/storage';
import { googleTokenStorageService } from 'src/services/googleTokenStorageService';
import { handleGoogleLogin, handleGoogleLogout, refreshAccessToken } from 'src/auth';
import { checkGoogleConnectionHealth } from 'src/services/googleConnectionHealthService';
import type { GoogleConnectionHealthReport, GoogleConnectionHealthStepStatus } from 'src/services/googleConnectionHealthService';
import { checkTranscriptHealth } from 'src/services/transcriptHealthCheckService';
import type { TranscriptHealthCheckReport } from 'src/services/transcriptHealthCheckService';
import { transcriptService } from 'src/services/transcriptService';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, DEFAULT_SUBSCRIPTION_VIDEO_MAX_AGE_DAYS, isAIProvider, isOpenAIModelPreset, isOpenRouterModelPreset, isShortVideoMaxDurationSeconds, isSubscriptionVideoMaxAgeDays, isSummaryLineHeight, ObsidianGoogleLikedVideoSettings, OPENAI_MODEL_PRESETS, OPENROUTER_MODEL_PRESETS, SHORT_VIDEO_MAX_DURATION_OPTIONS, SUBSCRIPTION_VIDEO_MAX_AGE_OPTIONS, SUMMARY_LINE_HEIGHT_OPTIONS, TRANSCRIPT_LANGUAGE_OPTIONS } from 'src/types';
import GoogleLikedVideoPlugin from '../main';
import { debugLogger, DebugConfig } from 'src/debug';
import { confirmAction } from '../ui/ConfirmationModal';
import { DEFAULT_TEMPLATE, TEMPLATE_VARIABLES_REFERENCE } from '../utils/templateConstants';
import { PlaylistVideosPane } from './PlaylistVideosPane';
import { SubscriptionPane, VIEW_TYPE_SUBSCRIPTIONS } from './SubscriptionPane';
import { addWideTextSetting, createCollapsibleReference, createMonospaceTextarea } from '../utils/settingUiUtils';
import { SPEECH_MODEL_PRESETS } from '../types';
import { GoogleCredentialsImportModal } from '../ui/GoogleCredentialsImportModal';
import type { GoogleClientCredentials } from '../utils/googleCredentialsUtils';

const CUSTOM_OPENROUTER_MODEL_OPTION = 'custom';
const CUSTOM_OPENAI_MODEL_OPTION = 'custom';

type HealthCheckCardStatus = 'running' | 'healthy' | 'unhealthy' | 'inconclusive';

interface HealthCheckCardStep {
	label: string;
	status: GoogleConnectionHealthStepStatus;
	detail: string;
}

interface HealthCheckCardOptions {
	status: HealthCheckCardStatus;
	title: string;
	summary: string;
	steps?: readonly HealthCheckCardStep[];
	checkedAt?: Date;
}

class VaultFolderSuggest extends AbstractInputSuggest<string> {
	private readonly inputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	protected getSuggestions(query: string): string[] {
		const normalizedQuery = query.trim().toLocaleLowerCase();
		return this.app.vault
			.getAllFolders(false)
			.map(folder => folder.path)
			.filter(path => path.toLocaleLowerCase().includes(normalizedQuery))
			.sort((left, right) => left.localeCompare(right));
	}

	renderSuggestion(folderPath: string, el: HTMLElement): void {
		el.setText(folderPath);
	}

	selectSuggestion(folderPath: string): void {
		this.setValue(folderPath);
		this.inputEl.trigger('input');
		this.close();
	}
}

export class GoogleLikedVideoSettingTab extends PluginSettingTab {
    plugin: GoogleLikedVideoPlugin;
	private googleHealthCheckRunning = false;
	private googleHealthCheckReport: GoogleConnectionHealthReport | null = null;
	private googleHealthCheckRunId = 0;
	private transcriptHealthCheckRunning = false;
	private transcriptHealthCheckReport: TranscriptHealthCheckReport | null = null;
	private transcriptHealthCheckRunId = 0;

    constructor(app: App, plugin: GoogleLikedVideoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    openVideoDisplaySettings(): boolean {
		return this.openSettingsSection('video-display');
	}

	openSpeechSettings(): boolean {
		return this.openSettingsSection('speech');
	}

	private openSettingsSection(section: 'video-display' | 'speech'): boolean {
        const setting = Reflect.get(this.app, 'setting');
        if (
            typeof setting !== 'object' ||
            setting === null ||
            !('open' in setting) ||
            typeof setting.open !== 'function' ||
            !('openTabById' in setting) ||
            typeof setting.openTabById !== 'function'
        ) {
            return false;
        }

        setting.open();
        setting.openTabById(this.plugin.manifest.id);

        const ownerWindow = this.containerEl.ownerDocument.defaultView;
        ownerWindow?.requestAnimationFrame(() => {
            ownerWindow.requestAnimationFrame(() => {
                this.containerEl
                    .querySelector<HTMLElement>(`[data-geulo-settings-section="${section}"]`)
                    ?.scrollIntoView({ behavior: 'auto', block: 'start' });
            });
        });

        return true;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const refreshToken = googleTokenStorageService.getRefreshToken();
        const isLoggedIn = refreshToken !== null && refreshToken !== '';
        const definitions: SettingDefinitionItem[] = [
            this.createSectionDefinition(
                'Google connection',
                ['Google account', 'Connect with Google', 'Client ID', 'Client secret', 'YouTube Data API', 'Import credentials', 'JSON'],
                (containerEl) => this.renderSetupSection(containerEl, refreshToken),
            ),
			this.createSectionDefinition(
				'Health checks',
				['Health check', 'Connection health', 'Transcript access'],
				(containerEl) => this.renderHealthChecksSection(containerEl),
			),
			this.createSectionDefinition(
				'Sync',
				['Stored videos', 'Subscription video age limit', '30 days', '60 days', '90 days', '120 days', 'Automatic fetch', 'Fetch interval', 'Full scan', 'Fetch recent videos', 'Fetch on startup'],
				(containerEl) => this.renderSyncSection(containerEl, isLoggedIn),
            ),
            this.createSectionDefinition(
                'Video display',
                ['Liked video view mode', 'Open videos in Obsidian Web Viewer', 'Open in', 'Show video tags', 'Maximum Short-form duration', 'Transcript language', 'Captions', 'AI summary line spacing', 'Line height'],
                (containerEl) => this.renderVideoDisplaySection(containerEl),
            ),
        ];

        if (isLoggedIn) {
            definitions.push(
                this.createSectionDefinition(
                    'Video notes',
                    ['Video note location', 'Organize by channel', 'Automatically create notes', 'Link to daily note'],
                    (containerEl) => this.renderVideoNotesSection(containerEl),
                ),
                this.createSectionDefinition(
                    'Template system',
                    ['Enable custom templates', 'Custom template'],
                    (containerEl) => this.renderTemplateSection(containerEl),
                ),
                this.createSectionDefinition(
                    'AI features',
                    ['Enable AI Summary', 'Include AI Summary heading', 'Save summaries as block quotes', 'AI Provider', 'Gemini API Key', 'OpenRouter API Key', 'OpenAI API Key', 'Model ID', 'Summary Prompt'],
                    (containerEl) => this.renderAISection(containerEl),
                ),
            );
        }

        definitions.push(
            this.createSectionDefinition(
                'Speech',
                ['Text to speech', 'Read aloud', 'Speech provider', 'Speech API key', 'Speech model', 'Voice'],
                (containerEl) => this.renderSpeechSection(containerEl),
            ),
            this.createSectionDefinition(
                'Data management',
                ['Liked videos file size', 'Subscriptions file size', 'Summaries file size', 'Clear saved liked videos'],
                (containerEl) => this.renderDataManagementSection(containerEl),
            ),
        );

        if (debugLogger.getConfig().enabled) {
            definitions.push(
                this.createSectionDefinition(
                    'Debug settings',
                    ['Log level', 'Log API calls', 'Log state changes', 'Log auto-fetch', 'Auto-fetch interval override', 'Force fetch now'],
                    (containerEl) => this.renderDebugSection(containerEl),
                ),
            );
        }

        return definitions;
    }

    private createSectionDefinition(
        name: string,
        aliases: readonly string[],
        renderSection: (containerEl: HTMLElement) => void,
    ): SettingDefinitionItem {
        return {
            name,
            aliases: [...aliases],
            render: (setting) => {
                setting.settingEl.empty();
                setting.settingEl.addClass('geulo-settings-section');
                renderSection(setting.settingEl);
            },
        };
    }

    async updateListPaneView(): Promise<void> {
        localStorageService.setLikedVideos(localStorageService.getLikedVideos());
    }

    updatePlaylistVideosPaneView(): void {
        void this.app.workspace.getActiveViewOfType(PlaylistVideosPane)?.onClose();
        void this.app.workspace.getActiveViewOfType(PlaylistVideosPane)?.onOpen();
    }

    async updateSubscriptionPaneView(): Promise<void> {
        const subscriptionViews = this.app.workspace
            .getLeavesOfType(VIEW_TYPE_SUBSCRIPTIONS)
            .map(leaf => leaf.view)
            .filter((view): view is SubscriptionPane => view instanceof SubscriptionPane);

        await Promise.all(subscriptionViews.map(async view => {
            await view.onClose();
            await view.onOpen();
        }));
    }

    private renderVideoDisplaySection(containerEl: HTMLElement): void {
        containerEl.dataset.geuloSettingsSection = 'video-display';
        new Setting(containerEl).setHeading().setName(t('settings.videoDisplay'));
        this.renderLikedVideoViewModeSetting(containerEl);
        this.renderOpenInWebViewerSetting(containerEl);
        this.renderTranscriptLanguageSetting(containerEl);
        this.renderSummaryLineHeightSetting(containerEl);
        this.renderShortVideoDurationSetting(containerEl);
        this.renderVideoTagsSetting(containerEl);
    }

    private async saveSetting<K extends keyof ObsidianGoogleLikedVideoSettings>(
        key: K,
        value: ObsidianGoogleLikedVideoSettings[K],
        refresh: { display?: boolean; listPane?: boolean; playlistPane?: boolean; subscriptionPane?: boolean } = {}
    ): Promise<void> {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettings();
        if (refresh.display) {
            this.update();
        }
        if (refresh.listPane) {
            await this.updateListPaneView();
        }
        if (refresh.playlistPane) {
            this.updatePlaylistVideosPaneView();
        }
        if (refresh.subscriptionPane) {
            await this.updateSubscriptionPaneView();
        }
    }

    private renderSyncSection(containerEl: HTMLElement, isLoggedIn: boolean): void {
		new Setting(containerEl).setHeading().setName(t('settings.sync'));
		this.renderStoredVideos(containerEl);
		this.renderSubscriptionVideoMaxAgeSetting(containerEl);
		if (isLoggedIn) {
            this.renderAutoFetchSection(containerEl);
        }
        this.renderManualFetchSettings(containerEl, isLoggedIn);
    }

	private renderStoredVideos(containerEl: HTMLElement): void {
        const likedVideosCount = localStorageService.getLikedVideos().length;

        const storedVideosSetting = new Setting(containerEl)
            .setName(t('settings.storedVideos'))
            .setDesc(t('settings.storedVideosHelp'));
        storedVideosSetting.controlEl.createSpan({
            cls: 'geulo-stored-video-count',
            text: likedVideosCount.toLocaleString(getFormatLocale()),
        });
    }

    private renderOpenInWebViewerSetting(containerEl: HTMLElement): void {
        const viewerEl = containerEl.createDiv();
        new Setting(viewerEl)
            .setName(t('settings.openWebViewer'))
            .setDesc(t('settings.openWebViewerHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openInObsidianWebViewer)
                .onChange(async (value) => {
                    openInSetting.settingEl.hidden = !value;
                    await this.saveSetting('openInObsidianWebViewer', value);
                }));

        const openInSetting = new Setting(viewerEl)
            .setName(t('settings.openIn'))
            .setClass('geulo-web-viewer-option')
            .addDropdown(dropdown => dropdown
                .addOption('tab', t('settings.newTab'))
                .addOption('split', t('settings.splitPane'))
                .setValue(this.plugin.settings.openWebViewerInSplitPane ? 'split' : 'tab')
                .onChange(async (value) => {
                    await this.saveSetting('openWebViewerInSplitPane', value === 'split');
                }));
        openInSetting.settingEl.hidden = !this.plugin.settings.openInObsidianWebViewer;

		new Setting(viewerEl)
			.setName(t('settings.webViewerSidebar'))
			.setDesc(t('settings.webViewerSidebarHelp'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.openWebViewerReaderInRightSidebar)
				.onChange(async (value) => {
					await this.saveSetting('openWebViewerReaderInRightSidebar', value);
				}));
    }

    private renderLikedVideoViewModeSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.likedViewMode'))
            .setDesc(t('settings.likedViewModeHelp'))
            .addDropdown(dropdown => dropdown
                .addOption('pagination', t('settings.pagination'))
                .addOption('infinite', t('settings.infiniteScroll'))
                .setValue(localStorageService.getLikedVideoPaginationMode())
                .onChange(async (value) => {
                    const paginationMode = value === 'infinite' ? 'infinite' : 'pagination';
                    localStorageService.setLikedVideoPaginationMode(paginationMode);
                    await this.updateListPaneView();
                }));
    }

    private renderTranscriptLanguageSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.transcriptLanguage'))
            .setDesc(t('settings.transcriptLanguageHelp'))
            .addDropdown(dropdown => dropdown
                .addOptions(TRANSCRIPT_LANGUAGE_OPTIONS)
                .setValue(this.plugin.settings.transcriptLanguage)
                .onChange(async value => {
                    await this.saveSetting('transcriptLanguage', value);
                }));
    }

	private renderSummaryLineHeightSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.summaryLineSpacing'))
			.setDesc(t('settings.summaryLineSpacingHelp'))
			.addDropdown(dropdown => {
				SUMMARY_LINE_HEIGHT_OPTIONS.forEach(lineHeight => {
					dropdown.addOption(String(lineHeight), `${lineHeight.toFixed(1)}${lineHeight === 1.5 ? ` (${t('settings.default')})` : ''}`);
				});
				dropdown
					.setValue(String(this.plugin.settings.summaryLineHeight))
					.onChange(async value => {
						const lineHeight = Number(value);
						if (!isSummaryLineHeight(lineHeight)) return;
						await this.saveSetting('summaryLineHeight', lineHeight);
					});
			});
	}

    private renderVideoTagsSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.showVideoTags'))
            .setDesc(t('settings.showVideoTagsHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showVideoTags)
                .onChange(async (value) => {
                    await this.saveSetting('showVideoTags', value, {
                        listPane: true,
                        playlistPane: true,
                    });
                }));
    }

    private renderShortVideoDurationSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.shortMaxDuration'))
            .setDesc(t('settings.shortMaxDurationHelp'))
            .addDropdown(dropdown => {
                SHORT_VIDEO_MAX_DURATION_OPTIONS.forEach(seconds => {
                    dropdown.addOption(String(seconds), `${seconds} ${t('settings.seconds')}`);
                });
                dropdown
                    .setValue(String(this.plugin.settings.shortVideoMaxDurationSeconds))
                    .onChange(async value => {
                        const seconds = Number(value);
                        if (!isShortVideoMaxDurationSeconds(seconds)) return;
                        await this.saveSetting('shortVideoMaxDurationSeconds', seconds, {
                            listPane: true,
                            subscriptionPane: true,
                        });
                    });
            });
    }

    private renderVideoNotesSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName(t('settings.videoNotes'))
            .setDesc(t('settings.videoNotesHelp'));

        new Setting(containerEl)
            .setName(t('settings.videoNoteLocation'))
            .setDesc(t('settings.videoNoteLocationHelp'))
            .addText(text => {
                text
                    .setPlaceholder(t('settings.videoNoteLocationPlaceholder'))
                    .setValue(this.plugin.settings.videoNotePath)
                    .onChange(async (value) => {
                        await this.saveSetting('videoNotePath', value.trim());
                    });
                new VaultFolderSuggest(this.app, text.inputEl);
            });

        new Setting(containerEl)
            .setName(t('settings.organizeByChannel'))
            .setDesc(t('settings.organizeByChannelHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.organizeByChannel)
                .setDisabled(!this.plugin.settings.videoNotePath || !this.plugin.settings.videoNotePath.trim())
                .onChange(async (value) => {
                    await this.saveSetting('organizeByChannel', value);
                }));

        new Setting(containerEl)
            .setName(t('settings.autoCreateNotes'))
            .setDesc(t('settings.autoCreateNotesHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCreateNoteEnabled)
                .onChange(async (value) => {
                    await this.saveSetting('autoCreateNoteEnabled', value, { display: true });
                }));

        if (this.plugin.settings.autoCreateNoteEnabled) {
            new Setting(containerEl)
                .setName(t('settings.linkDailyNote'))
                .setDesc(t('settings.linkDailyNoteHelp'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.linkToDailyNote)
                    .onChange(async (value) => {
                        await this.saveSetting('linkToDailyNote', value);
                    }));
        }
    }

    private renderTemplateSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName(t('settings.templateSystem'))
            .setDesc(t('settings.templateSystemHelp'));

        new Setting(containerEl)
            .setName(t('settings.enableCustomTemplates'))
            .setDesc(t('settings.enableCustomTemplatesHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTemplateSystem)
                .onChange(async (value) => {
                    await this.saveSetting('enableTemplateSystem', value, { display: true });
                }));

        if (!this.plugin.settings.enableTemplateSystem) {
            return;
        }

        const editorEl = containerEl.createEl('details', { cls: 'geulo-settings-details' });
        editorEl.createEl('summary', { text: t('settings.editTemplate') });

        new Setting(editorEl)
            .setName(t('settings.customTemplate'))
            .setDesc(t('settings.customTemplateHelp'))
            .addButton(button => button
                .setButtonText(t('settings.resetToDefault'))
                .onClick(async () => {
                    const confirmed = await confirmAction(
                        this.app,
                        t('settings.resetTemplateConfirm'),
                        {
                            title: t('settings.resetTemplateTitle'),
                            confirmText: t('settings.reset'),
                            cancelText: t('settings.cancel'),
                            type: 'warning'
                        }
                    );
                    if (confirmed.confirmed) {
                        await this.saveSetting('customTemplate', DEFAULT_TEMPLATE, { display: true });
                        new Notice(t('settings.templateReset'));
                    }
                }));

        createMonospaceTextarea(editorEl, {
            className: 'template-textarea',
            value: this.plugin.settings.customTemplate,
            rows: 20,
            onChange: async (value) => {
                await this.saveSetting('customTemplate', value);
            },
        });

        createCollapsibleReference(
            editorEl,
            `📖 ${t('settings.availableVariables')}`,
            TEMPLATE_VARIABLES_REFERENCE
        );
    }

    private renderAISection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName(t('settings.aiFeatures'))
            .setDesc(t('settings.aiFeaturesHelp'));

        new Setting(containerEl)
            .setName(t('settings.enableAISummary'))
            .setDesc(t('settings.enableAISummaryHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableAISummary)
                .onChange(async (value) => {
                    await this.saveSetting('enableAISummary', value, {
                        display: true,
                        listPane: true,
                        playlistPane: true,
                    });
                }));

        if (!this.plugin.settings.enableAISummary) {
            return;
        }

        new Setting(containerEl)
            .setName(t('settings.includeSummaryHeading'))
            .setDesc(t('settings.includeSummaryHeadingHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeAISummaryHeading)
                .onChange(async (value) => {
                    await this.saveSetting('includeAISummaryHeading', value);
                }));

        new Setting(containerEl)
            .setName(t('settings.saveAsBlockquotes'))
            .setDesc(t('settings.saveAsBlockquotesHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.saveAISummariesAsBlockquotes)
                .onChange(async (value) => {
                    await this.saveSetting('saveAISummariesAsBlockquotes', value);
                }));

        new Setting(containerEl)
            .setName(t('settings.aiProvider'))
            .setDesc(t('settings.aiProviderHelp'))
            .addDropdown(dropdown => {
                for (const provider of AI_PROVIDERS) {
                    dropdown.addOption(provider, AI_PROVIDER_LABELS[provider]);
                }
                dropdown
                    .setValue(this.plugin.settings.aiProvider)
                    .onChange(async (value) => {
                        if (!isAIProvider(value)) return;
                        await this.saveSetting('aiProvider', value, { display: true });
                    });
            });

        if (this.plugin.settings.aiProvider === 'gemini') {
            addWideTextSetting(containerEl, {
                name: t('settings.geminiApiKey'),
                desc: t('settings.geminiApiKeyHelp'),
                placeholder: t('settings.enterGeminiKey'),
                value: this.plugin.settings.geminiApiKey,
                secret: true,
                copyable: true,
                onChange: async (value) => {
                    await this.saveSetting('geminiApiKey', value);
                },
            });
        } else if (this.plugin.settings.aiProvider === 'openrouter') {
            addWideTextSetting(containerEl, {
                name: t('settings.openRouterApiKey'),
                desc: t('settings.openRouterApiKeyHelp'),
                placeholder: 'sk-or-...',
                value: this.plugin.settings.openRouterApiKey,
                secret: true,
                copyable: true,
                onChange: async (value) => {
                    await this.saveSetting('openRouterApiKey', value);
                },
            });

            const currentModel = this.plugin.settings.openRouterModel;
            const isPresetModel = isOpenRouterModelPreset(currentModel);
            const modelSetting = new Setting(containerEl)
                .setName(t('settings.modelId'))
                .setDesc(t('settings.openRouterModelHelp'));

            const customModelSetting = addWideTextSetting(containerEl, {
                name: t('settings.customModelId'),
                desc: t('settings.openRouterCustomModelHelp'),
                placeholder: 'provider/model-id',
                value: currentModel,
                onChange: async (value) => {
                    await this.saveSetting('openRouterModel', value);
                },
            });
            customModelSetting.setClass('geulo-openrouter-custom-model');
            customModelSetting.settingEl.hidden = isPresetModel;

            modelSetting.addDropdown(dropdown => {
                for (const model of OPENROUTER_MODEL_PRESETS) {
                    dropdown.addOption(model, model);
                }
                dropdown
                    .addOption(CUSTOM_OPENROUTER_MODEL_OPTION, t('settings.custom'))
                    .setValue(isPresetModel ? currentModel : CUSTOM_OPENROUTER_MODEL_OPTION)
                    .onChange(async (value) => {
                        if (value === CUSTOM_OPENROUTER_MODEL_OPTION) {
                            const inputEl = customModelSetting.controlEl.querySelector<HTMLInputElement>('input');
                            if (inputEl) inputEl.value = this.plugin.settings.openRouterModel;
                            customModelSetting.settingEl.hidden = false;
                            inputEl?.focus();
                            return;
                        }
                        if (!isOpenRouterModelPreset(value)) return;
                        customModelSetting.settingEl.hidden = true;
                        await this.saveSetting('openRouterModel', value);
                    });
            });
        } else if (this.plugin.settings.aiProvider === 'openai') {
            addWideTextSetting(containerEl, {
                name: t('settings.openAIApiKey'),
                desc: t('settings.openAIApiKeyHelp'),
                placeholder: 'sk-...',
                value: this.plugin.settings.openAIApiKey,
                secret: true,
                copyable: true,
                onChange: async (value) => {
                    await this.saveSetting('openAIApiKey', value);
                },
            });

            const currentModel = this.plugin.settings.openAIModel;
            const isPresetModel = isOpenAIModelPreset(currentModel);
            const modelSetting = new Setting(containerEl)
                .setName(t('settings.modelId'))
                .setDesc(t('settings.openAIModelHelp'));

            const customModelSetting = addWideTextSetting(containerEl, {
                name: t('settings.customModelId'),
                desc: t('settings.openAICustomModelHelp'),
                placeholder: 'model-id',
                value: currentModel,
                onChange: async (value) => {
                    await this.saveSetting('openAIModel', value);
                },
            });
            customModelSetting.setClass('geulo-openai-custom-model');
            customModelSetting.settingEl.hidden = isPresetModel;

            modelSetting.addDropdown(dropdown => {
                for (const model of OPENAI_MODEL_PRESETS) {
                    dropdown.addOption(model, model);
                }
                dropdown
                    .addOption(CUSTOM_OPENAI_MODEL_OPTION, t('settings.custom'))
                    .setValue(isPresetModel ? currentModel : CUSTOM_OPENAI_MODEL_OPTION)
                    .onChange(async (value) => {
                        if (value === CUSTOM_OPENAI_MODEL_OPTION) {
                            const inputEl = customModelSetting.controlEl.querySelector<HTMLInputElement>('input');
                            if (inputEl) inputEl.value = this.plugin.settings.openAIModel;
                            customModelSetting.settingEl.hidden = false;
                            inputEl?.focus();
                            return;
                        }
                        if (!isOpenAIModelPreset(value)) return;
                        customModelSetting.settingEl.hidden = true;
                        await this.saveSetting('openAIModel', value);
                    });
            });
        }

        new Setting(containerEl)
            .setName(t('settings.summaryPrompt'))
            .setDesc(t('settings.summaryPromptHelp'));

        createMonospaceTextarea(containerEl, {
            className: 'summary-prompt-textarea',
            value: this.plugin.settings.summaryPrompt,
            rows: 5,
            onChange: async (value) => {
                await this.saveSetting('summaryPrompt', value);
            },
        });
    }

	private renderSpeechSection(containerEl: HTMLElement): void {
		containerEl.dataset.geuloSettingsSection = 'speech';
		new Setting(containerEl).setHeading().setName(t('settings.speech'))
			.setDesc(t('settings.speechHelp'));
		new Setting(containerEl).setName(t('settings.speechProvider'))
			.addDropdown(dropdown => dropdown.addOption('openrouter', 'OpenRouter')
				.setValue(this.plugin.settings.speechProvider)
				.onChange(async () => { await this.saveSetting('speechProvider', 'openrouter'); }));
		addWideTextSetting(containerEl, {
			name: 'Speech API key',
			desc: 'OpenRouter key used only for speech. Clicking Read aloud sends the summary text to this provider.',
			placeholder: 'sk-or-...', value: this.plugin.settings.speechApiKey, secret: true,
			copyable: true,
			onChange: async value => { await this.saveSetting('speechApiKey', value.trim()); },
		});
		const currentModel = this.plugin.settings.speechModel;
		const isPreset = SPEECH_MODEL_PRESETS.some(model => model.id === currentModel);
		const modelSetting = new Setting(containerEl).setName(t('settings.speechModel'))
			.setDesc(t('settings.speechModelHelp'));
		const customModel = addWideTextSetting(containerEl, {
			name: 'Custom speech model ID', desc: 'Enter an OpenRouter model with speech output support.',
			placeholder: 'provider/model-id', value: currentModel,
			onChange: async value => { await this.saveSetting('speechModel', value.trim()); },
		});
		customModel.setClass('geulo-speech-custom-model');
		customModel.settingEl.hidden = isPreset;
		const voiceSetting = addWideTextSetting(containerEl, {
			name: 'Speech voice', desc: 'Optional voice ID. Leave blank to omit voice from the request. Preset models fill in a default voice.',
			placeholder: 'Optional voice ID', value: this.plugin.settings.speechVoice,
			onChange: async value => { await this.saveSetting('speechVoice', value.trim()); },
		});
		modelSetting.addDropdown(dropdown => {
			for (const model of SPEECH_MODEL_PRESETS) dropdown.addOption(model.id, model.id);
			dropdown.addOption('custom', 'Custom').setValue(isPreset ? currentModel : 'custom')
				.onChange(async value => {
					const input = customModel.controlEl.querySelector('input');
					customModel.settingEl.hidden = value !== 'custom';
					if (value === 'custom') {
						if (input) { input.value = this.plugin.settings.speechModel; input.focus(); }
						return;
					}
					const preset = SPEECH_MODEL_PRESETS.find(model => model.id === value);
					if (!preset) return;
					this.plugin.settings.speechModel = preset.id;
					this.plugin.settings.speechVoice = preset.voice;
					const voiceInput = voiceSetting.controlEl.querySelector('input');
					if (voiceInput) voiceInput.value = preset.voice;
					await this.plugin.saveSettings();
				});
		});
	}

	private renderSubscriptionVideoMaxAgeSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.subscriptionAgeLimit'))
			.setDesc(t('settings.subscriptionAgeLimitHelp'))
			.addDropdown(dropdown => {
				SUBSCRIPTION_VIDEO_MAX_AGE_OPTIONS.forEach(days => {
					const defaultLabel = days === DEFAULT_SUBSCRIPTION_VIDEO_MAX_AGE_DAYS ? ' (default)' : '';
					dropdown.addOption(String(days), `${days} days${defaultLabel}`);
				});
				dropdown
					.setValue(String(this.plugin.settings.subscriptionVideoMaxAgeDays))
					.onChange(async value => {
						const days = Number(value);
						if (!isSubscriptionVideoMaxAgeDays(days)) return;
						await this.saveSetting('subscriptionVideoMaxAgeDays', days);
					});
			});
	}

    private renderAutoFetchSection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName(t('settings.enableAutoFetch'))
            .setDesc(t('settings.enableAutoFetchHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFetchEnabled)
                .onChange(async (value) => {
                    await this.saveSetting('autoFetchEnabled', value, { display: true, listPane: true });
                }));

        if (!this.plugin.settings.autoFetchEnabled) {
            return;
        }

        new Setting(containerEl)
            .setName(t('settings.fetchInterval'))
            .setDesc(t('settings.fetchIntervalHelp'))
            .addDropdown(dropdown => {
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
                        const interval = parseFloat(value);
                        await this.saveSetting('autoFetchInterval', interval, { display: true, listPane: true });
                        if (interval < 1) {
                            new Notice(t('settings.debugShortInterval'));
                        }
                    });

                return dropdown;
            });

        new Setting(containerEl)
            .setName(t('settings.fullFetchOnAutoFetch'))
            .setDesc(t('settings.fullFetchWarningDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fullFetchOnEveryAutoFetch)
                .onChange(async (value) => {
                    if (value && !this.plugin.settings.fullFetchOnEveryAutoFetch) {
                        const result = await confirmAction(
                            this.app,
                            t('settings.fullFetchConfirm'),
                            {
                                title: t('settings.fullFetchWarningTitle'),
                                confirmText: t('settings.confirmEnableFullFetch'),
                                cancelText: t('settings.cancel'),
                                type: 'warning',
                                showRememberChoice: false
                            }
                        );

                        if (!result.confirmed) {
                            toggle.setValue(false);
                            return;
                        }
                    }

                    await this.saveSetting('fullFetchOnEveryAutoFetch', value, { display: true });
                    if (value) {
                        new Notice(t('settings.fullFetchEnabled'));
                    }
                }));

        if (this.plugin.settings.fullFetchOnEveryAutoFetch && this.plugin.settings.autoCreateNoteEnabled) {
            new Setting(containerEl)
                .setName(t('settings.warning'))
                .setDesc(t('settings.notRecommended'))
                .setClass('setting-item-info');
        }

        new Setting(containerEl)
            .setName(t('settings.fetchOnStartup'))
            .setDesc(t('settings.fetchOnStartupHelp'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fetchOnStartup)
                .onChange(async (value) => {
                    await this.saveSetting('fetchOnStartup', value);
                }));

        if (this.plugin.settings.lastAutoFetchTime > 0) {
            const lastFetch = new Date(this.plugin.settings.lastAutoFetchTime);
            const intervalDisplay = this.plugin.settings.autoFetchInterval < 1
                ? `${Math.round(this.plugin.settings.autoFetchInterval * 60)}s`
                : `${this.plugin.settings.autoFetchInterval}min`;

            new Setting(containerEl)
                .setName(t('settings.lastAutoFetch'))
                .setDesc(`${t('settings.last')} ${lastFetch.toLocaleString(getFormatLocale())} (${intervalDisplay})`);
        }
    }

    private renderManualFetchSettings(containerEl: HTMLElement, isLoggedIn: boolean): void {

        if (isLoggedIn) {
            new Setting(containerEl)
                .setName(t('settings.fullScan'))
                .setDesc(t('settings.fullScanHelp'))
                .addButton(button => button
                    .setButtonText(t('settings.fullScan'))
                    .onClick(async () => {
                        await this.plugin.performAutoFetch(true, false);
                    }));

            new Setting(containerEl)
                .setName(t('settings.fetchRecentVideos'))
                .setDesc(t('settings.fetchRecentVideosHelp'))
                .addButton(button => button
                    .setButtonText(t('settings.fetchRecentVideos'))
                    .onClick(async () => {
                        await this.plugin.performAutoFetch(false, false);
                    }));
        }

    }

    private renderDataFileSizeSetting(
        containerEl: HTMLElement,
        name: string,
        fileName: string,
    ): void {
        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(fileName);
        const sizeEl = setting.controlEl.createSpan({
            cls: 'geulo-data-file-size',
            text: t('settings.loading'),
        });

        const manifestDir = this.plugin.manifest.dir;
        if (!manifestDir) {
            sizeEl.setText(t('settings.unavailable'));
            return;
        }

        void this.app.vault.adapter.stat(`${manifestDir}/${fileName}`)
            .then(stat => {
				sizeEl.setText(stat ? this.formatFileSize(stat.size) : t('settings.notCreatedYet'));
            })
            .catch(() => {
				sizeEl.setText(t('settings.unavailable'));
            });
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }

        const units = ['KB', 'MB', 'GB'];
        let size = bytes / 1024;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }

        const fractionDigits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
        return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
    }

    private renderDataManagementSection(containerEl: HTMLElement): void {
        const storedCount = localStorageService.getLikedVideos().length;
        new Setting(containerEl).setHeading().setName(t('settings.dataManagement'));
        this.renderDataFileSizeSetting(containerEl, t('settings.likedVideos'), 'liked-videos.json');
        this.renderDataFileSizeSetting(containerEl, t('settings.subscriptions'), 'subscriptions.json');
        this.renderDataFileSizeSetting(containerEl, t('settings.summaries'), 'summaries.json');
        new Setting(containerEl)
            .setName(t('settings.clearSavedLikedVideos'))
            .setDesc(t('settings.clearSavedLikedVideosHelp'))
            .addButton(button => button
                .setButtonText(t('settings.clearSavedVideos'))
                .setDestructive()
                .setDisabled(storedCount === 0)
                .onClick(async () => {
                    const result = await confirmAction(
                        this.app,
						t('settings.clearSavedVideosConfirmBody').replace('{count}', String(localStorageService.getLikedVideos().length)),
                        {
							title: t('settings.clearSavedVideosConfirmTitle'),
							confirmText: t('settings.clearSavedVideos'),
							cancelText: t('common.cancel'),
                            type: 'danger',
                            showRememberChoice: false,
                        }
                    );
                    if (!result.confirmed) {
                        return;
                    }
                    localStorageService.setLikedVideos([]);
                    this.update();
                    new Notice(t('settings.savedLikedVideosCleared'));
                }));
    }

	private renderHealthChecksSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setHeading()
			.setName(t('settings.healthChecks'));
		this.renderGoogleHealthCheck(containerEl);
		this.renderTranscriptHealthCheck(containerEl);
	}

    private renderSetupSection(containerEl: HTMLElement, refreshToken: string | null): void {
        const isLoggedIn = Boolean(refreshToken);

        new Setting(containerEl)
            .setHeading()
			.setName(t('settings.googleConnection'));

        new Setting(containerEl)
            .setName(isLoggedIn ? t('settings.connectedGoogle') : t('settings.notConnectedGoogle'))
            .setDesc(isLoggedIn
                ? t('settings.googleConnectedHelp')
                : t('settings.googleNotConnectedHelp'))
            .addButton(button => button
                .setButtonText(isLoggedIn ? t('settings.disconnect') : t('settings.connectGoogle'))
                .onClick(async (): Promise<void> => {
                    const refreshDisplay = (): void => {
						this.invalidateGoogleHealthCheck();
                        this.plugin.resetGoogleAccountIdentity();
                        this.update();
                        void this.updateListPaneView();
                    };
                    if (isLoggedIn) {
                        await handleGoogleLogout(this.plugin.settings, refreshDisplay, refreshDisplay);
                    } else {
                        await handleGoogleLogin(this.plugin.settings, refreshDisplay);
                    }
                }));

		new Setting(containerEl)
			.setName(t('settings.importCredentials'))
			.setDesc(t('settings.importCredentialsHelp'))
			.addButton(button => button
				.setButtonText(t('settings.importJson'))
				.onClick(() => {
					new GoogleCredentialsImportModal(
						this.app,
						() => Boolean(googleTokenStorageService.getRefreshToken() || googleTokenStorageService.getAccessToken()),
						credentials => this.importGoogleCredentials(credentials),
					).open();
				}));

        const credentialsEl = containerEl.createEl('details', {
            cls: 'geulo-google-credentials',
        });
        credentialsEl.open = !isLoggedIn;
        credentialsEl.createEl('summary', { text: t('settings.googleApiCredentials') });

        new Setting(credentialsEl)
            .setName(t('settings.openYoutubeConsole'))
            .setDesc(t('settings.openDeveloperConsoleHelp'))
            .addButton(button => button
                .setButtonText(t('settings.openDeveloperConsole'))
                .onClick(async () => {
                    window.open('https://console.cloud.google.com/apis/api/youtube.googleapis.com', '_blank');
                }));

        new Setting(credentialsEl)
            .setName(t('settings.clientId'))
            .setDesc(t('settings.clientIdHelp'))
            .addText(text => text
                .setPlaceholder(t('settings.enterClientId'))
                .setValue(this.plugin.settings.googleClientId)
                .onChange(async (value) => {
                    await this.saveSetting('googleClientId', value);
                }));

        new Setting(credentialsEl)
            .setName(t('settings.clientSecret'))
            .setDesc(t('settings.clientSecretHelp'))
            .addText(text => {
                text.inputEl.type = 'password';
                text
                    .setPlaceholder(t('settings.enterClientSecret'))
                    .setValue(googleTokenStorageService.getClientSecret())
                    .onChange((value) => {
                        try {
                            googleTokenStorageService.setClientSecret(value);
                        } catch (error) {
                            if (error instanceof Error) {
                                new Notice(t('settings.saveClientSecretFailed'));
                                this.update();
                                return;
                            }
                            throw error;
                        }
                    });
            });

    }

	private invalidateGoogleHealthCheck(): void {
		this.googleHealthCheckRunId += 1;
		this.googleHealthCheckRunning = false;
		this.googleHealthCheckReport = null;
	}

	private renderGoogleHealthCheck(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.googleConnection'))
			.setDesc(t('settings.googleCheckHelp'))
			.addButton(button => button
				.setButtonText(this.googleHealthCheckRunning
					? t('settings.checking')
					: this.googleHealthCheckReport ? t('settings.checkAgain') : t('settings.runHealthCheck'))
				.setDisabled(this.googleHealthCheckRunning)
				.onClick(() => {
					void this.runGoogleHealthCheck();
				}));

		if (!this.googleHealthCheckRunning && !this.googleHealthCheckReport) {
			return;
		}

		if (this.googleHealthCheckRunning) {
			this.renderHealthCheckCard(containerEl, {
				status: 'running',
				title: t('settings.googleCheckRunning'),
				summary: t('settings.googleCheckRunningHelp'),
			});
			return;
		}

		const healthReport = this.googleHealthCheckReport;
		if (!healthReport) return;
		this.renderHealthCheckCard(containerEl, {
			status: healthReport.status,
			title: healthReport.status === 'healthy'
				? t('settings.googleHealthy')
				: t('settings.googleNeedsAttention'),
			summary: healthReport.status === 'healthy'
				? t('settings.googleHealthHelp')
				: t('settings.googleHealthFailureHelp'),
			steps: healthReport.steps,
			checkedAt: healthReport.checkedAt,
		});
	}

	private renderTranscriptHealthCheck(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.transcriptAccess'))
			.setDesc(t('settings.transcriptAccessHelp'))
			.addButton(button => button
				.setButtonText(this.transcriptHealthCheckRunning
					? t('settings.checking')
					: this.transcriptHealthCheckReport ? t('settings.checkAgain') : t('settings.runHealthCheck'))
				.setDisabled(this.transcriptHealthCheckRunning)
				.onClick(() => {
					void this.runTranscriptHealthCheck();
				}));

		if (!this.transcriptHealthCheckRunning && !this.transcriptHealthCheckReport) {
			return;
		}
		if (this.transcriptHealthCheckRunning) {
			this.renderHealthCheckCard(containerEl, {
				status: 'running',
				title: t('settings.transcriptCheckRunning'),
				summary: t('settings.transcriptCheckRunningHelp'),
			});
			return;
		}

		const healthReport = this.transcriptHealthCheckReport;
		if (!healthReport) return;
		this.renderHealthCheckCard(containerEl, {
			status: healthReport.status,
			title: healthReport.status === 'healthy'
				? t('settings.transcriptWorking')
				: healthReport.status === 'inconclusive'
					? t('settings.transcriptUnverified')
					: t('settings.transcriptNeedsAttention'),
			summary: healthReport.detail,
			checkedAt: healthReport.checkedAt,
		});
	}

	private renderHealthCheckCard(containerEl: HTMLElement, options: HealthCheckCardOptions): void {
		const cardEl = containerEl.createDiv({
			cls: `geulo-health-check is-${options.status}`,
			attr: {
				role: options.status === 'unhealthy' ? 'alert' : 'status',
				'aria-live': 'polite',
			},
		});
		const headerEl = cardEl.createDiv('geulo-health-check__header');
		const headerIconEl = headerEl.createSpan('geulo-health-check__header-icon');
		setIcon(headerIconEl, options.status === 'running'
			? 'loader-circle'
			: options.status === 'healthy'
				? 'circle-check'
				: options.status === 'inconclusive' ? 'circle-help' : 'triangle-alert');
		const headerTextEl = headerEl.createDiv('geulo-health-check__header-text');
		headerTextEl.createDiv({ cls: 'geulo-health-check__title', text: options.title });
		headerTextEl.createDiv({ cls: 'geulo-health-check__summary', text: options.summary });

		if (options.steps && options.steps.length > 0) {
			const stepsEl = cardEl.createDiv('geulo-health-check__steps');
			for (const healthStep of options.steps) {
				const stepEl = stepsEl.createDiv({
					cls: `geulo-health-check__step is-${healthStep.status}`,
				});
				const stepIconEl = stepEl.createSpan('geulo-health-check__step-icon');
				setIcon(stepIconEl, this.getGoogleHealthStepIcon(healthStep.status));
				const stepTextEl = stepEl.createDiv('geulo-health-check__step-text');
				stepTextEl.createDiv({ cls: 'geulo-health-check__step-label', text: healthStep.label });
				stepTextEl.createDiv({ cls: 'geulo-health-check__step-detail', text: healthStep.detail });
			}
		}

		if (options.checkedAt) {
			cardEl.createEl('time', {
				cls: 'geulo-health-check__time',
				text: `${t('settings.checked')} ${options.checkedAt.toLocaleTimeString(getFormatLocale(), { hour: 'numeric', minute: '2-digit' })}`,
				attr: { datetime: options.checkedAt.toISOString() },
			});
		}
	}

	private getGoogleHealthStepIcon(status: GoogleConnectionHealthStepStatus): string {
		if (status === 'passed') return 'check';
		if (status === 'failed') return 'x';
		return 'minus';
	}

	private async runGoogleHealthCheck(): Promise<void> {
		if (this.googleHealthCheckRunning) return;
		const runId = ++this.googleHealthCheckRunId;
		this.googleHealthCheckRunning = true;
		this.googleHealthCheckReport = null;
		this.update();

		try {
			const healthReport = await checkGoogleConnectionHealth({
				clientId: this.plugin.settings.googleClientId,
				clientSecret: googleTokenStorageService.getClientSecret(),
				refreshToken: googleTokenStorageService.getRefreshToken(),
			}, {
				refreshAuthorization: async (clientId): Promise<void> => {
					await refreshAccessToken(clientId);
				},
				checkYouTubeAccount: () => this.plugin.accountIdentityService.checkCurrentIdentity(),
			});
			if (runId !== this.googleHealthCheckRunId) return;
			this.googleHealthCheckReport = healthReport;
		} catch (error: unknown) {
			if (runId !== this.googleHealthCheckRunId) return;
			new Notice(error instanceof Error
				? `${t('settings.googleHealthCheckFailed')}: ${error.message}`
				: t('settings.googleHealthCheckTryAgain'));
		} finally {
			if (runId === this.googleHealthCheckRunId) {
				this.googleHealthCheckRunning = false;
				this.update();
			}
		}
	}

	private async runTranscriptHealthCheck(): Promise<void> {
		if (this.transcriptHealthCheckRunning) return;
		const runId = ++this.transcriptHealthCheckRunId;
		this.transcriptHealthCheckRunning = true;
		this.transcriptHealthCheckReport = null;
		this.update();

		try {
			const recentVideo = localStorageService.getLikedVideos()[0];
			const preferredLanguage = this.plugin.settings.transcriptLanguage === 'auto'
				? getLanguage()
				: this.plugin.settings.transcriptLanguage;
			const healthReport = await checkTranscriptHealth({
				videoId: recentVideo?.id ?? null,
				videoTitle: recentVideo?.snippet.title,
				preferredLanguage,
			}, {
				fetchTranscript: (videoId, language) => transcriptService.fetchTranscript(videoId, undefined, language),
			});
			if (runId !== this.transcriptHealthCheckRunId) return;
			this.transcriptHealthCheckReport = healthReport;
		} catch (error: unknown) {
			if (runId !== this.transcriptHealthCheckRunId) return;
			new Notice(error instanceof Error
				? `${t('settings.transcriptHealthCheckFailed')}: ${error.message}`
				: t('settings.transcriptHealthCheckTryAgain'));
		} finally {
			if (runId === this.transcriptHealthCheckRunId) {
				this.transcriptHealthCheckRunning = false;
				this.update();
			}
		}
	}

	private async importGoogleCredentials(credentials: GoogleClientCredentials): Promise<void> {
		if (googleTokenStorageService.getRefreshToken() || googleTokenStorageService.getAccessToken()) {
			throw new Error(t('credentialsImport.disconnectBeforeImport'));
		}
		const previousClientSecret = googleTokenStorageService.getClientSecret();
		try {
			googleTokenStorageService.setClientSecret(credentials.clientSecret);
		} catch {
			throw new Error(t('credentialsImport.secretSaveFailed'));
		}
		try {
			await this.plugin.saveData({ ...this.plugin.settings, googleClientId: credentials.clientId });
		} catch {
			try {
				googleTokenStorageService.setClientSecret(previousClientSecret);
			} catch {
				throw new Error(t('credentialsImport.restoreFailed'));
			}
			throw new Error(t('credentialsImport.credentialsSaveFailed'));
		}
		this.plugin.settings.googleClientId = credentials.clientId;
		this.invalidateGoogleHealthCheck();
		this.update();
	}

    private renderDebugSection(containerEl: HTMLElement): void {
        const debugConfig = debugLogger.getConfig();
        if (!debugConfig.enabled) {
            return;
        }

        new Setting(containerEl)
            .setHeading()
            .setName(`🔧 ${t('settings.debugSettings')}`)
            .setDesc(t('settings.developmentOnly'));

        new Setting(containerEl)
            .setName(t('settings.logLevel'))
            .setDesc(t('settings.logLevelHelp'))
            .addDropdown(dropdown => dropdown
                .addOption('error', t('settings.error'))
                .addOption('warn', t('settings.warn'))
                .addOption('info', t('settings.info'))
                .addOption('debug', t('settings.debug'))
                .addOption('verbose', t('settings.verbose'))
                .setValue(debugConfig.logLevel)
                .onChange((value) => {
                    debugLogger.updateConfig({ logLevel: value as DebugConfig['logLevel'] });
                    const level = value === 'error' ? t('settings.error')
                        : value === 'warn' ? t('settings.warn')
                            : value === 'info' ? t('settings.info')
                                : value === 'debug' ? t('settings.debug') : t('settings.verbose');
                    new Notice(`${t('settings.logLevelSet')}: ${level}`);
                }));

        new Setting(containerEl)
            .setName(t('settings.logApiCalls'))
            .setDesc(t('settings.logApiCallsHelp'))
            .addToggle(toggle => toggle
                .setValue(debugConfig.logApiCalls)
                .onChange(value => {
                    debugLogger.updateConfig({ logApiCalls: value });
                }));

        new Setting(containerEl)
            .setName(t('settings.logStateChanges'))
            .setDesc(t('settings.logStateChangesHelp'))
            .addToggle(toggle => toggle
                .setValue(debugConfig.logStateChanges)
                .onChange(value => {
                    debugLogger.updateConfig({ logStateChanges: value });
                }));

        new Setting(containerEl)
            .setName(t('settings.logAutoFetch'))
            .setDesc(t('settings.logAutoFetchHelp'))
            .addToggle(toggle => toggle
                .setValue(debugConfig.logAutoFetch)
                .onChange(value => {
                    debugLogger.updateConfig({ logAutoFetch: value });
                }));

        new Setting(containerEl)
            .setName(t('settings.autoFetchOverride'))
            .setDesc(t('settings.autoFetchOverrideHelp'))
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(debugConfig.autoFetchIntervalOverride || 0))
                .onChange(value => {
                    const minutes = parseInt(value) || 0;
                    debugLogger.updateConfig({
                        autoFetchIntervalOverride: minutes > 0 ? minutes : undefined
                    });
                    if (minutes > 0) {
						new Notice(t('settings.intervalOverrideApplied', { count: minutes }));
                    }
                }));

        new Setting(containerEl)
            .setName(t('settings.forceFetchNow'))
            .setDesc(t('settings.forceFetchNowHelp'))
            .addButton(button => button
                .setButtonText(t('settings.fetchNow'))
                .onClick(async () => {
                    debugLogger.info('Manual debug fetch triggered');
                    await this.plugin.performAutoFetch();
                }));

        new Setting(containerEl)
            .setName(t('settings.debugCommands'))
            .setDesc(t('settings.debugCommandsHelp'));
    }
}
