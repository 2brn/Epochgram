import type { EpochPlugin } from "../main";
import { normalizeMarkColorIndex } from "../ui/mark-colors";
import { hasSimilarityAccess } from "./pro-feature-state";
import { embeddingsSimilarityEnabled } from "./similarity/config";
import {
	computeTargetsForMarkMenuAction,
	getMarkCenterPathForGroupActions,
	isPathInheritedMarked,
	resolveMarkAncestorPath
} from "../ui/mark-group";

function normalizeNonEpochPath(value: unknown): string {
	const p = typeof value === "string" ? String(value || "").trim() : "";
	if (!p || p.startsWith("epoch://")) return "";
	return p;
}

function getCachedInheritedSourcePath(plugin: any, path: string): string | null {
	const p = normalizeNonEpochPath(path);
	if (!p) return null;
	try {
		const srcMap: unknown = plugin?.__epochInheritedMarkSourceByPath;
		if (!(srcMap instanceof Map)) return null;
		const src = normalizeNonEpochPath(srcMap.get(p));
		return src && src !== p ? src : null;
	} catch {
		return null;
	}
}

function getCachedInheritedMarkColorIndex(plugin: any, path: string): number | null {
	const p = normalizeNonEpochPath(path);
	if (!p) return null;
	try {
		const map: unknown = plugin?.__epochInheritedMarkIndexByPath;
		if (!(map instanceof Map)) return null;
		return normalizeMarkColorIndex(map.get(p));
	} catch {
		return null;
	}
}

function getActiveFilePathForMarking(plugin: any): string {
	try {
		const af = plugin?.app?.workspace?.getActiveFile?.();
		const p = normalizeNonEpochPath(af?.path);
		if (!p) return "";
		if (typeof plugin?.shouldIndexFile === "function" && af && !plugin.shouldIndexFile(af)) return "";
		if (typeof plugin?.indexer?.isFileKnown === "function" && !plugin.indexer.isFileKnown(p)) return "";
		return p;
	} catch {
		return "";
	}
}

async function isEntrySimilarToActiveFile(plugin: any, activeFilePath: string, entryPath: string): Promise<boolean> {
	const active = normalizeNonEpochPath(activeFilePath);
	const entry = normalizeNonEpochPath(entryPath);
	if (!active || !entry) return false;
	if (active === entry) return true;

	try {
		const hasPro = hasSimilarityAccess(plugin);
		if (!hasPro) return false;
	} catch {
		return false;
	}

	try {
		if (typeof plugin?.getSemanticRelatedPathsForFile === "function") {
			const related: unknown = await plugin.getSemanticRelatedPathsForFile(active);
			if (related instanceof Set) return related.has(entry);
		}
	} catch {
		// ignore
	}

	try {
		if (typeof plugin?.getGraphRelatedPathsForFile === "function") {
			const related: unknown = await plugin.getGraphRelatedPathsForFile(active);
			if (related instanceof Set) return related.has(entry);
		}
	} catch {
		// ignore
	}

	return false;
}

export async function applyMarkColorWithContext(plugin: EpochPlugin, args: {
	entryPath: string;
	nextColorIndex: number | null;
	currentColorIndex?: number | null;
}): Promise<boolean> {
	const entry = normalizeNonEpochPath(args.entryPath);
	if (!entry) return false;
	const next = normalizeMarkColorIndex(args.nextColorIndex);

	try {
		await (plugin as any).ensureIndexLoaded?.();
	} catch {
		// ignore
	}
	try {
		await (plugin as any).waitForExcludedSync?.();
	} catch {
		// ignore
	}

	const indexer = plugin.indexer;

	const inheritedSourcePath = getCachedInheritedSourcePath(plugin as any, entry);
	const explicit = (() => {
		try {
			return normalizeMarkColorIndex(indexer.getFileMarkColor(entry));
		} catch {
			return null;
		}
	})();

	const current = normalizeMarkColorIndex(
		typeof args.currentColorIndex === "number" ? args.currentColorIndex : explicit ?? getCachedInheritedMarkColorIndex(plugin as any, entry)
	);

	const activeFilePath = getActiveFilePathForMarking(plugin as any);
	const isActiveInherited = activeFilePath ? isPathInheritedMarked(plugin as any, indexer, activeFilePath) : false;
	const isEntryExplicit = explicit != null;
	const isEntryInherited = !isEntryExplicit && (!!inheritedSourcePath || isPathInheritedMarked(plugin as any, indexer, entry));
	const isEntrySimilarToActive = activeFilePath ? await isEntrySimilarToActiveFile(plugin as any, activeFilePath, entry) : false;

	const fallbackCenter = getMarkCenterPathForGroupActions(indexer, entry, inheritedSourcePath);
	const resolvedAncestorPathFinal = await resolveMarkAncestorPath(plugin as any, indexer, fallbackCenter, inheritedSourcePath);

	const targets = computeTargetsForMarkMenuAction(plugin as any, {
		entryPath: entry,
		resolvedAncestorPath: resolvedAncestorPathFinal,
		isEntryInherited,
		isEntryExplicit,
		isEntrySimilarToActive,
		currentColorIndex: current,
		nextColorIndex: next,
		activeFilePath,
		isActiveFileInherited: isActiveInherited
	});

	const finalTargets = targets;

	let changed = false;
	for (const p of finalTargets) {
		if (!p || typeof p !== "string" || p.startsWith("epoch://")) continue;
		try {
			changed = !!indexer.setFileMarkColor(p, next) || changed;
		} catch {
			// ignore
		}
	}

	if (!changed) return false;
	try {
		(plugin as any).clearInheritedMarksCache?.();
	} catch {
		// ignore
	}

	try {
		await (plugin as any).recomputeInheritedMarksNow?.("mark-change");
	} catch {
		try {
			(plugin as any).scheduleInheritedMarkRecompute?.("mark-change");
		} catch {
			// ignore
		}
	}

	try {
		if (next != null && hasSimilarityAccess(plugin) && embeddingsSimilarityEnabled(plugin as any)) {
			for (const p of finalTargets) {
				try {
					(plugin as any).queueVectorUpdate?.(p);
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}

	try {
		if (typeof (plugin as any).persistIndex === "function") await (plugin as any).persistIndex({ skipEnsure: true });
		else await (plugin as any).persist?.({ skipEnsure: true });
	} catch {
		// ignore
	}
	try {
		(plugin as any).refreshEpochViews?.();
	} catch {
		// ignore
	}

	return true;
}
