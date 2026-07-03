import { Platform, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_EPOCH } from "../../ui/epoch-view-mode";
import type { EpochPlugin } from "../../main";

type FileRef = { path: string };

type CursorLike = { line?: unknown };

type EditorLike = {
	getCursor?: () => CursorLike;
};

type CanvasViewLike = {
	snapInitialPosition?: (path: string | null, line: number | null) => void;
	refreshIndex?: () => void;
	refreshSemanticRelatedForActiveFile?: (force: boolean) => void;
};

type LeafViewLike = {
	getViewType?: () => string;
	file?: unknown;
	editor?: EditorLike;
	canvas?: CanvasViewLike;
	openTimelineSearch?: () => void;
	syncPreferencesFromPlugin?: (prefs: unknown) => void;
	refreshIndex?: () => void;
};

type EpochPluginRuntime = EpochPlugin & {
	stopAiBridge?: () => Promise<void> | void;
	similarityWorker?: Worker | null;
	similarityWorkerPending?: unknown;
	similarityWorkerNextId?: number;
	noteLeaf?: WorkspaceLeaf | null;
	indexReady?: boolean;
	viewPreferences?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFileRef(value: unknown): FileRef | null {
	const rec = asRecord(value);
	if (!rec) return null;
	const p = rec.path;
	return typeof p === "string" && p.length > 0 ? { path: p } : null;
}

function getLeafView(leaf: WorkspaceLeaf | null | undefined): LeafViewLike | null {
	if (!leaf) return null;
	return leaf.view;
}

function getCursorLine(view: LeafViewLike | null): number | null {
	if (!view) return null;
	const cur = view.editor?.getCursor?.();
	return typeof cur?.line === "number" ? cur.line : null;
}

function getLeafFile(view: LeafViewLike | null): FileRef | null {
	if (!view) return null;
	return asFileRef(view.file);
}

function getEpochTargetLeaf(plugin: EpochPlugin): WorkspaceLeaf | null {
	const workspace = plugin.app.workspace;
	const direct = workspace.getRightLeaf(false);
	if (direct) return direct;
	const rec = asRecord(workspace);
	const maybeGetLeaf = rec?.getLeaf;
	if (typeof maybeGetLeaf === "function") {
		const leaf = maybeGetLeaf.call(workspace, true) as unknown;
		return leaf as WorkspaceLeaf | null;
	}
	return null;
}

export function onViewUnload(plugin: EpochPlugin): void {
	const runtime = plugin as EpochPluginRuntime;
	try {
		void runtime.stopAiBridge?.();
	} catch {
		// ignore
	}
	try {
		const w: Worker | null = runtime.similarityWorker ?? null;
		if (w) {
			w.terminate();
			runtime.similarityWorker = null;
		}
		runtime.similarityWorkerPending = null;
		runtime.similarityWorkerNextId = 1;
	} catch {
		// ignore
	}
	plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_EPOCH);
}

