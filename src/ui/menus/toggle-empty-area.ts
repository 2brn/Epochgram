import type { EpochCanvas } from "../epoch-canvas";
import { getMenuState } from "./menu-state";
import { isGenerateEpochsEffective } from "../../plugin/pro-feature-state";

type EpochEntryLike = { file?: string };
type EpochIndexLike = Record<string, Array<EpochEntryLike | null | undefined>>;
type PluginLike = { indexer?: { index?: EpochIndexLike } };
type CanvasLike = EpochCanvas & {
	isEpochsViewActive?: () => boolean;
	suppressNextFocusScrollForPath?: (path: string | null) => void;
	setEpochsViewWithToolbar?: (value: boolean) => void;
	setEpochsView?: (value: boolean) => void;
};
type MenuStateLike = {
	plugin: PluginLike;
	hasProAccess?: () => boolean;
	requirePro?: (feature: string) => void;
};

function hasAnyEpochEntries(plugin: PluginLike): boolean {
	try {
		const index = plugin.indexer?.index;
		if (!index || typeof index !== "object") return false;
		for (const list of Object.values(index)) {
			if (!Array.isArray(list) || list.length === 0) continue;
			if (list.some((entry) => entry && String(entry.file || "").startsWith("epoch://"))) return true;
		}
	} catch {
		return false;
	}
	return false;
}

export function toggleEmptyAreaView(canvas: CanvasLike): void {
	const state = getMenuState(canvas) as unknown as MenuStateLike;
	if ((state.plugin as unknown as { settings?: { generateEpochs?: boolean } })?.settings?.generateEpochs !== true) return;
	const inEpochsView = typeof canvas.isEpochsViewActive === "function"
		? !!canvas.isEpochsViewActive()
		: false;

	if (inEpochsView) {
		try {
			const activePath = (state.plugin as unknown as { app?: { workspace?: { getActiveFile?: () => { path?: string } | null } } })?.app?.workspace?.getActiveFile?.()?.path ?? null;
			canvas.suppressNextFocusScrollForPath?.(activePath);
		} catch { void 0; }
		try {
			canvas.setEpochsViewWithToolbar?.(false);
			return;
		} catch { void 0; }
		try {
			canvas.setEpochsView?.(false);
		} catch { void 0; }
		return;
	}

	const hasEpochEntries = hasAnyEpochEntries(state.plugin);
	if (!hasEpochEntries) return;

	const effective = isGenerateEpochsEffective(state.plugin as unknown as import("../../main").EpochPlugin);
	const hasProAccess = typeof state.hasProAccess === "function" ? !!state.hasProAccess() : false;

	// On mobile, epoch generation is desktop-only, but viewing synced Epochs should
	// still be allowed for Pro users.
	if (!effective && !hasProAccess) {
		state.requirePro?.("Epochs");
		return;
	}
	try {
		canvas.setEpochsViewWithToolbar?.(true);
		return;
	} catch { void 0; }
	try {
		canvas.setEpochsView?.(true);
	} catch { void 0; }
}
