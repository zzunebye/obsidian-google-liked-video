import { Modal } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';

interface FeatureIntroModalProps {
	onClose: () => void;
}

const FeatureIntroModalContent: React.FC<FeatureIntroModalProps> = ({ onClose }) => {
	const features = [
		{
			icon: '🤖',
			title: 'AI Video Summaries',
			description: 'Generate AI-powered summaries for your videos using Google Gemini or OpenRouter, with real-time streaming.'
		},
		{
			icon: '💬',
			title: 'Smart One-Liners',
			description: 'Automatic one-line summary generation after full summary, with expandable two-level view.'
		},
		{
			icon: '📝',
			title: 'Add Summary to Notes',
			description: 'Append AI summaries to your video notes, with context menu integration for quick access.'
		},
		{
			icon: '🔍',
			title: 'AI Note Filter',
			description: 'Filter your video list to show only videos that have AI-generated notes.'
		}
	];

	return (
		<div className="feature-intro-modal">
			<div className="modal-header">
				<h2>🎉 What's New in Geulo 3.0</h2>
				<p>Discover the latest features to enhance your YouTube video management experience!</p>
			</div>

			<div className="features-grid">
				{features.map((feature, index) => (
					<div key={index} className="feature-card">
						<div className="feature-icon">{feature.icon}</div>
						<div className="feature-content">
							<h5>{feature.title}</h5>
							<p>{feature.description}</p>
						</div>
					</div>
				))}
			</div>

			<div className="modal-footer">
				<p>Ready to explore these new features? Check out the plugin settings and ribbon icons!</p>
				<button className="mod-cta" onClick={onClose}>
					Get Started
				</button>
			</div>
		</div>
	);
};

export class FeatureIntroModal extends Modal {
	private root: Root | null = null;

	constructor(app: any) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('feature-intro-modal-container');

		this.root = createRoot(contentEl);
		this.root.render(
			<FeatureIntroModalContent onClose={() => this.close()} />
		);
	}

	onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}