export async function openEpochView(plugin: EpochPlugin, options: { skipSnap?: boolean; activate?: boolean } = {}): Promise<void> {
	const runtime = plugin as EpochPluginRuntime;
	await plugin.ensureIndexLoaded();
	const shouldActivate = options.activate === true;
	const current = plugin.app.workspace.getMostRecentLeaf();
	if (current && current.view.getViewType() === "markdown") {
		runtime.noteLeaf = current;
	}

	const resolveFileFromLeaf = (leaf: WorkspaceLeaf | null | undefined): { file: FileRef; line: number | null } | null => {
		if (!leaf) return null;
		try {
			const v = getLeafView(leaf);
			const f = getLeafFile(v);
			if (f) {
				const line = getCursorLine(v);
				return { file: f, line };
			}
		} catch {
			// ignore
		}
		try {
			const vs = leaf.getViewState();
			const state = asRecord(vs?.state);
			const raw = state?.file ?? state?.path ?? null;
			const path = typeof raw === "string" ? raw : "";
			if (!path) return null;
			const af = plugin.app.vault.getAbstractFileByPath(path);
			if (!af) return null;
			const file = asFileRef(af);
			if (!file) return null;
			return { file, line: null };
		} catch {
			// ignore
		}
		return null;
	};

	const getOpenFile = (): { file: FileRef; line: number | null } | null => {
		try {
			const activeLeaf = (asRecord(plugin.app.workspace)?.activeLeaf as WorkspaceLeaf | null | undefined) ?? null;
			const active = resolveFileFromLeaf(activeLeaf);
			if (active?.file) return active;
		} catch {
			// ignore
		}
		try {
			const noteLeaf = runtime.noteLeaf ?? null;
			const noteView = getLeafView(noteLeaf);
			if (noteView?.getViewType?.() !== VIEW_TYPE_EPOCH) {
				const f = getLeafFile(noteView);
				if (f) {
					const line = getCursorLine(noteView);
					return { file: f, line };
				}
			}
		} catch {
			// ignore
		}
		try {
			const leaves = plugin.app.workspace.getLeavesOfType("markdown");
			for (const l of leaves) {
				const v = getLeafView(l);
				const f = getLeafFile(v);
				if (f) {
					const line = getCursorLine(v);
					return { file: f, line };
				}
			}
		} catch {
			// ignore
		}
		try {
			const recent = plugin.app.workspace.getMostRecentLeaf?.();
			const resolved = resolveFileFromLeaf(recent);
			if (resolved?.file) return resolved;
		} catch {
			// ignore
		}
		return null;
	};

	const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);

	if (leaves.length > 0) {
		const leaf = leaves[0];
		void plugin.app.workspace.revealLeaf(leaf);
		try {
			if (Platform.isMobile || shouldActivate) {
				plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
			}
		} catch {
			// ignore
		}
		if (!options.skipSnap) {
			const view = getLeafView(leaf);
			try {
				const open = getOpenFile();
				const path = open?.file?.path ?? null;
				const line = open?.line ?? null;
				if (path) {
					view?.canvas?.snapInitialPosition?.(path, line);
					return;
				}
			} catch {
				// ignore
			}
			try {
				view?.canvas?.snapInitialPosition?.(null, null);
			} catch {
				// ignore
			}
		}
		return;
	}

	const leaf = getEpochTargetLeaf(plugin);
	if (!leaf) return;

	await leaf.setViewState({
		type: VIEW_TYPE_EPOCH,
		active: shouldActivate
	});

	void plugin.app.workspace.revealLeaf(leaf);
	try {
		if (Platform.isMobile || shouldActivate) {
			plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
		}
	} catch {
		// ignore
	}
}

export async function openTimelineSearch(plugin: EpochPlugin): Promise<void> {
	await openEpochView(plugin, { skipSnap: true });
	try {
		const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);
		const leaf = Array.isArray(leaves) && leaves.length > 0 ? leaves[0] : null;
		const view = getLeafView(leaf);
		view?.openTimelineSearch?.();
	} catch {
		// ignore
	}
}

export async function ensureEpochViewLeaf(plugin: EpochPlugin): Promise<void> {
	try {
		const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);
		if (leaves.length > 0) return;
		const leaf = getEpochTargetLeaf(plugin);
		if (!leaf) return;
		await leaf.setViewState({
			type: VIEW_TYPE_EPOCH,
			active: false
		});
	} catch {
		// ignore
	}
}

export function refreshEpochViews(
	plugin: EpochPlugin,
	options: { forceSemanticRelated?: boolean } = {}
): void {
	const runtime = plugin as EpochPluginRuntime;
	if (!runtime.indexReady) return;
	const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);
	for (const leaf of leaves) {
		const view = getLeafView(leaf);
		if (!view) continue;
		if (typeof view.syncPreferencesFromPlugin === "function") {
			view.syncPreferencesFromPlugin(runtime.viewPreferences);
		}
		if (typeof view.refreshIndex === "function") {
			view.refreshIndex();
		} else {
			const canvasView = view.canvas;
			if (canvasView && typeof canvasView.refreshIndex === "function") {
				canvasView.refreshIndex();
			}
		}
		view.canvas?.refreshSemanticRelatedForActiveFile?.(options.forceSemanticRelated === true);
	}
}
