import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { LikedVideoCollectionHandle } from "src/ui/LikedVideoCollection";

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

export function useLikedVideoFocus(enabled = true) {
	const viewRef = useRef<HTMLDivElement>(null);
	const entryRef = useRef<HTMLSpanElement>(null);
	const collectionRef = useRef<LikedVideoCollectionHandle>(null);
	const leavingList = useRef(false);
	const cardTabIndexes = useRef(new Map<HTMLElement, { attribute: string | null; value: number }>());

	const getSearch = () => viewRef.current?.querySelector<HTMLInputElement>(".search-bar input");
	const focusEntry = (): void => {
		if (!leavingList.current && !collectionRef.current?.focusEntry()) getSearch()?.focus();
	};
	const getControls = (root: HTMLElement): HTMLElement[] => {
		const ownerWindow = root.ownerDocument.defaultView;
		return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element =>
			(cardTabIndexes.current.get(element)?.value ?? element.tabIndex) >= 0 &&
			!element.matches(":disabled") && !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
			element.getClientRects().length > 0 && ownerWindow?.getComputedStyle(element).visibility !== "hidden");
	};
	const resumeTabFromListEntry = (): void => {
		leavingList.current = true;
		entryRef.current?.focus({ preventScroll: true });
		leavingList.current = false;
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
		const view = viewRef.current;
		const ownerWindow = view?.ownerDocument.defaultView;
		const target = event.target;
		if (!view || !ownerWindow || !(target instanceof ownerWindow.HTMLElement)) return;
		const card = target.closest<HTMLElement>(".video-card__container");
		const move = (element: HTMLElement | null | undefined) => {
			if (!element) return;
			event.preventDefault();
			event.stopPropagation();
			element.focus();
		};
		if (card) {
			if (event.key === "Escape" && target !== card) {
				move(card);
			} else if (event.key === "F2" && !event.shiftKey && target === card) {
				move(getControls(card)[0]);
			} else if (event.key === "Tab") {
				const controls = getControls(card);
				const index = controls.indexOf(target);
				if (target !== card && index >= 0 && controls[index + (event.shiftKey ? -1 : 1)]) {
					move(controls[index + (event.shiftKey ? -1 : 1)]);
				} else if (event.shiftKey && target !== card) {
					move(card);
				} else {
					resumeTabFromListEntry();
				}
			}
			return;
		}
	};

	useLayoutEffect(() => {
		if (!enabled) return;
		const view = viewRef.current;
		const grid = view?.querySelector<HTMLElement>(".video-view__video-grid");
		const scroller = view?.closest<HTMLElement>(".view-content");
		const ownerWindow = view?.ownerDocument.defaultView;
		if (!view || !grid || !scroller || !ownerWindow) return;
		const originalScrollerTabIndex = scroller.getAttribute("tabindex");
		scroller.tabIndex = -1;
		const indexes = cardTabIndexes.current;
		const restore = (element: HTMLElement, attribute: string | null) => {
			if (attribute === null) element.removeAttribute("tabindex");
			else element.setAttribute("tabindex", attribute);
		};
		const updateTabStops = () => {
			indexes.forEach((original, element) => {
				if (!grid.contains(element)) {
					restore(element, original.attribute);
					indexes.delete(element);
				}
			});
			grid.querySelectorAll<HTMLElement>(FOCUSABLE).forEach(element => {
				if (element.tabIndex < 0) return;
				indexes.set(element, { attribute: element.getAttribute("tabindex"), value: element.tabIndex });
				element.tabIndex = -1;
			});
		};
		const observer = new ownerWindow.MutationObserver(updateTabStops);
		observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ["tabindex"] });
		updateTabStops();
		const handleBackgroundClick = (event: PointerEvent) => {
			if (event.button === 0 && (event.target === scroller || event.target === view || event.target === grid)) {
				scroller.focus({ preventScroll: true });
			}
		};
		scroller.addEventListener("pointerdown", handleBackgroundClick);
		return () => {
			observer.disconnect();
			scroller.removeEventListener("pointerdown", handleBackgroundClick);
			restore(scroller, originalScrollerTabIndex);
			indexes.forEach((original, element) => restore(element, original.attribute));
			indexes.clear();
		};
	}, [enabled]);

	return { viewRef, entryRef, collectionRef, focusEntry, handleKeyDown };
}
