import type { EpochCanvas } from "../epoch-canvas";
import { getEpochMarkColorGroups, normalizeMarkColorIndex } from "../mark-colors";

type MarkEntry = {
	file?: string;
	markColor?: number | null;
};

type ScrollNavCanvasState = {
	plugin?: {
		__epochInheritedMarkIndexByPath?: Map<string, number>;
		__epochInheritedMarkSourceByPath?: Map<string, string>;
	};
	index?: Record<string, MarkEntry[]>;
};

export function getInheritedMarkIndexByPath(canvas: EpochCanvas): Map<string, number> | null {
	try {
		const c = canvas as unknown as ScrollNavCanvasState;
		const map = c.plugin?.__epochInheritedMarkIndexByPath;
		return map instanceof Map ? map : null;
	} catch {
		return null;
	}
}

export function getInheritedMarkSourceByPath(canvas: EpochCanvas): Map<string, string> | null {
	try {
		const c = canvas as unknown as ScrollNavCanvasState;
		const map = c.plugin?.__epochInheritedMarkSourceByPath;
		return map instanceof Map ? map : null;
	} catch {
		return null;
	}
}

export function normalizeNonEpochPath(path: string | null | undefined): string | null {
	const p = String(path ?? "");
	if (!p) return null;
	if (p.startsWith("epoch://")) return null;
	return p;
}

export function getExplicitMarkIndexForPath(canvas: EpochCanvas, filePath: string): number | null {
	const c = canvas as unknown as ScrollNavCanvasState;
	const index = c.index;
	if (!index || typeof index !== "object") return null;
	for (const dateKey of Object.keys(index)) {
		const list = index[dateKey];
		if (!Array.isArray(list) || list.length === 0) continue;
		for (const entry of list) {
			if (!entry) continue;
			const file = String(entry.file ?? "");
			if (file !== filePath) continue;
			const idx = normalizeMarkColorIndex(entry.markColor);
			if (idx) return idx;
		}
	}
	return null;
}

export function getMarkColorGroupIndexSet(root: HTMLElement | null, idx: number): Set<number> | null {
	const base = normalizeMarkColorIndex(idx);
	if (!base) return null;
	if (!root) return null;
	const groups = getEpochMarkColorGroups(root);
	for (const g of groups) {
		const indices = [g.base.index, ...g.shades.map((s) => s.index)];
		if (indices.includes(base)) {
			return new Set(indices);
		}
	}
	return null;
}

export function getExplicitMarkPathsInGroup(canvas: EpochCanvas, groupSet: Set<number>): string[] {
	const c = canvas as unknown as ScrollNavCanvasState;
	const out: string[] = [];
	const seen = new Set<string>();
	const index = c.index;
	if (!index || typeof index !== "object") return out;
	for (const dateKey of Object.keys(index)) {
		const list = index[dateKey];
		if (!Array.isArray(list) || list.length === 0) continue;
		for (const entry of list) {
			if (!entry) continue;
			const file = String(entry.file ?? "");
			if (!file || file.startsWith("epoch://")) continue;
			const idx = normalizeMarkColorIndex(entry.markColor);
			if (!idx) continue;
			if (!groupSet.has(idx)) continue;
			if (seen.has(file)) continue;
			seen.add(file);
			out.push(file);
		}
	}
	return out;
}
