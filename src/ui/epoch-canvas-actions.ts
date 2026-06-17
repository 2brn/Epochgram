import {
	MarkdownView,
	TFile,
	TFolder,
	WorkspaceLeaf,
	normalizePath,
	Platform
} from "obsidian";
import type { DateEntry, EpochIndex } from "../indexer/types";
import type { EpochCanvas } from "./epoch-canvas";
import { getEntriesForDate } from "./entry-helpers";
import {
	getFileForDate,
	getNotePathParts,
	getNextDailyNoteCreatePath,
	getUsableLeaf,
} from "./epoch-canvas-helpers";
import { focusDateIfNeeded } from "./epoch-canvas-focus";
import { FolderTreeModal, TextPromptModal, confirmDeleteFileIfNeeded } from "./modals";
import { formatDate } from "utils";
import { getYamlDatePropertyKey } from "../plugin/frontmatter-keys";

interface CanvasActionsInternals {
	plugin: any;
	index: EpochIndex;
	lastFileLeaf: WorkspaceLeaf | null;
	suppressNextFocusHover: string | null;
	suppressNextFocusScroll: string | null;
	forceNextFocusHover: string | null;
	missingFileRebuildPending: boolean;
	refreshIndex(): void;
	draw(): void;
	clearHover(force?: boolean): void;
	requirePro(feature: string): boolean;
	hasProAccess(): boolean;
}

function actionState(canvas: EpochCanvas): CanvasActionsInternals {
	return canvas as unknown as CanvasActionsInternals;
}

function stripMomentBracketLiterals(format: string): string {
	return String(format || "").replace(/\[[^\]]*\]/g, "");
}

function hasTimeTokens(format: string): boolean {
	const core = stripMomentBracketLiterals(format);
	return /[HhkmssSaA]/.test(core);
}

function getCreatePathDate(canvas: EpochCanvas, date: Date): Date {
	const state = actionState(canvas);
	const pluginAny: any = state.plugin as any;
	const format = typeof pluginAny?.getDailyNoteFormat === "function"
		? String(pluginAny.getDailyNoteFormat() || "")
		: "";
	if (!hasTimeTokens(format)) {
		return date;
	}
	const now = new Date();
	const out = new Date(date.getTime());
	out.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
	return out;
}

export async function createNoteForDate(
	canvas: EpochCanvas,
	date: Date,
	focus: boolean
): Promise<void> {
	const state = actionState(canvas);
	const app = state.plugin.app;
	const pathDate = getCreatePathDate(canvas, date);
	let path = getNextDailyNoteCreatePath(canvas, pathDate).path;

	const ensureParentFolders = async (filePath: string): Promise<void> => {
		const parent = normalizePath(String(filePath || ""))
			.split("/")
			.slice(0, -1)
			.join("/")
			.trim();
		if (!parent) return;
		const parts = parent.split("/").filter(Boolean);
		let acc = "";
		for (const part of parts) {
			acc = acc ? `${acc}/${part}` : part;
			const existing = app.vault.getAbstractFileByPath(acc);
			if (existing instanceof TFolder) continue;
			if (existing instanceof TFile) {
				throw new Error(`Cannot create folder; file exists at: ${acc}`);
			}
			await app.vault.createFolder(acc);
		}
	};

	const buildInitialContent = async (filePath: string): Promise<string> => {
		const pluginAny: any = state.plugin as any;
		if (typeof pluginAny?.getDailyNoteTemplateContent === "function") {
			try {
				const fromTemplate = await pluginAny.getDailyNoteTemplateContent(date, filePath);
				if (typeof fromTemplate === "string") {
					return fromTemplate;
				}
			} catch { void 0; }
		}
		const ymd = formatDate(date);
		const datePropertyKey = getYamlDatePropertyKey(state.plugin);
		return `---\n${datePropertyKey}: ${ymd}\n---`;
	};

	await ensureParentFolders(path);
	let initial = await buildInitialContent(path);
	let file: TFile;
	try {
		file = await app.vault.create(path, initial);
	} catch {
		path = getNextDailyNoteCreatePath(canvas, pathDate).path;
		await ensureParentFolders(path);
		initial = await buildInitialContent(path);
		file = await app.vault.create(path, initial);
	}
	await openFileAtLine(canvas, file.path, 0, undefined);
	if (focus) {
		focusDateIfNeeded(canvas, date, false);
	}
}

