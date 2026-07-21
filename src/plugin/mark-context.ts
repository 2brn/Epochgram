import type { EpochPlugin } from "../main";
import { MAX_MARK_COLORS, normalizeMarkColorIndex } from "../ui/mark-colors";
import { hasSimilarityAccess } from "./pro-feature-state";
import { embeddingsSimilarityEnabled } from "./similarity/config";
import {
	computeTargetsForMarkMenuAction,
	getMarkCenterPathForGroupActions,
	isPathInheritedMarked,
	resolveMarkAncestorPath
} from "../ui/mark-group";

type MarkContextIndexerLike = {
	isFileKnown(path: string): boolean;
	getFileMarkColor(path: string): number | null;
	getFileMarkHex?(path: string): string | null;
	setFileMarkColor(path: string, color: number | string | null): boolean;
};

type MarkContextPluginLike = EpochPlugin & {
	__epochInheritedMarkSourceByPath?: Map<string, string>;
	__epochInheritedMarkIndexByPath?: Map<string, number>;
	ensureIndexLoaded?: () => Promise<void>;
	waitForExcludedSync?: () => Promise<void>;
	clearInheritedMarksCache?: () => void;
	recomputeInheritedMarksNow?: (reason: string) => Promise<void>;
	scheduleInheritedMarkRecompute?: (reason: string) => void;
	queueVectorUpdate?: (path: string) => void;
	persistIndex?: (options?: { skipEnsure?: boolean }) => Promise<void>;
	persist?: (options?: { skipEnsure?: boolean }) => Promise<void>;
	refreshEpochViews?: () => void;
	getSemanticRelatedPathsForFile?: (path: string) => Promise<unknown>;
	getGraphRelatedPathsForFile?: (path: string) => Promise<unknown>;
	shouldIndexFile?: (file: unknown) => boolean;
	indexer: MarkContextIndexerLike;
};

function normalizeNonEpochPath(value: unknown): string {
	const p = typeof value === "string" ? String(value || "").trim() : "";
	if (!p || p.startsWith("epoch://")) return "";
	return p;
}

function getCachedInheritedSourcePath(plugin: MarkContextPluginLike, path: string): string | null {
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

function getCachedInheritedMarkColorIndex(plugin: MarkContextPluginLike, path: string): number | null {
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

function getActiveFilePathForMarking(plugin: MarkContextPluginLike): string {
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

async function isEntrySimilarToActiveFile(plugin: MarkContextPluginLike, activeFilePath: string, entryPath: string): Promise<boolean> {
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
	nextColorIndex: number | string | null;
	currentColorIndex?: number | null;
}): Promise<boolean> {
	const entry = normalizeNonEpochPath(args.entryPath);
	if (!entry) return false;
	const state = plugin as MarkContextPluginLike;

	try {
		await state.ensureIndexLoaded?.();
	} catch {
		// ignore
	}
	try {
		await state.waitForExcludedSync?.();
	} catch {
		// ignore
	}

	const indexer = state.indexer;

	const inheritedSourcePath = getCachedInheritedSourcePath(state, entry);
	const explicitHex = (() => {
		try {
			return String(indexer.getFileMarkHex?.(entry) ?? "").trim();
		} catch {
			return "";
		}
	})();
	const explicit = (() => {
		try {
			return normalizeMarkColorIndex(indexer.getFileMarkColor(entry));
		} catch {
			return null;
		}
	})();

	const current = normalizeMarkColorIndex(
		typeof args.currentColorIndex === "number" ? args.currentColorIndex : explicit ?? getCachedInheritedMarkColorIndex(state, entry)
	);
	const nextColor = typeof args.nextColorIndex === "string"
		? args.nextColorIndex
		: normalizeMarkColorIndex(args.nextColorIndex);
	const dummyNextIndex = typeof args.nextColorIndex === "string"
		? (current == null ? 1 : ((current % MAX_MARK_COLORS) + 1))
		: nextColor;

	const activeFilePath = getActiveFilePathForMarking(state);
	const isActiveInherited = activeFilePath ? isPathInheritedMarked(state, indexer, activeFilePath) : false;
	const isEntryExplicit = explicit != null || !!explicitHex;
	const isEntryInherited = !isEntryExplicit && (!!inheritedSourcePath || isPathInheritedMarked(state, indexer, entry));
	const isEntrySimilarToActive = activeFilePath ? await isEntrySimilarToActiveFile(state, activeFilePath, entry) : false;

	const fallbackCenter = getMarkCenterPathForGroupActions(indexer, entry, inheritedSourcePath);
	const resolvedAncestorPathFinal = await resolveMarkAncestorPath(state, indexer, fallbackCenter, inheritedSourcePath);

	const targets = computeTargetsForMarkMenuAction(state, {
		entryPath: entry,
		resolvedAncestorPath: resolvedAncestorPathFinal,
		isEntryInherited,
		isEntryExplicit,
		isEntrySimilarToActive,
		currentColorIndex: current,
		nextColorIndex: dummyNextIndex,
		activeFilePath,
		isActiveFileInherited: isActiveInherited
	});

	const finalTargets = targets;

	let changed = false;
	for (const p of finalTargets) {
		if (!p || typeof p !== "string" || p.startsWith("epoch://")) continue;
		try {
			changed = !!indexer.setFileMarkColor(p, nextColor) || changed;
		} catch {
			// ignore
		}
	}

	if (!changed) return false;
	try {
		state.clearInheritedMarksCache?.();
	} catch {
		// ignore
	}

	try {
		await state.recomputeInheritedMarksNow?.("mark-change");
	} catch {
		try {
			state.scheduleInheritedMarkRecompute?.("mark-change");
		} catch {
			// ignore
		}
	}

	try {
		if (nextColor != null && hasSimilarityAccess(plugin) && embeddingsSimilarityEnabled(plugin)) {
			for (const p of finalTargets) {
				try {
					state.queueVectorUpdate?.(p);
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}

	try {
		if (typeof state.persistIndex === "function") await state.persistIndex({ skipEnsure: true });
		else await state.persist?.({ skipEnsure: true });
	} catch {
		// ignore
	}
	try {
		state.refreshEpochViews?.();
	} catch {
		// ignore
	}

	return true;
}
