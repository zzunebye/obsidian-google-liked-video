import { Component, MarkdownRenderer, Notice } from 'obsidian';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pause, Play, Square, Volume2 } from 'lucide-react';
import { debugLogger } from 'src/debug';
import { generateSpeech, SpeechServiceError, splitSpeechText, validateSpeechSettings } from 'src/services/speechService';
import { SpeechStorageService } from 'src/services/speechStorageService';
import { usePlugin } from 'src/store/pluginContext';
import { SpeechPlaybackOptions } from './SpeechPlaybackOptions';

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export function SummarySpeechButton({ summary, disabled }: { summary: string | null; disabled: boolean }) {
	const plugin = usePlugin();
	const buttonRef = useRef<HTMLButtonElement>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const controllerRef = useRef<AbortController | null>(null);
	const urlsRef = useRef<string[]>([]);
	const chunksRef = useRef<string[]>([]);
	const cacheKeysRef = useRef<string[]>([]);
	const storage = useMemo(() => new SpeechStorageService(plugin.app.vault.adapter,
		plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`), [plugin]);
	const [state, setState] = useState<PlaybackState>('idle');
	const stateRef = useRef<PlaybackState>('idle');
	const [settings, setSettings] = useState(() => ({ ...plugin.settings }));
	const [speed, setSpeed] = useState(1);
	const [volume, setVolume] = useState(1);
	const optionsRef = useRef({ speed: 1, volume: 1 });
	const updateState = (value: PlaybackState): void => { stateRef.current = value; setState(value); };

	useEffect(() => plugin.subscribeSettings(() => setSettings({ ...plugin.settings })), [plugin]);

	const stop = (): void => {
		controllerRef.current?.abort();
		controllerRef.current = null;
		const audio = audioRef.current;
		if (audio) {
			audio.onended = null;
			audio.onerror = null;
			audio.pause();
			audio.removeAttribute('src');
			audio.load();
		}
		audioRef.current = null;
	};
	const clearAudio = (): void => {
		stop();
		urlsRef.current.forEach(url => URL.revokeObjectURL(url));
		urlsRef.current = [];
		chunksRef.current = [];
		cacheKeysRef.current = [];
	};

	useEffect(() => {
		clearAudio();
		updateState('idle');
		return clearAudio;
	}, [summary]);

	useEffect(() => {
		if (disabled) { stop(); updateState('idle'); }
	}, [disabled]);

	const reportError = (error: unknown, controller: AbortController): void => {
		if (controller.signal.aborted) return;
		const message = error instanceof SpeechServiceError ? error.message : 'Could not play speech. Please try again.';
		debugLogger.error('[Speech] Playback failed', message);
		stop();
		updateState('idle');
		new Notice(message);
	};

	const playChunk = async (index: number, controller: AbortController): Promise<void> => {
		try {
			if (controller.signal.aborted) return;
			if (index >= chunksRef.current.length) {
				stop();
				updateState('idle');
				return;
			}
			updateState('loading');
			if (!urlsRef.current[index]) {
				const key = await storage.getKey(chunksRef.current[index]);
				if (controller.signal.aborted) return;
				cacheKeysRef.current[index] = key;
				let blob = await storage.read(key);
				if (controller.signal.aborted) return;
				if (!blob) {
					blob = await generateSpeech(chunksRef.current[index], settings, controller.signal);
					if (controller.signal.aborted) return;
					try { await storage.write(key, blob); }
					catch {
						if (!controller.signal.aborted) new Notice('Speech is ready, but could not be saved for later playback. Check vault storage permissions.');
					}
				}
				if (controller.signal.aborted) return;
				urlsRef.current[index] = URL.createObjectURL(blob);
			}
			const audio = audioRef.current;
			if (!audio || controller.signal.aborted) return;
			audio.src = urlsRef.current[index];
			audio.playbackRate = optionsRef.current.speed;
			audio.volume = optionsRef.current.volume;
			audio.onended = () => { void playChunk(index + 1, controller); };
			audio.onerror = () => {
				URL.revokeObjectURL(urlsRef.current[index]);
				urlsRef.current[index] = '';
				const key = cacheKeysRef.current[index];
				if (key) void storage.remove(key).catch(() => debugLogger.error('[Speech] Could not remove invalid cached audio'));
				reportError(new SpeechServiceError('audio', 'Could not decode speech audio. Check the speech model and try again.'), controller);
			};
			await audio.play();
			if (!controller.signal.aborted) updateState('playing');
		} catch (error: unknown) { reportError(error, controller); }
	};

	const toggle = async (regenerate = false): Promise<void> => {
		if (disabled || !summary) return;
		if (regenerate) {
			try { validateSpeechSettings(settings); }
			catch (error: unknown) {
				new Notice(error instanceof Error ? error.message : 'Check your speech settings.');
				return;
			}
			clearAudio();
		}
		if (!regenerate && stateRef.current === 'loading') { stop(); updateState('idle'); return; }
		if (!regenerate && stateRef.current === 'playing') { audioRef.current?.pause(); updateState('paused'); return; }
		if (!regenerate && stateRef.current === 'paused') {
			const controller = controllerRef.current;
			if (!controller) return;
			updateState('loading');
			try {
				await audioRef.current?.play();
				if (!controller.signal.aborted) updateState('playing');
			} catch (error: unknown) { reportError(error, controller); }
			return;
		}
		const ownerDocument = buttonRef.current?.ownerDocument;
		if (!ownerDocument) return;
		const controller = new AbortController();
		controllerRef.current = controller;
		updateState('loading');
		try {
			if (!chunksRef.current.length) {
				const component = new Component();
				component.load();
				const rendered = ownerDocument.body.createDiv();
				rendered.detach();
				try {
					await MarkdownRenderer.render(plugin.app, summary, rendered, '', component);
					if (controller.signal.aborted) return;
					rendered.querySelectorAll('script, style, img, svg, audio, video, button').forEach(el => el.remove());
					rendered.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr, pre, br').forEach(el => el.append('\n'));
					rendered.querySelectorAll('td, th').forEach(el => el.append(' '));
					chunksRef.current = splitSpeechText(rendered.textContent ?? '');
				} finally { component.unload(); }
			}
			if (!chunksRef.current.length) throw new SpeechServiceError('audio', 'This summary has no text to read aloud.');
			if (regenerate) {
				const keys = await Promise.all(chunksRef.current.map(text => storage.getKey(text)));
				if (controller.signal.aborted) return;
				await Promise.all(keys.map(key => storage.remove(key)));
				if (controller.signal.aborted) return;
			}
			audioRef.current = ownerDocument.body.createEl('audio');
			audioRef.current.detach();
			await playChunk(0, controller);
		} catch (error: unknown) { reportError(error, controller); }
	};

	const label = state === 'loading' ? 'Cancel speech generation' : state === 'playing' ? 'Pause speech'
		: state === 'paused' ? 'Resume speech' : 'Read summary aloud';
	return <div className="geulo-summary-speech" role="group" aria-label="Summary speech">
		<button ref={buttonRef} type="button" aria-label={label} disabled={disabled || !summary} onClick={() => void toggle()}>
			{state === 'loading' ? <Loader2 size={16} className="geulo-summary-speech__spinner" aria-hidden="true" />
				: state === 'playing' ? <Pause size={16} aria-hidden="true" />
					: state === 'paused' ? <Play size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
			<span aria-live="polite">{state === 'loading' ? 'Preparing…' : state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Read aloud'}</span>
		</button>
		{(state === 'playing' || state === 'paused') && <button type="button" aria-label="Stop speech" onClick={() => { stop(); updateState('idle'); }}><Square size={14} aria-hidden="true" /></button>}
		<SpeechPlaybackOptions speed={speed} volume={volume}
			onOpenSettings={() => {
				if (!plugin.settingTabRef?.openSpeechSettings()) new Notice('Open Settings > Geulo > Speech to configure speech.');
			}}
			canRegenerate={!!summary && !disabled && state !== 'loading'} onRegenerate={() => void toggle(true)} onSpeedChange={value => {
			optionsRef.current.speed = value;
			setSpeed(value);
			if (audioRef.current) audioRef.current.playbackRate = value;
		}} onVolumeChange={value => {
			optionsRef.current.volume = value;
			setVolume(value);
			if (audioRef.current) audioRef.current.volume = value;
		}} />
	</div>;
}
