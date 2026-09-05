import { App, Modal } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';

export const LEGACY_ANNOUNCEMENT_ID = 'ai-summaries-intro';

export const FEATURE_ANNOUNCEMENT = {
	id: '3-4-update-notes',
	title: 'Geulo update notes',
	description: 'Key changes since 3.0, with tips on where to find them.',
	releases: [
		{
			version: '3.4',
			title: 'Faster browsing and safer local data',
			notes: [
				'Liked videos: infinite scroll renders the visible portion of the list and loads more as you scroll, reducing the rendering work for large collections.',
				'Settings: the Google connection section now shows “Connected to Google” or “Not connected to Google”, with controls that match your connection state.',
				'Liked videos are now stored in liked-videos.json, separately from plugin settings. Existing browser-stored data moves automatically only after the new file is written and verified.',
				'Before replacing the list, Geulo backs up the previous valid file as liked-videos.json.bak. If the main file is invalid, Geulo preserves it and stops loading instead of overwriting it with an empty list.',
				'When a synced liked-videos.json changes on another device, reload the plugin to refresh the in-memory list. This release does not merge conflicting file changes.'
			]
		},
		{
			version: '3.3.1',
			title: 'Google credential storage',
			notes: [
				'Google access tokens, refresh tokens, and the client secret now use Obsidian SecretStorage. Existing credentials move automatically when the plugin loads.',
				'This change applies to Google credentials; Gemini and OpenRouter API keys still use the existing plugin settings storage.'
			]
		},
		{
			version: '3.3.0',
			title: 'Video tags and page navigation',
			notes: [
				'Liked videos and playlists now show video tags. Click a tag to show videos with that exact tag; select another to replace the filter, or clear it to return to the full list.',
				'Cards show a compact selection of tags. Click +N to view the rest. You can hide tag chips in Settings → Show video tags.',
				'In liked videos, use View Mode → Pagination to navigate by page instead of scrolling.',
				'Requires Obsidian 1.11.4 or later.'
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
