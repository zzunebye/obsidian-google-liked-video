import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, Settings, SlidersHorizontal } from 'lucide-react';

interface Props {
	speed: number;
	volume: number;
	onSpeedChange: (speed: number) => void;
	onVolumeChange: (volume: number) => void;
	canRegenerate: boolean;
	onRegenerate: () => void;
	onOpenSettings: () => void;
}

export function SpeechPlaybackOptions({ speed, volume, onSpeedChange, onVolumeChange, canRegenerate, onRegenerate, onOpenSettings }: Props) {
	const id = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ left: 0, top: 0 });

	useEffect(() => {
		const trigger = triggerRef.current;
		const popover = popoverRef.current;
		if (!isOpen || !trigger || !popover) return;
		const ownerDocument = trigger.ownerDocument;
		const dismissOutside = (event: PointerEvent): void => {
			const path = event.composedPath();
			if (!path.includes(trigger) && !path.includes(popover)) setIsOpen(false);
		};
		const dismissOnEscape = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape' || event.isComposing) return;
			event.preventDefault();
			event.stopPropagation();
			setIsOpen(false);
			trigger.focus();
		};
		ownerDocument.addEventListener('pointerdown', dismissOutside);
		ownerDocument.addEventListener('keydown', dismissOnEscape, true);
		return () => {
			ownerDocument.removeEventListener('pointerdown', dismissOutside);
			ownerDocument.removeEventListener('keydown', dismissOnEscape, true);
		};
	}, [isOpen]);

	useLayoutEffect(() => {
		const trigger = triggerRef.current;
		const popover = popoverRef.current;
		if (!isOpen || !trigger || !popover) return;
		const ownerWindow = trigger.ownerDocument.defaultView ?? window;
		const updatePosition = (): void => {
			const anchor = trigger.getBoundingClientRect();
			const card = popover.getBoundingClientRect();
			const top = anchor.bottom + card.height + 6 > ownerWindow.innerHeight - 12
				? anchor.top - card.height - 6 : anchor.bottom + 6;
			setPosition({
				left: Math.max(12, Math.min(anchor.right - card.width, ownerWindow.innerWidth - card.width - 12)),
				top: Math.max(12, Math.min(top, ownerWindow.innerHeight - card.height - 12)),
			});
		};
		updatePosition();
		popover.querySelector('select')?.focus();
		ownerWindow.addEventListener('resize', updatePosition);
		ownerWindow.addEventListener('scroll', updatePosition, true);
		return () => {
			ownerWindow.removeEventListener('resize', updatePosition);
			ownerWindow.removeEventListener('scroll', updatePosition, true);
		};
	}, [isOpen]);

	return <>
		<button ref={triggerRef} type="button" title="Speech playback options" aria-label="Speech playback options" aria-haspopup="dialog"
			aria-expanded={isOpen} aria-controls={isOpen ? id : undefined} onClick={() => setIsOpen(value => !value)}>
			<SlidersHorizontal size={16} aria-hidden="true" />
		</button>
		{isOpen && triggerRef.current && createPortal(
			<div ref={popoverRef} id={id} className="geulo-speech-options" role="dialog" aria-label="Speech playback options" style={position}
				onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
				<strong>Playback options</strong>
				<label htmlFor={`${id}-speed`}>Speed
					<select id={`${id}-speed`} value={speed} onChange={event => onSpeedChange(Number(event.target.value))}>
						{[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}
					</select>
				</label>
				<label htmlFor={`${id}-volume`}>Volume <span>{Math.round(volume * 100)}%</span></label>
				<input id={`${id}-volume`} type="range" min="0" max="1" step="0.05" value={volume}
					aria-valuetext={`${Math.round(volume * 100)}%`} onChange={event => onVolumeChange(Number(event.target.value))} />
				<div className="geulo-speech-options__regenerate">
					<button type="button" disabled={!canRegenerate} onClick={() => {
						setIsOpen(false);
						triggerRef.current?.focus();
						onRegenerate();
					}}><RefreshCw size={14} aria-hidden="true" />Regenerate speech</button>
					<small>Replace saved audio using the current speech model and voice.</small>
					<button type="button" onClick={() => {
						setIsOpen(false);
						onOpenSettings();
					}}><Settings size={14} aria-hidden="true" />Speech settings</button>
				</div>
			</div>, triggerRef.current.ownerDocument.body,
		)}
	</>;
}
