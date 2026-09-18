import { App, getLanguage, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
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
import { UI_TEXT } from '../constants/uiText';
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
                    ['Enable AI Summary', 'AI Provider', 'Gemini API Key', 'OpenRouter API Key', 'OpenAI API Key', 'Model ID', 'Summary Prompt'],
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
                ['Clear saved liked videos'],
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
        new Setting(containerEl).setHeading().setName('Video display');
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
		new Setting(containerEl).setHeading().setName('Sync');
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
            .setName('Stored videos')
            .setDesc('Liked videos saved in this vault.');
        storedVideosSetting.controlEl.createSpan({
            cls: 'geulo-stored-video-count',
            text: likedVideosCount.toLocaleString(),
        });
    }

    private renderOpenInWebViewerSetting(containerEl: HTMLElement): void {
        const viewerEl = containerEl.createDiv();
        new Setting(viewerEl)
            .setName('Open videos in Obsidian Web Viewer')
            .setDesc('Open videos inside Obsidian. Requires the Web Viewer core plugin.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openInObsidianWebViewer)
                .onChange(async (value) => {
                    openInSetting.settingEl.hidden = !value;
                    await this.saveSetting('openInObsidianWebViewer', value);
                }));

        const openInSetting = new Setting(viewerEl)
            .setName('Open in')
            .setClass('geulo-web-viewer-option')
            .addDropdown(dropdown => dropdown
                .addOption('tab', 'New tab')
                .addOption('split', 'Split pane')
                .setValue(this.plugin.settings.openWebViewerInSplitPane ? 'split' : 'tab')
                .onChange(async (value) => {
                    await this.saveSetting('openWebViewerInSplitPane', value === 'split');
                }));
        openInSetting.settingEl.hidden = !this.plugin.settings.openInObsidianWebViewer;
    }

    private renderLikedVideoViewModeSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Liked video view mode')
            .setDesc('Choose how liked videos are displayed.')
            .addDropdown(dropdown => dropdown
                .addOption('pagination', 'Pagination')
                .addOption('infinite', 'Infinite scroll')
                .setValue(localStorageService.getLikedVideoPaginationMode())
                .onChange(async (value) => {
                    const paginationMode = value === 'infinite' ? 'infinite' : 'pagination';
                    localStorageService.setLikedVideoPaginationMode(paginationMode);
                    await this.updateListPaneView();
                }));
    }

    private renderTranscriptLanguageSetting(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Transcript language')
            .setDesc('Preferred caption language for reading transcripts and OpenRouter or OpenAI summaries. Falls back to English, then the first available language. Reopen an existing transcript to apply changes.')
            .addDropdown(dropdown => dropdown
                .addOptions(TRANSCRIPT_LANGUAGE_OPTIONS)
                .setValue(this.plugin.settings.transcriptLanguage)
                .onChange(async value => {
                    await this.saveSetting('transcriptLanguage', value);
                }));
    }

	private renderSummaryLineHeightSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('AI summary line spacing')
			.setDesc('Line spacing for the AI summary reader. Changes apply immediately.')
			.addDropdown(dropdown => {
				SUMMARY_LINE_HEIGHT_OPTIONS.forEach(lineHeight => {
					dropdown.addOption(String(lineHeight), `${lineHeight.toFixed(1)}${lineHeight === 1.5 ? ' (default)' : ''}`);
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
            .setName('Show video tags')
            .setDesc('Display responsive YouTube tag chips on video cards.')
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
            .setName('Maximum Short-form duration')
            .setDesc('Include videos up to this length in the Short-form filter.')
            .addDropdown(dropdown => {
                SHORT_VIDEO_MAX_DURATION_OPTIONS.forEach(seconds => {
                    dropdown.addOption(String(seconds), `${seconds} seconds`);
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
            .setName('Video notes')
            .setDesc('Configure the video note settings');

        new Setting(containerEl)
            .setName('Video note location')
            .setDesc('Specify where video notes should be created. Leave empty to use Obsidian\'s default new file location, or enter a custom folder path.')
            .addText(text => text
                .setPlaceholder('e.g. Youtube, Youtube/Videos')
                .setValue(this.plugin.settings.videoNotePath)
                .onChange(async (value) => {
                    await this.saveSetting('videoNotePath', value.trim());
                }));

        new Setting(containerEl)
            .setName('Organize by channel')
            .setDesc('Create subfolders for each channel (e.g., Youtube/Channel Name/video.md). Only applies when using a custom video note location.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.organizeByChannel)
                .setDisabled(!this.plugin.settings.videoNotePath || !this.plugin.settings.videoNotePath.trim())
                .onChange(async (value) => {
                    await this.saveSetting('organizeByChannel', value);
                }));

        new Setting(containerEl)
            .setName('Automatically create notes')
            .setDesc('If enabled, a new note will be created for each new video fetched.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCreateNoteEnabled)
                .onChange(async (value) => {
                    await this.saveSetting('autoCreateNoteEnabled', value, { display: true });
                }));

        if (this.plugin.settings.autoCreateNoteEnabled) {
            new Setting(containerEl)
                .setName('Link to daily note')
                .setDesc('If enabled, a link to the new video note will be added to your daily note.')
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
            .setName('Template System')
            .setDesc('Customize video note templates');

        new Setting(containerEl)
            .setName('Enable custom templates')
            .setDesc('Use custom markdown templates for video notes instead of the default format')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableTemplateSystem)
                .onChange(async (value) => {
                    await this.saveSetting('enableTemplateSystem', value, { display: true });
                }));

        if (!this.plugin.settings.enableTemplateSystem) {
            return;
        }

        const editorEl = containerEl.createEl('details', { cls: 'geulo-settings-details' });
        editorEl.createEl('summary', { text: 'Edit template' });

        new Setting(editorEl)
            .setName('Custom template')
            .setDesc('Edit your video note template directly. Use {{variable}} syntax for dynamic content.')
            .addButton(button => button
                .setButtonText('Reset to Default')
                .onClick(async () => {
                    const confirmed = await confirmAction(
                        this.app,
                        'This will reset your template to the default. Any customizations will be lost.',
                        {
                            title: 'Reset Template?',
                            confirmText: 'Reset',
                            cancelText: 'Cancel',
                            type: 'warning'
                        }
                    );
                    if (confirmed.confirmed) {
                        await this.saveSetting('customTemplate', DEFAULT_TEMPLATE, { display: true });
                        new Notice('Template reset to default');
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
            '📖 Available Variables (click to expand)',
            TEMPLATE_VARIABLES_REFERENCE
        );
    }

    private renderAISection(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setHeading()
            .setName('AI Features')
            .setDesc('Configure AI-powered features');

        new Setting(containerEl)
            .setName('Enable AI Summary')
            .setDesc('Generate video summaries with your selected AI provider. Requires an API key for that provider.')
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
            .setName('AI Provider')
            .setDesc('OpenRouter and OpenAI summarize the transcript with your selected model. Google Gemini analyzes the video directly without sending the transcript.')
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
                name: 'Gemini API Key',
                desc: 'Use a Google AI Studio API key for the Google Gemini provider. Get a key at aistudio.google.com/app/apikey.',
                placeholder: 'Enter your Gemini API key',
                value: this.plugin.settings.geminiApiKey,
                secret: true,
                copyable: true,
                onChange: async (value) => {
                    await this.saveSetting('geminiApiKey', value);
                },
            });
        } else if (this.plugin.settings.aiProvider === 'openrouter') {
            addWideTextSetting(containerEl, {
                name: 'OpenRouter API Key',
                desc: 'Use an OpenRouter API key for the OpenRouter provider. Get a key at openrouter.ai/keys.',
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
                .setName('Model ID')
                .setDesc('Choose an OpenRouter model that supports text input. The transcript is included with your summary prompt.');

            const customModelSetting = addWideTextSetting(containerEl, {
                name: 'Custom model ID',
                desc: 'Enter the complete OpenRouter model ID.',
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
                    .addOption(CUSTOM_OPENROUTER_MODEL_OPTION, 'Custom')
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
                name: 'OpenAI API Key',
                desc: 'Use an OpenAI API key for the OpenAI provider. Get a key at platform.openai.com/api-keys.',
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
                .setName('Model ID')
                .setDesc('Choose an OpenAI model that supports text input through the Responses API. The transcript is included with your summary prompt.');

            const customModelSetting = addWideTextSetting(containerEl, {
                name: 'Custom model ID',
                desc: 'Enter the complete OpenAI model ID.',
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
                    .addOption(CUSTOM_OPENAI_MODEL_OPTION, 'Custom')
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
            .setName('Summary Prompt')
            .setDesc('Customize the instructions sent to your selected AI provider when generating video summaries.');

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
		new Setting(containerEl).setHeading().setName('Speech')
			.setDesc('Read AI summaries aloud. Speech uses its own API key and model, independently of AI summaries.');
		new Setting(containerEl).setName('Speech provider')
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
		const modelSetting = new Setting(containerEl).setName('Speech model')
			.setDesc('Choose a text-to-speech model. Supported languages and voices vary by model.');
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
			.setName('Subscription video age limit')
			.setDesc('Skip video details for subscription uploads older than this during the next sync.')
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
            .setName('Enable automatic fetch')
            .setDesc('Automatically fetch liked videos at regular intervals')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFetchEnabled)
                .onChange(async (value) => {
                    await this.saveSetting('autoFetchEnabled', value, { display: true, listPane: true });
                }));

        if (!this.plugin.settings.autoFetchEnabled) {
            return;
        }

        new Setting(containerEl)
            .setName('Fetch interval')
            .setDesc('How often to automatically fetch videos (in minutes)')
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
                            new Notice('⚠️ Debug mode: Using very short fetch interval!');
                        }
                    });

                return dropdown;
            });

        new Setting(containerEl)
            .setName('Full fetch on every auto-fetch')
            .setDesc(UI_TEXT.FULL_FETCH_WARNING_DESC)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fullFetchOnEveryAutoFetch)
                .onChange(async (value) => {
                    if (value && !this.plugin.settings.fullFetchOnEveryAutoFetch) {
                        const result = await confirmAction(
                            this.app,
                            UI_TEXT.FULL_FETCH_CONFIRM_MESSAGE,
                            {
                                title: UI_TEXT.FULL_FETCH_WARNING_TITLE,
                                confirmText: 'Yes, Enable Full Fetch',
                                cancelText: 'Cancel',
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
                        new Notice(UI_TEXT.FULL_FETCH_ENABLED_NOTICE);
                    }
                }));

        if (this.plugin.settings.fullFetchOnEveryAutoFetch && this.plugin.settings.autoCreateNoteEnabled) {
            new Setting(containerEl)
                .setName('⚠️ Warning')
                .setDesc(UI_TEXT.FULL_FETCH_NOT_RECOMMEND_AUTO_VIDEO_NOTE_WARNING)
                .setClass('setting-item-info');
        }

        new Setting(containerEl)
            .setName('Fetch on startup')
            .setDesc('Automatically fetch videos when Obsidian starts')
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
                .setName('Last auto-fetch')
                .setDesc(`Last: ${lastFetch.toLocaleString()} (every ${intervalDisplay})`);
        }
    }

    private renderManualFetchSettings(containerEl: HTMLElement, isLoggedIn: boolean): void {

        if (isLoggedIn) {
            new Setting(containerEl)
                .setName('Full scan')
                .setDesc('Check all liked videos and replace the saved list with the results. Videos no longer returned by YouTube are removed from this list.')
                .addButton(button => button
                    .setButtonText('Full scan')
                    .onClick(async () => {
                        await this.plugin.performAutoFetch(true, false);
                    }));

            new Setting(containerEl)
                .setName('Fetch recent videos')
                .setDesc('Check the 50 most recent liked videos. Add new videos and update matching saved videos, keeping the rest of your saved list.')
                .addButton(button => button
                    .setButtonText('Fetch recent videos')
                    .onClick(async () => {
                        await this.plugin.performAutoFetch(false, false);
                    }));
        }

    }

    private renderDataManagementSection(containerEl: HTMLElement): void {
        const storedCount = localStorageService.getLikedVideos().length;
        new Setting(containerEl).setHeading().setName('Data management');
        new Setting(containerEl)
            .setName('Clear saved liked videos')
            .setDesc('Remove the saved liked-video list from this vault. YouTube likes, existing video notes, playlists, and saved summaries are kept.')
            .addButton(button => button
                .setButtonText('Clear saved videos')
                .setDestructive()
                .setDisabled(storedCount === 0)
                .onClick(async () => {
                    const result = await confirmAction(
                        this.app,
                        `Remove all ${localStorageService.getLikedVideos().length} saved liked videos from this vault?\n\nThis does not unlike videos on YouTube or delete existing video notes, playlists, or saved summaries.\n\nTo repopulate the list, run a Full scan. Videos no longer available from YouTube may not be restored.`,
                        {
                            title: 'Clear saved liked videos?',
                            confirmText: 'Clear saved videos',
                            cancelText: 'Cancel',
                            type: 'danger',
                            showRememberChoice: false,
                        }
                    );
                    if (!result.confirmed) {
                        return;
                    }
                    localStorageService.setLikedVideos([]);
                    this.update();
                    new Notice('Saved liked-video list cleared. YouTube likes and existing notes were kept.');
                }));
    }

	private renderHealthChecksSection(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setHeading()
			.setName('Health checks');
		this.renderGoogleHealthCheck(containerEl);
		this.renderTranscriptHealthCheck(containerEl);
	}

    private renderSetupSection(containerEl: HTMLElement, refreshToken: string | null): void {
        const isLoggedIn = Boolean(refreshToken);

        new Setting(containerEl)
            .setHeading()
            .setName('Google connection');

        new Setting(containerEl)
            .setName(isLoggedIn ? 'Connected to Google' : 'Not connected to Google')
            .setDesc(isLoggedIn
                ? 'Your Google account is connected. You can fetch your liked videos.'
                : 'Import a credentials JSON file or enter your Google API credentials below, then connect your account.')
            .addButton(button => button
                .setButtonText(isLoggedIn ? 'Disconnect' : 'Connect with Google')
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
			.setName('Import Google credentials')
			.setDesc('Load a Google OAuth client JSON file and review it before saving.')
			.addButton(button => button
				.setButtonText('Import JSON')
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
        credentialsEl.createEl('summary', { text: 'Google API credentials' });

        new Setting(credentialsEl)
            .setName('Open Youtube Data API Console')
            .setDesc('Click the button below to open the Google Developer Console, where you can manage your Google APIs and credentials.')
            .addButton(button => button
                .setButtonText('Open Google Developer Console')
                .onClick(async () => {
                    window.open('https://console.cloud.google.com/apis/api/youtube.googleapis.com', '_blank');
                }));

        new Setting(credentialsEl)
            .setName('Client ID')
            .setDesc('Client ID required to authenticate your Google account and access the YouTube Data API v3.')
            .addText(text => text
                .setPlaceholder('Enter your client ID')
                .setValue(this.plugin.settings.googleClientId)
                .onChange(async (value) => {
                    await this.saveSetting('googleClientId', value);
                }));

        new Setting(credentialsEl)
            .setName('Client secret')
            .setDesc('Client secret for accessing the YouTube Data API v3')
            .addText(text => {
                text.inputEl.type = 'password';
                text
                    .setPlaceholder('Enter your client secret')
                    .setValue(googleTokenStorageService.getClientSecret())
                    .onChange((value) => {
                        try {
                            googleTokenStorageService.setClientSecret(value);
                        } catch (error) {
                            if (error instanceof Error) {
                                new Notice('Failed to save the Google client secret.');
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
			.setName('Google connection')
			.setDesc('Verify OAuth credentials, Google authorization, and YouTube Data API access. Runs only when requested and uses 1 YouTube quota unit.')
			.addButton(button => button
				.setButtonText(this.googleHealthCheckRunning
					? 'Checking…'
					: this.googleHealthCheckReport ? 'Check again' : 'Run health check')
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
				title: 'Checking Google connection…',
				summary: 'Renewing authorization and contacting YouTube.',
			});
			return;
		}

		const healthReport = this.googleHealthCheckReport;
		if (!healthReport) return;
		this.renderHealthCheckCard(containerEl, {
			status: healthReport.status,
			title: healthReport.status === 'healthy'
				? 'Google connection is healthy'
				: 'Google connection needs attention',
			summary: healthReport.status === 'healthy'
				? 'OAuth renewal and YouTube API access both succeeded.'
				: 'Review the failed check below, make the suggested change, and try again.',
			steps: healthReport.steps,
			checkedAt: healthReport.checkedAt,
		});
	}

	private renderTranscriptHealthCheck(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Transcript access')
			.setDesc('Test the public YouTube transcript path with your most recently saved video. No Google OAuth or Data API quota is used.')
			.addButton(button => button
				.setButtonText(this.transcriptHealthCheckRunning
					? 'Checking…'
					: this.transcriptHealthCheckReport ? 'Check again' : 'Run health check')
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
				title: 'Checking transcript access…',
				summary: 'Contacting the public YouTube transcript endpoints.',
			});
			return;
		}

		const healthReport = this.transcriptHealthCheckReport;
		if (!healthReport) return;
		this.renderHealthCheckCard(containerEl, {
			status: healthReport.status,
			title: healthReport.status === 'healthy'
				? 'Transcript access is working'
				: healthReport.status === 'inconclusive'
					? 'Transcript access was not verified'
					: 'Transcript access needs attention',
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
				text: `Checked ${options.checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
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
				? `Google health check failed: ${error.message}`
				: 'Google health check failed. Please try again.');
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
				? `Transcript health check failed: ${error.message}`
				: 'Transcript health check failed. Please try again.');
		} finally {
			if (runId === this.transcriptHealthCheckRunId) {
				this.transcriptHealthCheckRunning = false;
				this.update();
			}
		}
	}

	private async importGoogleCredentials(credentials: GoogleClientCredentials): Promise<void> {
		if (googleTokenStorageService.getRefreshToken() || googleTokenStorageService.getAccessToken()) {
			throw new Error('Disconnect your Google account before importing new credentials.');
		}
		const previousClientSecret = googleTokenStorageService.getClientSecret();
		try {
			googleTokenStorageService.setClientSecret(credentials.clientSecret);
		} catch {
			throw new Error('Could not save the client secret in Obsidian SecretStorage. Please try again.');
		}
		try {
			await this.plugin.saveData({ ...this.plugin.settings, googleClientId: credentials.clientId });
		} catch {
			try {
				googleTokenStorageService.setClientSecret(previousClientSecret);
			} catch {
				throw new Error('Could not save credentials or restore the previous secret. Import the file again before connecting.');
			}
			throw new Error('Could not save credentials. Please try again.');
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
            .setName('🔧 Debug Settings')
            .setDesc('Development mode only');

        new Setting(containerEl)
            .setName('Log Level')
            .setDesc('Set the verbosity of debug logs')
            .addDropdown(dropdown => dropdown
                .addOption('error', 'Error')
                .addOption('warn', 'Warning')
                .addOption('info', 'Info')
                .addOption('debug', 'Debug')
                .addOption('verbose', 'Verbose')
                .setValue(debugConfig.logLevel)
                .onChange((value) => {
                    debugLogger.updateConfig({ logLevel: value as DebugConfig['logLevel'] });
                    new Notice(`Debug log level set to: ${value}`);
                }));

        new Setting(containerEl)
            .setName('Log API Calls')
            .setDesc('Log all API requests and responses')
            .addToggle(toggle => toggle
                .setValue(debugConfig.logApiCalls)
                .onChange(value => {
                    debugLogger.updateConfig({ logApiCalls: value });
                }));

        new Setting(containerEl)
            .setName('Log State Changes')
            .setDesc('Log state updates and changes')
            .addToggle(toggle => toggle
                .setValue(debugConfig.logStateChanges)
                .onChange(value => {
                    debugLogger.updateConfig({ logStateChanges: value });
                }));

        new Setting(containerEl)
            .setName('Log Auto-Fetch')
            .setDesc('Log automatic fetch operations')
            .addToggle(toggle => toggle
                .setValue(debugConfig.logAutoFetch)
                .onChange(value => {
                    debugLogger.updateConfig({ logAutoFetch: value });
                }));

        new Setting(containerEl)
            .setName('Auto-Fetch Interval Override (minutes)')
            .setDesc('Override auto-fetch interval for testing (0 = use normal setting)')
            .addText(text => text
                .setPlaceholder('0')
                .setValue(String(debugConfig.autoFetchIntervalOverride || 0))
                .onChange(value => {
                    const minutes = parseInt(value) || 0;
                    debugLogger.updateConfig({
                        autoFetchIntervalOverride: minutes > 0 ? minutes : undefined
                    });
                    if (minutes > 0) {
                        new Notice(`Auto-fetch interval overridden to ${minutes} minutes. Restart plugin to apply.`);
                    }
                }));

        new Setting(containerEl)
            .setName('Force Fetch Now')
            .setDesc('Trigger an immediate fetch for testing')
            .addButton(button => button
                .setButtonText('Fetch Now')
                .onClick(async () => {
                    debugLogger.info('Manual debug fetch triggered');
                    await this.plugin.performAutoFetch();
                }));

        new Setting(containerEl)
            .setName('Debug Console Commands')
            .setDesc('Enable: enableGeuloDebug() | Disable: disableGeuloDebug()');
    }
}