export async function openDateNote(
	canvas: EpochCanvas,
	date: Date,
	ev: MouseEvent | undefined,
	focus: boolean,
	options?: { allowFallbackToFirstEntry?: boolean }
): Promise<boolean> {
	const file = getFileForDate(canvas, date);
	if (file) {
		await openFileAtLine(canvas, file.path, 0, ev);
		if (focus) {
			focusDateIfNeeded(canvas, date, false);
		}
		return true;
	}

	const allowFallbackToFirstEntry = options?.allowFallbackToFirstEntry !== false;
	if (!allowFallbackToFirstEntry) {
		return false;
	}

	const { folder } = getNotePathParts(canvas, date);
	const hasDedicatedFolder = folder.length > 0;
	if (hasDedicatedFolder) {
		return false;
	}
	const entries = getEntriesForDate(canvas, date);
	if (!entries.length) {
		return false;
	}

	const entry = entries[0];
	if (!entry) {
		return false;
	}

	await openEntry(canvas, entry, ev, true);
	if (focus) {
		focusDateIfNeeded(canvas, date, false);
	}
	return true;
}

export async function openEntry(
	canvas: EpochCanvas,
	entry: DateEntry,
	ev: MouseEvent | undefined,
	suppressFocusHover: boolean
): Promise<void> {
	const state = actionState(canvas);
	const line = Math.max(0, entry.blockStart ?? 0);
	if (suppressFocusHover) {
		state.suppressNextFocusHover = entry.file;
		state.suppressNextFocusScroll = entry.file;
	}
	await openFileAtLine(canvas, entry.file, line, ev);
}

export async function openFileAtLine(
	canvas: EpochCanvas,
	filePath: string,
	line: number,
	ev: MouseEvent | undefined
): Promise<void> {
	const state = actionState(canvas);
	const app = state.plugin.app;
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		await triggerMissingFileRebuild(canvas);
		return;
	}
	try {
		const pluginAny: any = state.plugin as any;
		const prev = pluginAny.__timelineSearchLastOpenedFiles as string[] | null | undefined;
		const out: string[] = [];
		const seen = new Set<string>();
		const p = String(filePath || "");
		if (p) {
			seen.add(p);
			out.push(p);
		}
		for (const it of Array.isArray(prev) ? prev : []) {
			const s = String(it || "");
			if (!s) continue;
			if (seen.has(s)) continue;
			seen.add(s);
			out.push(s);
			if (out.length >= 50) break;
		}
		pluginAny.__timelineSearchLastOpenedFiles = out;
	} catch {
		// ignore
	}

	const workspace = app.workspace;
	const isMarkdown = file.extension?.toLowerCase?.() === "md";
	let leaf: WorkspaceLeaf | null = null;

	if (ev?.ctrlKey || ev?.metaKey) {
		leaf = workspace.getLeaf(true);
	} else {
		leaf = getUsableLeaf(canvas, state.lastFileLeaf);
		if (!leaf) {
			const active = workspace.getMostRecentLeaf();
			leaf = getUsableLeaf(canvas, active as WorkspaceLeaf);
		}
		if (!leaf && isMarkdown) {
			const mdLeaves = workspace.getLeavesOfType("markdown");
			if (mdLeaves.length > 0) {
				leaf = getUsableLeaf(canvas, mdLeaves[0]);
			}
		}
		if (!leaf) {
			const fallback = getUsableLeaf(canvas, workspace.getLeaf(false));
			if (fallback) {
				leaf = fallback;
			}
		}
		if (!leaf) {
			leaf = workspace.getLeaf(true);
		}
	}

	if (!leaf) {
		return;
	}

	workspace.revealLeaf(leaf);
	await leaf.openFile(file);
	workspace.setActiveLeaf(leaf, true);
	state.lastFileLeaf = getUsableLeaf(canvas, leaf);

	if (Platform.isMobileApp) {
		const ws: any = app.workspace;
		if (ws.rightSplit && typeof ws.rightSplit.collapse === "function") {
			ws.rightSplit.collapse();
		}
	}

	const view = leaf.view;
	if (!(view instanceof MarkdownView)) {
		return;
	}

	const safeLine = Math.max(0, line);
	const editor = view.editor;
	if (editor) {
		editor.focus();
		editor.setCursor({ line: safeLine, ch: 0 });
		editor.scrollIntoView({ from: { line: safeLine, ch: 0 }, to: { line: safeLine, ch: 0 } }, true);
	}
}

export async function deleteEntryFile(canvas: EpochCanvas, entry: DateEntry): Promise<void> {
	const state = actionState(canvas);
	const app = state.plugin.app;
	const file = app.vault.getAbstractFileByPath(entry.file);
	if (!(file instanceof TFile)) {
		return;
	}

	const ok = await confirmDeleteFileIfNeeded(app, file);
	if (!ok) {
		return;
	}

	await app.vault.delete(file);

	for (const key in state.index) {
		state.index[key] = state.index[key].filter(e => e.file !== entry.file);
		if (state.index[key].length === 0) {
			delete state.index[key];
		}
	}

	state.draw();
}

