import { Component, Notice, Platform } from 'obsidian';
import type { App, WorkspaceLeaf } from 'obsidian';
import { debugLogger } from 'src/debug';
import { transcriptService, TranscriptServiceError } from './transcriptService';
import type { TranscriptProgressCallback, TranscriptProgressPhase, VideoTranscript } from './transcriptService';
import { readWebViewerTranscript, videoIdFromUrl } from './webViewerTranscriptService';

interface RecoveryRequest {
	controller: AbortController;
	promise: Promise<VideoTranscript>;
	consumers: number;
	phase?: TranscriptProgressPhase;
	progressCallbacks: Set<TranscriptProgressCallback>;
}

interface LoadingWebview extends HTMLElement {
	getURL(): string;
	executeJavaScript(code: string): Promise<unknown>;
}

const RECOVERY_TIMEOUT_MS = 25000;
const abortError = (): DOMException => new DOMException('Request aborted', 'AbortError');

export class WebViewerTranscriptRecovery extends Component {
	private readonly pending = new Map<string, RecoveryRequest>();
	private active = false;

	constructor(private readonly app: App) { super(); }

	onload(): void {
		if (Platform.isMobile) return;
		this.active = true;
		this.register(transcriptService.registerWebViewerFallback((videoId, signal, onProgress) => this.getTranscript(videoId, signal, onProgress)));
	}

	onunload(): void {
		this.active = false;
		for (const request of this.pending.values()) request.controller.abort();
		this.pending.clear();
	}

	private async getTranscript(videoId: string, signal?: AbortSignal, onProgress?: TranscriptProgressCallback): Promise<VideoTranscript> {
		if (!this.active || signal?.aborted) throw abortError();
		let request = this.pending.get(videoId);
		if (!request) {
			const controller = new AbortController();
			const progressCallbacks = new Set<TranscriptProgressCallback>();
			const emitProgress = (phase: TranscriptProgressPhase): void => {
				created.phase = phase;
				for (const callback of progressCallbacks) callback(phase);
			};
			const created: RecoveryRequest = {
				controller,
				consumers: 0,
				progressCallbacks,
				promise: Promise.resolve().then(() => this.recover(videoId, controller, emitProgress)),
			};
			request = created;
			this.pending.set(videoId, request);
		}
		const shared = request;
		shared.consumers++;
		if (onProgress) {
			shared.progressCallbacks.add(onProgress);
			if (shared.phase) onProgress(shared.phase);
		}
		let onAbort = (): void => {};
		const canceled = new Promise<never>((_, reject) => {
			onAbort = () => reject(abortError());
			signal?.addEventListener('abort', onAbort, { once: true });
		});
		try {
			return await Promise.race([shared.promise, canceled]);
		} finally {
			signal?.removeEventListener('abort', onAbort);
			if (onProgress) shared.progressCallbacks.delete(onProgress);
			// A closed reader must not cancel another reader or summary using this job.
			if (--shared.consumers === 0) {
				shared.controller.abort();
				if (this.pending.get(videoId) === shared) this.pending.delete(videoId);
			}
		}
	}

	private async recover(videoId: string, controller: AbortController, onProgress: TranscriptProgressCallback): Promise<VideoTranscript> {
		const signal = controller.signal;
		if (signal.aborted) throw abortError();
		const loading = new Notice('Geulo: Loading captions from YouTube in Web Viewer…', 0);
		let timedOut = false;
		const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, RECOVERY_TIMEOUT_MS);
		let onAbort = (): void => {};
		const stopped = new Promise<never>((_, reject) => {
			onAbort = () => reject(abortError());
			signal.addEventListener('abort', onAbort, { once: true });
		});
		try {
			const transcript = await Promise.race([this.loadTranscript(videoId, signal, onProgress), stopped]);
			if (signal.aborted) throw abortError();
			if (!transcript) throw new Error('Full YouTube transcript could not be verified');
			debugLogger.info('[Web Viewer] Verified full transcript', {
				videoId, language: transcript.language, segments: transcript.segments.length,
				firstStart: transcript.segments[0]?.start, lastStart: transcript.segments[transcript.segments.length - 1]?.start,
			});
			return transcript;
		} catch (error: unknown) {
			if (signal.aborted && !timedOut) throw abortError();
			debugLogger.warn('[Web Viewer] Could not load the full transcript', videoId, error);
			throw new TranscriptServiceError('blocked', 'Could not load the full transcript. Check that Web Viewer is enabled, open Show transcript on the YouTube page, and sign in if YouTube asks. Then retry in Geulo.');
		} finally {
			window.clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
			loading.hide();
		}
	}

	private async loadTranscript(videoId: string, signal: AbortSignal, onProgress: TranscriptProgressCallback): Promise<VideoTranscript | null> {
		const workspace = this.app.workspace;
		let leaf = workspace.getLeavesOfType('webviewer').find(candidate => {
			try {
				const viewer = candidate.view.containerEl.querySelector('webview') as Partial<LoadingWebview> | null;
				return videoIdFromUrl(viewer?.getURL?.() || candidate.view.getState().url) === videoId;
			} catch { return false; }
		});
		if (signal.aborted) throw abortError();
		if (!leaf) {
			onProgress('opening-youtube');
			leaf = workspace.getLeaf('split');
			await leaf.setViewState({
				type: 'webviewer', state: { url: `https://www.youtube.com/watch?v=${videoId}`, navigate: true }, active: false,
			});
		}
		if (signal.aborted) throw abortError();
		await leaf.loadIfDeferred();
		if (signal.aborted) throw abortError();
		if (leaf.view.getViewType() !== 'webviewer') throw new Error('Web Viewer is unavailable');
		await this.waitForPage(leaf, videoId, signal);
		if (signal.aborted) throw abortError();
		onProgress('reading-captions');
		return readWebViewerTranscript(leaf.view, videoId, signal);
	}

	private waitForPage(leaf: WorkspaceLeaf, videoId: string, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			let checking = false;
			let finished = false;
			const finish = (error?: Error): void => {
				if (finished) return;
				finished = true;
				window.clearInterval(timer);
				signal.removeEventListener('abort', onAbort);
				if (error) reject(error); else resolve();
			};
			const onAbort = (): void => finish(abortError());
			const check = async (): Promise<void> => {
				if (checking || finished) return;
				if (signal.aborted) { onAbort(); return; }
				if (!this.app.workspace.getLeavesOfType('webviewer').includes(leaf)) {
					finish(new Error('Web Viewer was closed')); return;
				}
				checking = true;
				try {
					const viewer = leaf.view.containerEl.querySelector('webview') as Partial<LoadingWebview> | null;
					if (typeof viewer?.getURL !== 'function' || typeof viewer.executeJavaScript !== 'function') return;
					const url = viewer.getURL();
					if (!url || url === 'about:blank') return;
					if (videoIdFromUrl(url) !== videoId) { finish(new Error('YouTube navigated away from the requested video')); return; }
					const ready = await viewer.executeJavaScript('document.readyState');
					if (ready === 'interactive' || ready === 'complete') finish();
				} catch { /* The guest can exist before its first dom-ready event. */ }
				finally { checking = false; }
			};
			const timer = window.setInterval(() => void check(), 100);
			signal.addEventListener('abort', onAbort, { once: true });
			void check();
		});
	}
}
