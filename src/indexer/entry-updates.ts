import { TFile } from "obsidian";
import { MAX_MARK_COLORS, getEpochMarkColorSet } from "../ui/mark-colors";
import { isTodayPinMode, normalizePinMode, type DateEntry, type FileIndexData } from "./types";
import { applyHighlightState } from "./entry-state";
import { setYamlPropertyForFile } from "../plugin/note-frontmatter";

interface EntryUpdatesState {
	files: Record<string, FileIndexData>;
	plugin: unknown;
	updateAggregatedEntries(path: string): void;
}
function state(indexer: unknown): EntryUpdatesState { return indexer as EntryUpdatesState; }
function getFileForPath(s: EntryUpdatesState, path: string): TFile | null {
	const plugin = s.plugin as { app?: { vault?: { getAbstractFileByPath?: (path: string) => unknown } } };
	const file = plugin.app?.vault?.getAbstractFileByPath?.(path);
	return file instanceof TFile ? file : null;
}
function normalizeMarkHex(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	const hex = raw.startsWith("#") ? raw : `#${raw}`;
	return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex) ? hex.toLowerCase() : "";
}
export function getFileMarkHex(indexer: unknown, path: string): string {
	return normalizeMarkHex(state(indexer).files[path]?.markColorHex);
}
export function getFileMarkColor(indexer: unknown, path: string): number | null {
	return state(indexer).files[path]?.markColor ?? null;
}
export function cycleFileMarkColor(indexer: unknown, path: string): boolean {
	const current = getFileMarkColor(indexer, path);
	return setFileMarkColor(indexer, path, current == null ? 1 : (Math.floor(current) % MAX_MARK_COLORS) + 1);
}
export function isFileKnown(indexer: unknown, path: string): boolean { return Boolean(state(indexer).files[path]); }
export function setFileMarkColor(indexer: unknown, path: string, markColor: number | string | null): boolean {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return false;
	const desiredIndex = typeof markColor === "number" && Number.isFinite(markColor) && markColor > 0
		? Math.max(1, Math.min(MAX_MARK_COLORS, Math.floor(markColor))) : null;
	const desiredHex = typeof markColor === "string" ? normalizeMarkHex(markColor) : "";
	if (getFileMarkColor(indexer, path) === desiredIndex && getFileMarkHex(indexer, path) === desiredHex) return false;
	const root = (s.plugin as { app?: { workspace?: { containerEl?: HTMLElement } } }).app?.workspace?.containerEl;
	const palette = getEpochMarkColorSet(root ?? null);
	const hex = desiredHex || (desiredIndex != null ? String(palette[desiredIndex - 1] ?? "").trim().toLowerCase() : "");
	if (desiredIndex != null) data.markColor = desiredIndex;
	else delete data.markColor;
	if (hex) data.markColorHex = hex;
	else delete data.markColorHex;
	const file = getFileForPath(s, path);
	if (file) void setYamlPropertyForFile(s.plugin, file, "mark", hex || null);
	applyHighlightState(data);
	s.updateAggregatedEntries(path);
	return true;
}
export function isFilePinned(indexer: unknown, path: string): boolean { return isTodayPinMode(state(indexer).files[path]?.pinnedFile); }
export function setFilePinned(indexer: unknown, path: string, pinned: boolean): boolean {
	const s = state(indexer);
	const data = s.files[path];
	if (!data) return false;
	const desiredMode = pinned ? "today" : null;
	if (normalizePinMode(data.pinnedFile) === desiredMode) return false;
	data.pinnedFile = desiredMode;
	const file = getFileForPath(s, path);
	if (file) void setYamlPropertyForFile(s.plugin, file, "pin", desiredMode);
	s.updateAggregatedEntries(path);
	return true;
}
export function setEntryPinned(indexer: unknown, target: DateEntry, pinned: boolean): boolean {
	const changed = setFilePinned(indexer, target.file, pinned);
	if (changed) target.pinned = pinned;
	return changed;
}
export function getIndexedPaths(indexer: unknown): string[] { return Object.keys(state(indexer).files); }
export function getFileIndexData(indexer: unknown, path: string): FileIndexData | null { return state(indexer).files[path] ?? null; }
