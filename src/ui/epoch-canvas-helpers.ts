import { normalizePath, TFile, WorkspaceLeaf } from "obsidian";
import type { DateEntry } from "../indexer/types";
import { formatDate } from "utils";
import { VIEW_TYPE_EPOCH } from "./epoch-view-mode";
import type { EpochCanvas } from "./epoch-canvas";

interface CanvasHelperInternals {
	cssCache: Record<string, string>;
	plugin: any;
	canvas: HTMLCanvasElement;
	root: HTMLElement;
	triggerMissingFileRebuild(): Promise<void> | void;
}

function helperState(canvas: EpochCanvas): CanvasHelperInternals {
	return canvas as unknown as CanvasHelperInternals;
}

export function getToday(): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

export function getDateForIndex(index: number, today: Date): Date {
	// DST-safe: subtract calendar days instead of fixed milliseconds.
	const d = new Date(today.getTime());
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - index);
	d.setHours(0, 0, 0, 0);
	return d;
}

export function getCssValue(
	canvas: EpochCanvas,
	css: CSSStyleDeclaration,
	property: string
): string {
	const state = helperState(canvas);
	const raw = css.getPropertyValue(property).trim();
	if (raw) {
		state.cssCache[property] = raw;
		return raw;
	}
	return state.cssCache[property] ?? "";
}

export function getEntryTitle(canvas: EpochCanvas, entry: DateEntry): string {
	const state = helperState(canvas);
	const file = state.plugin?.app?.vault?.getAbstractFileByPath?.(entry.file);
	if (file instanceof TFile) {
		return file.name;
	}
	if (typeof state.triggerMissingFileRebuild === "function") {
		void state.triggerMissingFileRebuild();
	}
	return entry.file;
}

export function getNoteNameForDate(canvas: EpochCanvas, date: Date): string {
	const state = helperState(canvas);
	if (state.plugin && typeof state.plugin.getDateFormat === "function") {
		return state.plugin.getDateFormat(date);
	}
	return formatDate(date);
}

export function getNotePathParts(
	canvas: EpochCanvas,
	date: Date
): { folder: string; baseName: string } {
	const baseName = getNoteNameForDate(canvas, date) || formatDate(date);
	const state = helperState(canvas);
	const rawFolder = state.plugin && typeof (state.plugin as any).getDailyNoteFolder === "function"
		? String((state.plugin as any).getDailyNoteFolder() || "")
		: "/";
	const folder = rawFolder
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/+$/, "")
		.replace(/^\/+/, "");
	return { folder, baseName };
}

export function getFileForDate(canvas: EpochCanvas, date: Date): TFile | null {
	return findFirstDailyNoteFile(canvas, date);
}

export function makeNoteFileName(baseName: string, suffix: string = ""): string {
	const trimmed = baseName.trim();
	const hasExt = trimmed.toLowerCase().endsWith(".md");
	const core = hasExt ? trimmed.slice(0, -3) : trimmed;
	return `${core}${suffix}.md`;
}

export function buildNotePath(folder: string, baseName: string, suffix: string = ""): string {
	const fileName = makeNoteFileName(baseName, suffix);
	if (folder) {
		return normalizePath(`${folder}/${fileName}`);
	}
	return normalizePath(fileName);
}

function findFirstDailyNoteFile(canvas: EpochCanvas, date: Date): TFile | null {
	const state = helperState(canvas);
	const app = state.plugin?.app;
	if (!app) return null;
	const { folder, baseName } = getNotePathParts(canvas, date);

	const findByDirectPath = (path: string): TFile | null => {
		const direct = app.vault.getAbstractFileByPath(path);
		return direct instanceof TFile ? direct : null;
	};

	const basePath = buildNotePath(folder, baseName);
	const directBase = findByDirectPath(basePath);
	if (directBase) return directBase;

	// Multiple daily notes per date (variants): use only "(n)".
	// Cap to keep lookups bounded; typical usage should be very small.
	const MAX_VARIANTS = 500;
	for (let n = 1; n <= MAX_VARIANTS; n++) {
		const p = buildNotePath(folder, baseName, ` (${n})`);
		const hit = findByDirectPath(p);
		if (hit) return hit;
	}

	// If a dedicated folder is configured, also scan within it for nested paths
	// (some Daily Notes setups and legacy behaviors can place notes under subfolders).
	if (!folder) return null;

	const normalizedFolder = normalizePath(folder).toLowerCase();
	const folderPrefix = `${normalizedFolder}/`;
	const targetBaseLeaf = makeNoteFileName(baseName).split("/").pop()?.toLowerCase() ?? "";
	if (!targetBaseLeaf) return null;
	const targetStem = targetBaseLeaf.replace(/\.md$/i, "");
	const escapeRegex = (s: string) => s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
	const stemEsc = escapeRegex(targetStem);
	const reParen = new RegExp(`^${stemEsc} \\((\\d+)\\)\\.md$`, "i");


	const files = typeof app.vault.getFiles === "function" ? app.vault.getFiles() : [];
	let bestParen: { n: number; file: TFile } | null = null;
	for (const file of files) {
		const lowerPath = file.path.toLowerCase();
		if (!(lowerPath === normalizedFolder || lowerPath.startsWith(folderPrefix))) {
			continue;
		}
		const leaf = file.name.toLowerCase();
		if (leaf === targetBaseLeaf) return file;
		// Track the lowest numbered variant, preferring paren style.
		const mp = leaf.match(reParen);
		if (mp) {
			const n = Number(mp[1]);
			if (Number.isFinite(n) && n > 0 && (!bestParen || n < bestParen.n)) {
				bestParen = { n, file };
			}
			continue;
		}

	}
	return bestParen?.file ?? null;
}

export function getNextDailyNoteCreatePath(
	canvas: EpochCanvas,
	date: Date
): { path: string; fileName: string } {
	const state = helperState(canvas);
	const app = state.plugin?.app;
	const { folder, baseName } = getNotePathParts(canvas, date);
	const basePath = buildNotePath(folder, baseName);
	const fileNameFromPath = (p: string) => (String(p).split("/").pop() || p);
	if (!app) {
		return { path: basePath, fileName: fileNameFromPath(basePath) };
	}
	const exists = (p: string): boolean => {
		const af = app.vault.getAbstractFileByPath(p);
		return af instanceof TFile;
	};

	if (!exists(basePath)) {
		return { path: basePath, fileName: fileNameFromPath(basePath) };
	}

	// Find the next available numbered variant.
	const MAX_VARIANTS = 500;
	for (let n = 1; n <= MAX_VARIANTS; n++) {
		const parenPath = buildNotePath(folder, baseName, ` (${n})`);
		if (!exists(parenPath)) {
			return { path: parenPath, fileName: fileNameFromPath(parenPath) };
		}
	}

	// Extremely unlikely; fall back to a unique suffix.
	const fallbackPath = buildNotePath(folder, baseName, ` (${Date.now()})`);
	return { path: fallbackPath, fileName: fileNameFromPath(fallbackPath) };
}

export function getUsableLeaf(
	_canvas: EpochCanvas,
	candidate: WorkspaceLeaf | null | undefined
): WorkspaceLeaf | null {
	if (!candidate) return null;
	const parent = (candidate as any)?.parent;
	if (!parent) return null;
	const viewType = candidate.view?.getViewType?.();
	if (viewType === VIEW_TYPE_EPOCH) return null;
	return candidate;
}
