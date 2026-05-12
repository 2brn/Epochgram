import type { EpochCanvas } from "../epoch-canvas";
import type { ScrollNavTarget } from "../epoch-canvas-types";

import { focusDate as focusDateHelper } from "../epoch-canvas-focus";
import { normalizeMarkColorIndex } from "../mark-colors";

import {
	getExplicitMarkIndexForPath,
	getExplicitMarkPathsInGroup,
	getInheritedMarkIndexByPath,
	getInheritedMarkSourceByPath,
	getMarkColorGroupIndexSet,
	normalizeNonEpochPath
} from "./scroll-nav-marks";
import { computeScrollNavTargets, computeVisibleScrollNavEntryTargets } from "./scroll-nav-targets";
import { advanceScrollNavEpochsView } from "./scroll-nav-advance-epochs";
import { advanceScrollNavVisibleDays } from "./scroll-nav-advance-visible-days";
import { advanceScrollNavSimilar } from "./scroll-nav-advance-similar";
import { advanceScrollNavEntries } from "./scroll-nav-advance-entries";
import { resetScrollNavTargetState } from "./scroll-nav-reset";

export function advanceScrollNav(canvas: EpochCanvas, direction: number = 1, options: { wrap?: boolean } = {}): boolean {
	const c: any = canvas as any;
	try {
		c.__suppressExternalAutoScrollUntil = performance.now() + 1000;
	} catch {
		// ignore
	}
	c.clearFocusedEpochRange();
	const prevPending = c.pendingScrollNavHighlight ?? null;
	if (prevPending) {
		c.pendingScrollNavHighlight = null;
	}
	const wrap = options.wrap === true;
	const searchActive = String(c.searchQuery || "").trim().length > 0;
	const epochsViewActive = c.epochsView === true;
	const hasActiveFile = !!normalizeNonEpochPath(c.activeFilePath ?? null);
	const useVisibleNav = searchActive || epochsViewActive || !hasActiveFile;
	const openedFile = c.activeFilePath ?? c.scrollNavFile ?? null;
	if (!useVisibleNav) {
		if (!openedFile) {
			resetScrollNavTargetState(canvas);
			return false;
		}
		if (c.scrollNavFile !== openedFile) {
			c.scrollNavFile = openedFile;
			resetScrollNavTargetState(canvas);
		}
	}
	const inheritedSourceByPath = getInheritedMarkSourceByPath(canvas);
	const inheritedAncestor = normalizeNonEpochPath(inheritedSourceByPath?.get(String(openedFile)) ?? null);
	const similarRootFile = inheritedAncestor || String(openedFile);
	const relatedList: string[] = [];
	const inheritedMarkIndexByPath = getInheritedMarkIndexByPath(canvas);
	const groupIdx = (() => {
		const root = normalizeNonEpochPath(similarRootFile);
		const opened = normalizeNonEpochPath(openedFile);
		if (!root && !opened) return null;
		if (root) {
			const explicitRoot = getExplicitMarkIndexForPath(canvas, root);
			if (explicitRoot) return explicitRoot;
		}
		if (opened) {
			const explicitOpened = getExplicitMarkIndexForPath(canvas, opened);
			if (explicitOpened) return explicitOpened;
		}
		if (!inheritedMarkIndexByPath) return null;
		if (root) {
			const v = normalizeMarkColorIndex(inheritedMarkIndexByPath.get(root) as any);
			if (v) return v;
		}
		if (opened) {
			const v = normalizeMarkColorIndex(inheritedMarkIndexByPath.get(opened) as any);
			if (v) return v;
		}
		return null;
	})();
	const markGroupPaths: string[] = (() => {
		if (!groupIdx) return [];
		const groupSet = getMarkColorGroupIndexSet(c.root ?? null, groupIdx);
		if (!groupSet) return [];
		const out = new Set<string>();
		const add = (p: string | null) => {
			const v = normalizeNonEpochPath(p);
			if (!v) return;
			out.add(v);
		};
		add(similarRootFile);
		add(openedFile);
		add(inheritedAncestor);
		if (inheritedMarkIndexByPath) {
			for (const [p, raw] of inheritedMarkIndexByPath.entries()) {
				const v = normalizeMarkColorIndex(raw as any);
				if (!v) continue;
				if (!groupSet.has(v)) continue;
				if (!p || p.startsWith("epoch://")) continue;
				add(p);
			}
		}
		for (const p of getExplicitMarkPathsInGroup(canvas, groupSet)) add(p);
		return Array.from(out);
	})();
	try {
		const base = String((c as any).semanticRelatedBasePath ?? c.activeFilePath ?? "");
		if (base && base === String(similarRootFile)) {
			const scored = Array.isArray(c.semanticRelatedScored) ? c.semanticRelatedScored : null;
			if (scored && scored.length > 0) {
				for (const s of scored) {
					const p = (s as any)?.path;
					if (typeof p === "string" && p) relatedList.push(p);
				}
			} else if (c.semanticRelatedPaths instanceof Set) {
				for (const p of c.semanticRelatedPaths) {
					if (typeof p === "string" && p) relatedList.push(p);
				}
			}
		}
	} catch {
		// ignore
	}
	const extraPaths = (() => {
		const out: string[] = [];
		const seen = new Set<string>();
		const add = (p: string | null) => {
			const v = normalizeNonEpochPath(p);
			if (!v) return;
			if (seen.has(v)) return;
			seen.add(v);
			out.push(v);
		};

		if (groupIdx) {
			const inGroup = new Set<string>(markGroupPaths);
			if (inheritedAncestor && inheritedAncestor !== openedFile) {
				add(inheritedAncestor);
			}
			for (const p of markGroupPaths) add(p);
			for (const p of relatedList) {
				const v = normalizeNonEpochPath(p);
				if (!v) continue;
				if (!inGroup.has(v)) continue;
				add(v);
			}
			return out;
		}
		if (inheritedAncestor && inheritedAncestor !== openedFile) {
			add(inheritedAncestor);
		}
		for (const p of markGroupPaths) add(p);
		for (const p of relatedList) add(p);
		return out;
	})();
	const isSimilarNav = !useVisibleNav && extraPaths.length > 0;
	const modeKey = epochsViewActive ? "epochs" : useVisibleNav ? "visible" : isSimilarNav ? "similar" : "entry";
	try {
		const prevMode = String((c as any).__scrollNavLastModeKey || "");
		if (prevMode && prevMode !== modeKey) {
			resetScrollNavTargetState(canvas);
		}
		(c as any).__scrollNavLastModeKey = modeKey;
	} catch {
		// ignore
	}
	const targets: Array<Extract<ScrollNavTarget, { kind: "entry" }>> = useVisibleNav
		? computeVisibleScrollNavEntryTargets(canvas)
		: computeScrollNavTargets(canvas, isSimilarNav ? [openedFile, ...extraPaths] : [openedFile]).filter(
			(target): target is Extract<ScrollNavTarget, { kind: "entry" }> => target.kind === "entry"
		);

	const rect = c.root.getBoundingClientRect();
	if (!Number.isFinite(rect.height) || rect.height <= 0) {
		c.pendingScrollNavHighlight = null;
		return false;
	}

	if (epochsViewActive) {
		return advanceScrollNavEpochsView({ canvas, c, direction, wrap, prevPending, rect });
	}
	if (useVisibleNav && !epochsViewActive) {
		return advanceScrollNavVisibleDays({ canvas, c, direction, wrap, prevPending, rect });
	}
	if (isSimilarNav) {
		return advanceScrollNavSimilar({ canvas, c, direction, wrap, prevPending, rect, targets });
	}

	// Default entry-based navigation.
	const ok = advanceScrollNavEntries({ canvas, c, direction, wrap, prevPending, rect, targets });
	if (ok) return true;

	// Keep existing behavior: in entry-nav mode, a successful step does not necessarily open the entry.
	// If a highlight is being processed separately, keep the view aligned with focusDate.
	try {
		if (c.pendingScrollNavHighlight?.date) {
			c.animatingView = true;
			focusDateHelper(canvas, c.pendingScrollNavHighlight.date, true, true, true);
		}
	} catch {
		// ignore
	}
	return false;
}
