import type { EpochCanvas } from "../epoch-canvas";
import { getEpochMarkColorGroups, normalizeMarkColorIndex } from "../mark-colors";

export function getInheritedMarkIndexByPath(canvas: EpochCanvas): Map<string, number> | null {
	try {
		const pluginAny: any = (canvas as any)?.plugin;
		const map = pluginAny?.__epochInheritedMarkIndexByPath as Map<string, number> | null | undefined;
		return map && typeof (map as any)?.get === "function" ? map : null;
	} catch {
		return null;
	}
}

export function getInheritedMarkSourceByPath(canvas: EpochCanvas): Map<string, string> | null {
	try {
		const pluginAny: any = (canvas as any)?.plugin;
		const map = pluginAny?.__epochInheritedMarkSourceByPath as Map<string, string> | null | undefined;
		return map && typeof (map as any)?.get === "function" ? map : null;
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
	const c: any = canvas as any;
	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return null;
	for (const dateKey of Object.keys(index)) {
		const list: any[] = index[dateKey];
		if (!Array.isArray(list) || list.length === 0) continue;
		for (const entry of list) {
			if (!entry) continue;
			const file = String((entry as any).file ?? "");
			if (file !== filePath) continue;
			const idx = normalizeMarkColorIndex((entry as any).markColor);
			if (idx) return idx;
		}
	}
	return null;
}

export function getMarkColorGroupIndexSet(root: HTMLElement | null, idx: number): Set<number> | null {
	const base = normalizeMarkColorIndex(idx);
	if (!base) return null;
	const groups = getEpochMarkColorGroups((root as any) ?? ({} as any));
	for (const g of groups) {
		const indices = [g.base.index, ...g.shades.map((s) => s.index)];
		if (indices.includes(base)) {
			return new Set(indices);
		}
	}
	return null;
}

export function getExplicitMarkPathsInGroup(canvas: EpochCanvas, groupSet: Set<number>): string[] {
	const c: any = canvas as any;
	const out: string[] = [];
	const seen = new Set<string>();
	const index: any = c.index ?? null;
	if (!index || typeof index !== "object") return out;
	for (const dateKey of Object.keys(index)) {
		const list: any[] = index[dateKey];
		if (!Array.isArray(list) || list.length === 0) continue;
		for (const entry of list) {
			if (!entry) continue;
			const file = String((entry as any).file ?? "");
			if (!file || file.startsWith("epoch://")) continue;
			const idx = normalizeMarkColorIndex((entry as any).markColor);
			if (!idx) continue;
			if (!groupSet.has(idx)) continue;
			if (seen.has(file)) continue;
			seen.add(file);
			out.push(file);
		}
	}
	return out;
}