export async function promptRenameFile(canvas: EpochCanvas, file: TFile): Promise<boolean> {
	const state = actionState(canvas);
	const fm: any = state.plugin.app.fileManager;
	if (!fm) {
		return false;
	}
	try {
		if (typeof fm.promptRenameFile === "function") {
			await fm.promptRenameFile(file);
			return true;
		}
		if (typeof fm.promptForNewFilePath === "function") {
			const suggested = file.path;
			const newPath = await fm.promptForNewFilePath(suggested);
			if (newPath && typeof fm.renameFile === "function" && newPath !== file.path) {
				await fm.renameFile(file, normalizePath(newPath));
				return true;
			}
			return false;
		}
	} catch (error) {
		void error;
	}

	const newName = await promptTextValue(canvas, "Filename", file.basename);
	if (!newName) {
		return false;
	}
	const sanitized = newName.replace(/[\\/]/g, "").trim();
	if (!sanitized || sanitized === file.basename) {
		return false;
	}
	const parentPath = file.parent?.path ?? "";
	const ext = file.extension ? `.${file.extension}` : "";
	const newPath = parentPath ? `${parentPath}/${sanitized}${ext}` : `${sanitized}${ext}`;
	await fm.renameFile(file, normalizePath(newPath));
	return true;
}

export async function promptMoveFile(canvas: EpochCanvas, file: TFile): Promise<boolean> {
	const state = actionState(canvas);
	const fm: any = state.plugin.app.fileManager;
	if (!fm) {
		return false;
	}
	try {
		if (typeof fm.promptMoveFile === "function") {
			await fm.promptMoveFile(file);
			return true;
		}
		if (typeof fm.promptForFolderSelection === "function") {
			const targetFolder = await fm.promptForFolderSelection(file.parent ?? state.plugin.app.vault.getRoot());
			if (targetFolder && typeof fm.renameFile === "function") {
				const base = file.name;
				const newPath = targetFolder.path ? `${targetFolder.path}/${base}` : base;
				if (newPath !== file.path) {
					await fm.renameFile(file, normalizePath(newPath));
					return true;
				}
			}
			return false;
		}
	} catch (error) {
		void error;
	}

	const targetFolder = await promptFolderSelection(canvas, file.parent ?? state.plugin.app.vault.getRoot());
	if (!targetFolder) {
		return false;
	}
	const base = file.name;
	const newPath = targetFolder.path ? `${targetFolder.path}/${base}` : base;
	if (newPath === file.path) {
		return false;
	}
	if (typeof fm.renameFile === "function") {
		await fm.renameFile(file, normalizePath(newPath));
		return true;
	}
	if (typeof fm.moveFile === "function") {
		await fm.moveFile(file, normalizePath(newPath));
		return true;
	}
	return false;
}

async function promptFolderSelection(
	canvas: EpochCanvas,
	initial: TFolder | null
): Promise<TFolder | null> {
	return new Promise(resolve => {
		const state = actionState(canvas);
		const modal = new FolderTreeModal(state.plugin.app, initial, resolve);
		modal.open();
	});
}

async function promptTextValue(
	canvas: EpochCanvas,
	title: string,
	value: string
): Promise<string | null> {
	return new Promise(resolve => {
		const state = actionState(canvas);
		const modal = new TextPromptModal(state.plugin.app, title, value, resolve);
		modal.open();
	});
}

export async function triggerMissingFileRebuild(canvas: EpochCanvas): Promise<void> {
	const state = actionState(canvas);
	if (state.missingFileRebuildPending) {
		return;
	}
	state.missingFileRebuildPending = true;
	try {
		const plugin = state.plugin;
		if (plugin && typeof plugin.refreshIndexSmartWithProgress === "function") {
			await plugin.refreshIndexSmartWithProgress({ suppressNotices: true });
		} else if (plugin && typeof plugin.rebuildIndexWithProgress === "function") {
			await plugin.rebuildIndexWithProgress({ suppressNotices: true });
		} else if (plugin?.indexer && typeof plugin.indexer.rebuildAll === "function") {
			const files = plugin.app?.vault?.getFiles?.() ?? [];
			await plugin.indexer.rebuildAll(files);
		}
	} catch (error) {
		void error;
	} finally {
		state.missingFileRebuildPending = false;
		state.refreshIndex();
	}
}
