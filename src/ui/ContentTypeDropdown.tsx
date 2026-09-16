import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { UI_TEXT } from "src/constants/uiText";
import type { ContentTypeOption, ContentTypeSelection } from "src/types";

interface ContentTypeDropdownProps {
	selection: ContentTypeSelection;
	onChange: (selection: ContentTypeSelection) => void;
	shortVideoMaxDurationSeconds: number;
}

export const ContentTypeDropdown = ({
	selection,
	onChange,
	shortVideoMaxDurationSeconds,
}: ContentTypeDropdownProps) => {
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ left: 0, top: 0 });
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const options = [
		{ value: "videos", label: UI_TEXT.CONTENT_TYPE_VIDEOS, description: UI_TEXT.TOOLTIP_VIDEOS(shortVideoMaxDurationSeconds) },
		{ value: "shorts", label: UI_TEXT.CONTENT_TYPE_SHORTS, description: UI_TEXT.TOOLTIP_SHORTS(shortVideoMaxDurationSeconds) },
		{ value: "music", label: UI_TEXT.CONTENT_TYPE_MUSIC, description: UI_TEXT.TOOLTIP_MUSIC },
	] as const;
	const isAll = selection.length === 0 || selection.length === options.length;
	const label = isAll
		? "All"
		: options.filter((option) => selection.includes(option.value)).map((option) => option.label).join(" + ");

	useEffect(() => {
		if (!isOpen || !triggerRef.current) return;
		const ownerDocument = triggerRef.current.ownerDocument;
		const handlePointerDown = (event: PointerEvent): void => {
			if (
				!triggerRef.current?.contains(event.target as Node) &&
				!menuRef.current?.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};
		const handleEscape = (event: globalThis.KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setIsOpen(false);
			triggerRef.current?.focus();
		};
		ownerDocument.addEventListener("pointerdown", handlePointerDown);
		ownerDocument.addEventListener("keydown", handleEscape, true);
		return () => {
			ownerDocument.removeEventListener("pointerdown", handlePointerDown);
			ownerDocument.removeEventListener("keydown", handleEscape, true);
		};
	}, [isOpen]);

	useLayoutEffect(() => {
		if (!isOpen || !triggerRef.current) return;
		const ownerWindow = triggerRef.current.ownerDocument.defaultView ?? window;
		const updatePosition = (): void => {
			const trigger = triggerRef.current?.getBoundingClientRect();
			const menu = menuRef.current?.getBoundingClientRect();
			if (!trigger || !menu) return;
			const padding = 12;
			const gap = 6;
			const maxLeft = Math.max(padding, ownerWindow.innerWidth - menu.width - padding);
			const maxTop = Math.max(padding, ownerWindow.innerHeight - menu.height - padding);
			const top = trigger.bottom + gap > maxTop && trigger.top >= menu.height + gap + padding
				? trigger.top - menu.height - gap
				: trigger.bottom + gap;
			setPosition({
				left: Math.min(Math.max(trigger.left, padding), maxLeft),
				top: Math.min(Math.max(top, padding), maxTop),
			});
		};
		updatePosition();
		ownerWindow.addEventListener("resize", updatePosition);
		ownerWindow.addEventListener("scroll", updatePosition, true);
		return () => {
			ownerWindow.removeEventListener("resize", updatePosition);
			ownerWindow.removeEventListener("scroll", updatePosition, true);
		};
	}, [isOpen, label]);

	useLayoutEffect(() => {
		if (isOpen) {
			menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
		}
	}, [isOpen]);

	const toggleType = (type: ContentTypeOption): void => {
		const selected = isAll ? [] : selection;
		const next = selected.includes(type)
			? selected.filter((value) => value !== type)
			: [...selected, type];
		onChange(next.length === options.length ? [] : next);
	};

	const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (event.key === "Tab") {
			setIsOpen(false);
			triggerRef.current?.focus();
			return;
		}
		const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ?? []);
		const current = items.findIndex((item) => item === item.ownerDocument.activeElement);
		let next: number;
		switch (event.key) {
			case "ArrowDown": next = (current + 1) % items.length; break;
			case "ArrowUp": next = (current - 1 + items.length) % items.length; break;
			case "Home": next = 0; break;
			case "End": next = items.length - 1; break;
			default: return;
		}
		event.preventDefault();
		event.stopPropagation();
		items[next]?.focus();
	};

	return (
		<div className={`liked-video-filter ${!isAll ? "liked-video-filter--active" : ""}`}>
			<span id={`${menuId}-label`} className="liked-video-filter__label">Type</span>
			<button
				ref={triggerRef}
				type="button"
				className="liked-video-filter__control content-type-dropdown__trigger"
				aria-labelledby={`${menuId}-label ${menuId}-value`}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-controls={isOpen ? menuId : undefined}
				onClick={() => setIsOpen((open) => !open)}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setIsOpen(true);
					}
				}}
			>
				<span id={`${menuId}-value`} className="liked-video-filter__value">{label}</span>
				<ChevronDown className="liked-video-filter__chevron" size={16} aria-hidden="true" />
			</button>
			{isOpen && triggerRef.current && createPortal(
				<div
					ref={menuRef}
					id={menuId}
					className="content-type-dropdown__menu"
					role="menu"
					aria-label="Content type"
					style={position}
					onKeyDown={handleMenuKeyDown}
				>
					<div className="content-type-dropdown__heading" role="presentation">Content type</div>
					<button type="button" role="menuitemcheckbox" aria-checked={isAll} tabIndex={-1} onClick={() => onChange([])}>
						<Check size={16} aria-hidden="true" />
						All
					</button>
					<div className="content-type-dropdown__separator" role="separator" />
					{options.map((option) => (
						<button
							key={option.value}
							type="button"
							role="menuitemcheckbox"
							aria-checked={!isAll && selection.includes(option.value)}
							tabIndex={-1}
							title={option.description}
							onClick={() => toggleType(option.value)}
						>
							<Check size={16} aria-hidden="true" />
							{option.label}
						</button>
					))}
				</div>,
				triggerRef.current.ownerDocument.body,
			)}
		</div>
	);
};
