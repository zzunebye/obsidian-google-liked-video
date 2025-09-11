import { Modal } from 'obsidian';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';

interface FeatureIntroModalProps {
	onClose: () => void;
}

const FeatureIntroModalContent: React.FC<FeatureIntroModalProps> = ({ onClose }) => {
	const features = [
		{
			icon: '📝',
			title: 'Video Notes',
			description: 'Create dedicated notes for your favorite videos with structured templates and automatic metadata.'
		},
		{
			icon: '📋',
			title: 'Playlist Browsing',
			description: 'Browse and manage all your YouTube playlists directly within Obsidian, and add other playlists by ID/URL.'
		},
		{
			icon: '🎬',
			title: 'Playlist Video Management',
			description: 'View and search videos within specific playlists.'
		}
	];

	return (
		<div className="feature-intro-modal">
			<div className="modal-header">
				<h2>🎉 What's New in Geulo</h2>
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