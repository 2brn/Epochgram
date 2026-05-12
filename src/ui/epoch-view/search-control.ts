import { setIcon } from "obsidian";

import { SUMMARY_OFFSET_X, SUMMARY_RIGHT_MARGIN, TIMELINE_X } from "../epoch-canvas-constants";
import { setCssStyles } from "../../dom";

export function epochViewScheduleSearchControlLayout(view: any): void {
	try {
		if (view.searchControlLayoutRaf != null) return;
		view.searchControlLayoutRaf = window.requestAnimationFrame(() => {
			view.searchControlLayoutRaf = null;
			epochViewLayoutSearchControl(view);
		});
	} catch {
		// ignore
	}
}

export function epochViewScheduleSearchControlRefresh(view: any): void {
	try {
		if (view.searchControlRefreshRaf != null) return;
		view.searchControlRefreshRaf = window.requestAnimationFrame(() => {
			view.searchControlRefreshRaf = null;
			epochViewUpdateSearchControl(view);
		});
	} catch {
		// ignore
	}
}

export function epochViewLayoutSearchControl(view: any): void {
	try {
		if (!view.rootEl || !view.searchControlEl) return;
		const rootW = view.rootEl.getBoundingClientRect().width;
		if (!(rootW > 0)) return;

		const denseLeft = TIMELINE_X + SUMMARY_OFFSET_X;
		const denseRight = rootW - SUMMARY_RIGHT_MARGIN;
		const rightWidth = denseRight - denseLeft;
		if (!(rightWidth > 0)) {
			view.searchControlEl.style.removeProperty("max-width");
			view.searchControlEl.style.removeProperty("left");
			view.searchControlEl.style.removeProperty("transform");
			return;
		}

		view.searchControlEl.style.maxWidth = `${Math.floor(rightWidth)}px`;

		const elW = view.searchControlEl.getBoundingClientRect().width;
		if (!(elW > 0)) return;
		const desiredLeft = (rootW - elW) / 2;
		const minLeft = denseLeft;
		const maxLeft = denseRight - elW;
		const clampedLeft = Math.max(minLeft, Math.min(desiredLeft, maxLeft));
		view.searchControlEl.style.left = `${Math.floor(clampedLeft)}px`;
		setCssStyles(view.searchControlEl, { transform: "none" });
	} catch {
		// ignore
	}
}

export function epochViewUpdateSearchControl(view: any): void {
	const el = view.searchControlEl;
	if (!el) return;
	try {
		if (view.searchControlIconEl) {
			setIcon(view.searchControlIconEl, view.showEpochsView ? "hourglass" : "search");
		}
	} catch {
		// ignore
	}
	const q = String(view.searchQuery || "").trim();
	let label = "Search";
	if (!q) {
		const count = view.computeTimelineSearchResultCountAllDates?.("");
		if (typeof count === "number") {
			label = `${count} results`;
		}
	} else {
		const count = view.computeTimelineSearchResultCountAllDates?.(q);
		if (count == null) {
			label = q;
		} else if (count <= 0) {
			label = `${q} - no results`;
		} else {
			label = `${q} - ${count} results`;
		}
	}
	el.classList.toggle("is-active", !!q);
	if (view.searchControlTextEl) {
		view.searchControlTextEl.textContent = label;
		setCssStyles(view.searchControlTextEl, { display: "inline" });
	}
	epochViewScheduleSearchControlLayout(view);
}
