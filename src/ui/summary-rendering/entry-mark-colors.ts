import type { DateEntry } from "../../indexer/types";
import { normalizeMarkColorIndex } from "../mark-colors";

function normalizeHex(value: unknown): string {
	const raw = typeof value === "string"
		? value.trim()
		: typeof value === "number"
			? String(value).trim()
			: "";
	if (!raw) return "";
	const hex = raw.startsWith("#") ? raw : `#${raw}`;
	if (!/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return "";
	return hex.toLowerCase();
}

export function getEntryMarkColor(
	entry: DateEntry,
	markColors: string[] | undefined,
	fallback: string
): string | null {
	const explicitHexRaw = typeof (entry as { markColorHex?: unknown }).markColorHex === "string"
		? String((entry as { markColorHex?: string }).markColorHex || "").trim()
		: "";
	const explicitHex = normalizeHex(explicitHexRaw);
	if (explicitHex) return explicitHex;
	if (explicitHexRaw) {
		const defaultColor = String(markColors?.[0] ?? "").trim();
		return defaultColor || fallback;
	}
	const idx = normalizeMarkColorIndex(entry.markColor);
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
	if (normalizeMarkColorIndex(entry.markColor)) return null;
	if (typeof (entry as { markColorHex?: unknown }).markColorHex === "string" && String((entry as { markColorHex?: string }).markColorHex || "").trim()) return null;
	const idx = normalizeMarkColorIndex(inheritedMarkIndexByPath.get(entry.file));
	if (!idx) return null;
	const c = markColors && markColors.length >= idx ? markColors[idx - 1] : null;
	return c && String(c).trim() ? c : fallback;
}
