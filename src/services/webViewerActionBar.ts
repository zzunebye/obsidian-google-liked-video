import { Component, setIcon, setTooltip } from 'obsidian';
import type { View } from 'obsidian';

export interface WebViewerAction {
	id: 'ai' | 'transcript' | 'note' | 'playlist';
	label: string;
	icon: string;
	section: 'geulo-video' | 'geulo-playlist';
	enabled: boolean;
	click: () => void;
}

export class WebViewerActionBar extends Component {
	private viewer: HTMLElement | null = null;
	private bar: HTMLElement | null = null;
	private detachViewer: (() => void) | null = null;
	private observer: MutationObserver | null = null;
	private fullscreen = false;
	private readonly buttons = new Map<WebViewerAction['id'], HTMLButtonElement>();

	constructor(private readonly view: View, private readonly getActions: () => WebViewerAction[]) {
		super();
	}

	onload(): void {
		this.observer = new MutationObserver(() => this.syncViewer());
		this.observer.observe(this.view.containerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
		this.syncViewer();
	}

	onunload(): void {
		this.observer?.disconnect();
		this.detachViewer?.();
		this.detachViewer = null;
		this.viewer = null;
		this.bar = null;
		this.buttons.clear();
	}

	private syncViewer(): void {
		const viewer = this.view.containerEl.querySelector<HTMLElement>('webview');
		if (viewer !== this.viewer) {
			this.detachViewer?.();
			this.detachViewer = null;
			this.viewer = viewer;
			this.bar = null;
			this.buttons.clear();
			this.fullscreen = false;
			const host = viewer?.parentElement;
			if (viewer && host) {
				host.classList.add('geulo-webviewer-host');
				const bar = host.createDiv({ cls: 'geulo-webviewer-actions' });
				bar.setAttribute('role', 'group');
				bar.setAttribute('aria-label', 'Geulo actions');
				bar.createSpan({ cls: 'geulo-webviewer-actions__brand', text: 'Geulo' });
				this.bar = bar;
				const refresh = (): void => this.refresh();
				const enterFullscreen = (): void => { this.fullscreen = true; this.refresh(); };
				const leaveFullscreen = (): void => { this.fullscreen = false; this.refresh(); };
				const navigationEvents = ['dom-ready', 'did-navigate', 'did-navigate-in-page', 'did-stop-loading'];
				for (const event of navigationEvents) viewer.addEventListener(event, refresh);
				viewer.addEventListener('enter-html-full-screen', enterFullscreen);
				viewer.addEventListener('leave-html-full-screen', leaveFullscreen);
				this.detachViewer = () => {
					for (const event of navigationEvents) viewer.removeEventListener(event, refresh);
					viewer.removeEventListener('enter-html-full-screen', enterFullscreen);
					viewer.removeEventListener('leave-html-full-screen', leaveFullscreen);
					bar.remove();
					host.classList.remove('geulo-webviewer-host');
				};
			}
		}
		this.refresh();
	}

	refresh(): void {
		const { bar, viewer } = this;
		if (!bar || !viewer) return;
		const actions = this.getActions();
		bar.hidden = this.fullscreen || actions.length === 0 || viewer.style.display === 'none';
		const ids = new Set(actions.map(action => action.id));
		for (const [id, button] of this.buttons) {
			if (!ids.has(id)) {
				button.remove();
				this.buttons.delete(id);
			}
		}
		for (const action of actions) {
			let button = this.buttons.get(action.id);
			if (!button) {
				button = bar.createEl('button', { cls: 'clickable-icon geulo-webviewer-actions__button', attr: { type: 'button' } });
				button.dataset.action = action.id;
				button.addEventListener('click', () => {
					const current = this.getActions().find(candidate => candidate.id === action.id);
					if (current?.enabled) current.click();
				});
				this.buttons.set(action.id, button);
			}
			if (button.getAttribute('aria-label') !== action.label) setTooltip(button, action.label, { placement: 'top' });
			if (button.dataset.icon !== action.icon) {
				setIcon(button, action.icon);
				button.dataset.icon = action.icon;
			}
			button.disabled = !action.enabled;
		}
		for (let index = 0; index < actions.length; index++) {
			const button = this.buttons.get(actions[index].id);
			if (button && bar.children[index + 1] !== button) bar.insertBefore(button, bar.children[index + 1] ?? null);
		}
	}
}
