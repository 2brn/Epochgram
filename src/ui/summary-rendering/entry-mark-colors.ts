import type { DateEntry } from "../../indexer/types";
import { normalizeMarkColorIndex } from "../mark-colors";

export function getEntryMarkColor(
	entry: DateEntry,
	markColors: string[] | undefined,
	fallback: string
): string | null {
	const idx = normalizeMarkColorIndex((entry as any)?.markColor);
	if (!idx) return null;
	const c = markColors && markColors.length >= idx ? markColors[idx - 1] : null;
	return c && String(c).trim() ? c : fallback;
}

export function getInheritedMarkColor(
	entry: DateEntry,
	markColors: string[] | undefined,
	fallback: string,
	inheritedMarkIndexByPath: Map<string, number> | null | undefined
): string | null {
	if (!inheritedMarkIndexByPath) return null;
	if (normalizeMarkColorIndex((entry as any)?.markColor)) return null;
	const idx = normalizeMarkColorIndex(inheritedMarkIndexByPath.get(entry.file) as any);
	if (!idx) return null;
	const c = markColors && markColors.length >= idx ? markColors[idx - 1] : null;
	return c && String(c).trim() ? c : fallback;
}
