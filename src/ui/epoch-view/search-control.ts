import { setIcon } from "obsidian";

import { SUMMARY_OFFSET_X, SUMMARY_RIGHT_MARGIN, TIMELINE_X } from "../epoch-canvas-constants";
import { setCssStyles } from "../../dom";

interface SearchControlViewLike {
	rootEl: HTMLElement | null;
	searchControlEl: HTMLElement | null;
	searchControlTextEl: HTMLElement | null;
	searchControlIconEl: HTMLElement | null;
	searchControlLayoutRaf: number | null;
	searchControlRefreshRaf: number | null;
	searchQuery: string;
	showEpochsView: boolean;
	computeTimelineSearchResultCountAllDates?(qTrim: string): number | null;
}

export function epochViewScheduleSearchControlLayout(view: unknown): void {
	const state = view as SearchControlViewLike;
	try {
		if (state.searchControlLayoutRaf != null) return;
		state.searchControlLayoutRaf = window.requestAnimationFrame(() => {
			state.searchControlLayoutRaf = null;
			epochViewLayoutSearchControl(state);
		});
	} catch {
		// ignore
	}
}

export function epochViewScheduleSearchControlRefresh(view: unknown): void {
	const state = view as SearchControlViewLike;
	try {
		if (state.searchControlRefreshRaf != null) return;
		state.searchControlRefreshRaf = window.requestAnimationFrame(() => {
			state.searchControlRefreshRaf = null;
			epochViewUpdateSearchControl(state);
		});
	} catch {
		// ignore
	}
}

export function epochViewLayoutSearchControl(view: unknown): void {
	const state = view as SearchControlViewLike;
	try {
		if (!state.rootEl || !state.searchControlEl) return;
		const rootW = state.rootEl.getBoundingClientRect().width;
		if (!(rootW > 0)) return;

		const denseLeft = TIMELINE_X + SUMMARY_OFFSET_X;
		const denseRight = rootW - SUMMARY_RIGHT_MARGIN;
		const rightWidth = denseRight - denseLeft;
		if (!(rightWidth > 0)) {
			state.searchControlEl.style.removeProperty("max-width");
			state.searchControlEl.style.removeProperty("left");
			state.searchControlEl.style.removeProperty("transform");
			return;
		}

		state.searchControlEl.style.maxWidth = `${Math.floor(rightWidth)}px`;

		const elW = state.searchControlEl.getBoundingClientRect().width;
		if (!(elW > 0)) return;
		const desiredLeft = (rootW - elW) / 2;
		const minLeft = denseLeft;
		const maxLeft = denseRight - elW;
		const clampedLeft = Math.max(minLeft, Math.min(desiredLeft, maxLeft));
		state.searchControlEl.style.left = `${Math.floor(clampedLeft)}px`;
		setCssStyles(state.searchControlEl, { transform: "none" });
	} catch {
		// ignore
	}
}

export function epochViewUpdateSearchControl(view: unknown): void {
	const state = view as SearchControlViewLike;
	const el = state.searchControlEl;
	if (!el) return;
	try {
		if (state.searchControlIconEl) {
			setIcon(state.searchControlIconEl, state.showEpochsView ? "hourglass" : "search");
		}
	} catch {
		// ignore
	}
	const q = String(state.searchQuery || "").trim();
	let label = "Search";
	if (!q) {
		const count = state.computeTimelineSearchResultCountAllDates?.("");
		if (typeof count === "number") {
			label = `${count} results`;
		}
	} else {
		const count = state.computeTimelineSearchResultCountAllDates?.(q);
		if (count == null) {
			label = q;
		} else if (count <= 0) {
			label = `${q} - no results`;
		} else {
			label = `${q} - ${count} results`;
		}
	}
	el.classList.toggle("is-active", !!q);
	if (state.searchControlTextEl) {
		state.searchControlTextEl.textContent = label;
		setCssStyles(state.searchControlTextEl, { display: "inline" });
	}
	epochViewScheduleSearchControlLayout(state);
}
