import { App, Modal } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';

export const LEGACY_ANNOUNCEMENT_ID = 'ai-summaries-intro';

export const FEATURE_ANNOUNCEMENT = {
	id: '5-2-0',
	title: 'Geulo update notes',
	description: 'Check connections, recover blocked transcripts, and choose vault folders more easily. Earlier updates are included below.',
	releases: [
		{
			version: '5.2.0',
			title: 'More reliable connections, transcripts, and settings',
			notes: [
				'Run separate Google connection and transcript access checks in Settings, with clear results and next steps when something fails.',
				'When direct transcript access is blocked, Geulo can recover captions through Obsidian Web Viewer. Follow the on-screen prompt if YouTube requires sign-in or Show transcript.',
				'Google sign-in now always opens in your default browser. API keys have one-click copy buttons, and Video note location suggests matching folders from your current vault as you type.',
				'Open a failed subscription channel directly on YouTube from the sync warning to review or fix the channel more quickly.'
			]
		},
		{
			version: '5.0.0',
			title: 'Big update: AI summaries, transcripts, better filter & sort, and designs',
			notes: [
				'Read YouTube captions/transcripts in a dedicated reader with searchable paragraphs, timestamps linked back to the video. Copy text with or without timestamps. Choose your preferred caption language in Settings.',
				'OpenRouter and newly added OpenAI now summarize the video content based on fetched transcript. Gemini continues to analyze the video directly within the provider model. Choose a preset or custom model for OpenAI and OpenRouter.',
				'Copy or add AI summaries to video notes',
				'Listen to AI summaries with pause, resume, speed, and volume controls. (OpenRouter key is required)',
				'Find videos more precisely in liked videos and playlists with upload-date, duration, language, audio-language, AI-summary, and video-note filters. ',
				'Improved designs for active filters, with more sorting choices and ',
				'Improved smoothness on browsing in large collections.',
				'Keep favorite playlists at the top by pinning them, filter between your own and imported playlists, and import by YouTube URL or playlist ID. Open playlists directly on YouTube, or remove an imported playlist from Geulo without deleting it from YouTube.',
				'Use the menu and context menu on a YouTube page in Obsidian Web Viewer to read its transcript, create or open an AI summary, create or open a video note, or import and open its playlist in Geulo.',
				'Video notes now record your connected YouTube account’s confirmed like status as liked: true or liked: false. Geulo updates it when you open video notes from Geulo, change likes, or sync liked videos. The likes property still means the total like count; editing liked does not change YouTube.',
				'Saved liked videos and subscriptions are now linked to the YouTube account they came from. When the account is unknown or different, Geulo asks you to confirm how to use the saved list before syncing, helping prevent videos from different accounts from being mixed.'
			]
		},
		{
			version: '4.3',
			title: 'A lighter subscription feed and easier YouTube search',
			notes: [
				'Subscriptions now loads up to 5 recent uploads per channel to keep refreshes lighter. This is a snapshot of recent uploads, not the complete channel history.',
				'When no videos match your search, use the YouTube search button to continue searching on YouTube. It follows your settings for opening videos in a browser or Obsidian Web Viewer.'
			]
		},
		{
			version: '4.0–4.2.2',
			title: 'Browse and manage your YouTube subscriptions',
			notes: [
				'Open the Subscriptions view to collect recent uploads from the channels you follow. Load them when you are ready, then refresh to check for newer videos.',
				'Find videos by search, channel, upload date, or content type. Sort uploads newest or oldest first, and keep scrolling to see more of the collected videos.',
				'Unsubscribe from individual channels or selected channels directly in Geulo. The confirmation shows the API quota cost before you proceed. This changes your YouTube subscriptions and removes those channels’ cached videos from the view.',
				'Subscription refreshes now load multiple channels at once to reduce waiting time.'
			]
		},
		{
			version: '3.4',
			title: 'Smoother browsing and more dependable notes',
			notes: [
				'Scroll through large liked-video collections more smoothly. Infinite scroll now renders only the videos around your current position and loads more as you continue.',
				'Choose how videos open inside Obsidian. Enable “Open Videos in Obsidian Web Viewer”, then use “Open Web Viewer in Split Pane” to open videos beside your notes instead of in a new tab.',
				'Rename or move a video note without losing its connection to the video. Geulo now identifies notes by their YouTube video ID, so opening a note or adding a summary continues to use the same file instead of creating a duplicate.',
				'Existing video notes remain supported. Geulo adds the video ID when you next open an older note from a video card or add a summary to it. Leaving “Video note location” empty now uses Obsidian’s default new-file location.',
				'Check your Google connection at a glance in Settings. Geulo clearly shows whether you are connected and presents the actions available for your current status.',
				'Your liked-video list now moves automatically from browser storage to a dedicated file in the Geulo plugin folder. Geulo keeps a backup before saving changes and preserves an unreadable file instead of replacing your videos with an empty list.',
				'If your sync includes plugin data, reload Geulo after syncing to see list changes from another device. Avoid changing the list on two devices at the same time, because 3.4 does not merge competing changes.'
			]
		},
		{
			version: '3.3.1',
			title: 'Google credential storage',
			notes: [
				'Google access tokens, refresh tokens, and the client secret now use Obsidian SecretStorage. Existing credentials move automatically when the plugin loads.',
				'This change applies to Google credentials; Gemini, OpenRouter, and OpenAI API keys still use the existing plugin settings storage.'
			]
		},
		{
			version: '3.3.0',
			title: 'Video tags and page navigation',
			notes: [
				'Liked videos and playlists now show video tags. Click a tag to show videos with that exact tag; select another to replace the filter, or clear it to return to the full list.',
				'Cards show a compact selection of tags. Click +N to view the rest. You can hide tag chips in Settings → Show video tags.',
				'In Settings → Video display, choose Pagination to navigate liked videos by page instead of scrolling.',
				'Requires Obsidian 1.13.0 or later.'
			]
		},
		{
			version: '3.2.0',
			title: 'Delete your YouTube playlists',
			notes: [
				'You can now delete playlists you own from the playlists view or an open playlist.',
				'A confirmation appears before deletion. This permanently deletes the playlist from YouTube, not just from Geulo, and cannot be undone.'
			]
		},
		{
			version: '3.1.0',
			title: 'Likes, undo, and full fetch',
			notes: [
				'You can like or unlike a video directly from a playlist.',
				'After unliking a video in liked videos, click Undo in the notification within 5 seconds to restore the like and return the video to the list.',
				'Run “Geulo: Full Fetch Liked Videos” from the command palette to fetch beyond the regular fetch limit, using your configured full-fetch limit.'
			]
		}
	],
} as const;

