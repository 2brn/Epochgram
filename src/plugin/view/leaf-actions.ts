import { Platform } from "obsidian";
import { VIEW_TYPE_EPOCH } from "../../ui/epoch-view-mode";
import type { EpochPlugin } from "../../main";

export function onViewUnload(plugin: EpochPlugin): void {
	try {
		void (plugin as any).stopAiBridge?.();
	} catch {
		// ignore
	}
	try {
		const anyPlugin: any = plugin as any;
		const w: Worker | null = anyPlugin.similarityWorker ?? null;
		if (w) {
			w.terminate();
			anyPlugin.similarityWorker = null;
		}
		anyPlugin.similarityWorkerPending = null;
		anyPlugin.similarityWorkerNextId = 1;
	} catch {
		// ignore
	}
	plugin.app.workspace.detachLeavesOfType(VIEW_TYPE_EPOCH);
}

export async function openEpochView(plugin: EpochPlugin, options: { skipSnap?: boolean; activate?: boolean } = {}): Promise<void> {
	await plugin.ensureIndexLoaded();
	const shouldActivate = options.activate === true;
	const current = plugin.app.workspace.getMostRecentLeaf();
	if (current && current.view.getViewType() === "markdown") {
		(plugin as any).noteLeaf = current;
	}

	const resolveFileFromLeaf = (leaf: any): { file: any; line: number | null } | null => {
		if (!leaf) return null;
		try {
			const v: any = leaf?.view;
			const f = v?.file;
			if (f) {
				const line0 = v?.editor?.getCursor?.().line;
				const line = typeof line0 === "number" ? line0 : null;
				return { file: f, line };
			}
		} catch {
			// ignore
		}
		try {
			const getViewState = leaf?.getViewState;
			if (typeof getViewState !== "function") return null;
			const vs = getViewState.call(leaf);
			const raw = vs?.state?.file ?? vs?.state?.path ?? null;
			const path = typeof raw === "string" ? raw : "";
			if (!path) return null;
			const af = (plugin.app.vault as any)?.getAbstractFileByPath?.(path);
			if (!af) return null;
			return { file: af, line: null };
		} catch {
			// ignore
		}
		return null;
	};

	const getOpenFile = (): { file: any; line: number | null } | null => {
		try {
			const activeLeaf: any = (plugin.app.workspace as any)?.activeLeaf ?? null;
			const active = resolveFileFromLeaf(activeLeaf);
			if (active?.file) return active;
		} catch {
			// ignore
		}
		try {
			const noteLeaf: any = (plugin as any).noteLeaf ?? null;
			const noteView: any = noteLeaf?.view ?? null;
			if (noteView?.getViewType?.() !== VIEW_TYPE_EPOCH) {
				const f = noteView?.file;
				if (f) {
					const line0 = noteView?.editor?.getCursor?.().line;
					const line = typeof line0 === "number" ? line0 : null;
					return { file: f, line };
				}
			}
		} catch {
			// ignore
		}
		try {
			const leaves: any[] = (plugin.app.workspace as any)?.getLeavesOfType?.("markdown") ?? [];
			for (const l of leaves) {
				const v: any = l?.view;
				const f = v?.file;
				if (f) {
					const line0 = v?.editor?.getCursor?.().line;
					const line = typeof line0 === "number" ? line0 : null;
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
			if (Platform.isMobileApp || shouldActivate) {
				plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
			}
		} catch {
			// ignore
		}
		if (!options.skipSnap) {
			const view: any = leaf.view as any;
			try {
				const open = getOpenFile();
				const path = open?.file?.path ?? null;
				const line = open?.line ?? null;
				if (path) {
					(view as any)?.canvas?.snapInitialPosition?.(path, line);
					return;
				}
			} catch {
				// ignore
			}
			try {
				(view as any)?.canvas?.snapInitialPosition?.(null, null);
			} catch {
				// ignore
			}
		}
		return;
	}

	const leaf = (() => {
		const workspaceAny: any = plugin.app.workspace as any;
		return plugin.app.workspace.getRightLeaf(false) ?? (typeof workspaceAny?.getLeaf === "function" ? workspaceAny.getLeaf(true) : null);
	})();
	if (!leaf) return;

	await leaf.setViewState({
		type: VIEW_TYPE_EPOCH,
		active: shouldActivate
	});

	void plugin.app.workspace.revealLeaf(leaf);
	try {
		if (Platform.isMobileApp || shouldActivate) {
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
		const view: any = leaf?.view as any;
		view?.openTimelineSearch?.();
	} catch {
		// ignore
	}
}

export async function ensureEpochViewLeaf(plugin: EpochPlugin): Promise<void> {
	try {
		const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);
		if (leaves.length > 0) return;
		const workspaceAny: any = plugin.app.workspace as any;
		const leaf = plugin.app.workspace.getRightLeaf(false) ?? (typeof workspaceAny?.getLeaf === "function" ? workspaceAny.getLeaf(true) : null);
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
	if (!(plugin as any).indexReady) return;
	const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_EPOCH);
	for (const leaf of leaves) {
		const view: any = leaf.view as any;
		if (typeof view.syncPreferencesFromPlugin === "function") {
			view.syncPreferencesFromPlugin((plugin as any).viewPreferences);
		}
		if (typeof (view as any).refreshIndex === "function") {
			(view as any).refreshIndex();
		} else {
			view.canvas?.refreshIndex();
		}
		(view.canvas as any)?.refreshSemanticRelatedForActiveFile?.(options.forceSemanticRelated === true);
	}
}
