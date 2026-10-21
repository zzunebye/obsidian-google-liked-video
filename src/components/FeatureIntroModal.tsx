import { App, Modal } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import { t } from '../i18n';

export const LEGACY_ANNOUNCEMENT_ID = 'ai-summaries-intro';

export const FEATURE_ANNOUNCEMENT = {
	id: '5-2-0',
	title: 'Geulo update notes',
	description: 'Check connections, recover blocked transcripts, and choose vault folders more easily. Earlier updates are included below.',
	releases: [
		{
			version: '5.2.0',
				title: 'announcement.520.title',
			notes: [
					'announcement.520.note1',
					'announcement.520.note2',
					'announcement.520.note3',
					'announcement.520.note4'
			]
		},
		{
			version: '5.0.0',
				title: 'announcement.500.title',
			notes: [
					'announcement.500.note1', 'announcement.500.note2', 'announcement.500.note3', 'announcement.500.note4',
					'announcement.500.note5', 'announcement.500.note6', 'announcement.500.note7', 'announcement.500.note8',
					'announcement.500.note9', 'announcement.500.note10', 'announcement.500.note11'
			]
		},
		{
			version: '4.3',
				title: 'announcement.430.title',
			notes: [
					'announcement.430.note1', 'announcement.430.note2'
			]
		},
		{
			version: '4.0–4.2.2',
				title: 'announcement.400.title',
			notes: [
					'announcement.400.note1', 'announcement.400.note2', 'announcement.400.note3', 'announcement.400.note4'
			]
		},
		{
			version: '3.4',
				title: 'announcement.340.title',
			notes: [
					'announcement.340.note1', 'announcement.340.note2', 'announcement.340.note3', 'announcement.340.note4',
					'announcement.340.note5', 'announcement.340.note6', 'announcement.340.note7'
			]
		},
		{
			version: '3.3.1',
				title: 'announcement.331.title',
			notes: [
					'announcement.331.note1', 'announcement.331.note2'
			]
		},
		{
			version: '3.3.0',
				title: 'announcement.330.title',
			notes: [
					'announcement.330.note1', 'announcement.330.note2', 'announcement.330.note3', 'announcement.330.note4'
			]
		},
		{
			version: '3.2.0',
				title: 'announcement.320.title',
			notes: [
					'announcement.320.note1', 'announcement.320.note2'
			]
		},
		{
			version: '3.1.0',
				title: 'announcement.310.title',
			notes: [
					'announcement.310.note1', 'announcement.310.note2', 'announcement.310.note3'
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
			<p>{t("announcement.description")}</p>
			</div>

			<div className="features-grid" role="region" aria-label={t("announcement.releaseNotes")} tabIndex={0}>
				{FEATURE_ANNOUNCEMENT.releases.map((release) => (
					<section key={release.version} className="feature-card">
						<div className="feature-content">
							<span className="release-version">{release.version}</span>
					<h3>{t(release.title)}</h3>
							<ul>
				{release.notes.map((note) => <li key={note}>{t(note)}</li>)}
							</ul>
						</div>
					</section>
				))}
			</div>

			<div className="modal-footer">
				<p>{t("announcement.reopenHelp")}</p>
				<button className="mod-cta" onClick={onClose}>
					{t("announcement.gotIt")}
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
		this.setTitle(t("announcement.title"));
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