interface FeatureIntroModalProps {
	onClose: () => void;
}

const FeatureIntroModalContent: React.FC<FeatureIntroModalProps> = ({ onClose }) => {
	return (
		<div className="feature-intro-modal">
			<div className="modal-header">
				<p>{FEATURE_ANNOUNCEMENT.description}</p>
			</div>

			<div className="features-grid" role="region" aria-label="Release notes" tabIndex={0}>
				{FEATURE_ANNOUNCEMENT.releases.map((release) => (
					<section key={release.version} className="feature-card">
						<div className="feature-content">
							<span className="release-version">{release.version}</span>
							<h3>{release.title}</h3>
							<ul>
								{release.notes.map((note) => <li key={note}>{note}</li>)}
							</ul>
						</div>
					</section>
				))}
			</div>

			<div className="modal-footer">
				<p>Open “Geulo: What's new” from the command palette to read this again.</p>
				<button className="mod-cta" onClick={onClose}>
					Got it
				</button>
			</div>
		</div>
	);
};

export class FeatureIntroModal extends Modal {
	private root: Root | null = null;

	constructor(app: App, private readonly onDismiss: () => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.modalEl.addClass('geulo-release-notes');
		this.setTitle(FEATURE_ANNOUNCEMENT.title);
		contentEl.addClass('feature-intro-modal-container');

		this.root = createRoot(contentEl);
		this.root.render(
			<FeatureIntroModalContent onClose={() => this.close()} />
		);
	}

	onClose(): void {
		if (this.root) {
			this.root.unmount();
			this.root = null;
			this.onDismiss();
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}
