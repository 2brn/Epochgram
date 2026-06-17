import type { EpochCanvas } from "../epoch-canvas";
import { getMenuState } from "./menu-state";
import { isGenerateEpochsEffective } from "../../plugin/pro-feature-state";

function hasAnyEpochEntries(plugin: any): boolean {
	try {
		const index = (plugin?.indexer as any)?.index as Record<string, any[]> | undefined;
		if (!index || typeof index !== "object") return false;
		for (const list of Object.values(index)) {
			if (!Array.isArray(list) || list.length === 0) continue;
			if (list.some((e: any) => e && String((e as any)?.file || "").startsWith("epoch://"))) return true;
		}
	} catch {
		return false;
	}
	return false;
}

export function toggleEmptyAreaView(canvas: EpochCanvas): void {
	const state = getMenuState(canvas);
	if (state?.plugin?.settings?.generateEpochs !== true) return;
	const inEpochsView = typeof (canvas as any).isEpochsViewActive === "function"
		? !!(canvas as any).isEpochsViewActive()
		: false;

	if (inEpochsView) {
		try {
			const activePath = state.plugin?.app?.workspace?.getActiveFile?.()?.path ?? null;
			(canvas as any).suppressNextFocusScrollForPath?.(activePath);
		} catch { void 0; }
		try {
			(canvas as any).setEpochsViewWithToolbar?.(false);
			return;
		} catch { void 0; }
		try {
			(canvas as any).setEpochsView?.(false);
		} catch { void 0; }
		return;
	}

	const hasEpochEntries = hasAnyEpochEntries(state.plugin);
	if (!hasEpochEntries) return;

	const effective = isGenerateEpochsEffective(state.plugin);
	const hasProAccess = typeof state?.hasProAccess === "function" ? !!state.hasProAccess() : false;

	// On mobile, epoch generation is desktop-only, but viewing synced Epochs should
	// still be allowed for Pro users.
	if (!effective && !hasProAccess) {
		state.requirePro("Epochs");
		return;
	}
	try {
		(canvas as any).setEpochsViewWithToolbar?.(true);
		return;
	} catch { void 0; }
	try {
		(canvas as any).setEpochsView?.(true);
	} catch { void 0; }
}
