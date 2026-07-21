import { normalizeMarkColorIndex } from "./mark-colors";
import { hasSimilarityAccess } from "../plugin/pro-feature-state";
import { embeddingsSimilarityEnabled } from "../plugin/similarity/config";
import type { EpochPlugin } from "../main";

type MarkGroupPluginLike = EpochPlugin & {
	__epochInheritedMarkSourceByPath?: Map<string, string>;
	getSemanticRelatedPathsForFile?: (path: string) => Promise<unknown>;
	getGraphRelatedPathsForFile?: (path: string) => Promise<unknown>;
	getSemanticRelatedScoredForFile?: (path: string) => Promise<unknown>;
};

type MarkGroupIndexerLike = {
	getFileMarkColor(path: string): number | null | undefined;
	getFileMarkHex?(path: string): string | null | undefined;
};

type ScoredPathLike = { path?: string };

function normalizeNonEpochPath(value: unknown): string {
	const p = typeof value === "string" ? String(value || "").trim() : "";
	if (!p || p.startsWith("epoch://")) return "";
	return p;
}

function hasExplicitMark(indexer: MarkGroupIndexerLike, path: string): boolean {
	try {
		const hex = String(indexer.getFileMarkHex?.(path) ?? "").trim();
		if (hex) return true;
	} catch {
		// ignore
	}
	try {
		const explicit = normalizeMarkColorIndex(indexer.getFileMarkColor(path));
		return explicit != null;
	} catch {
		return false;
	}
}


export function isPathInheritedMarked(plugin: unknown, indexer: MarkGroupIndexerLike, path: string): boolean {
	const p = normalizeNonEpochPath(path);
	if (!p) return false;

	try {
		if (hasExplicitMark(indexer, p)) return false;
	} catch {
		// ignore
	}

	try {
		const srcMap: unknown = (plugin as MarkGroupPluginLike | null | undefined)?.__epochInheritedMarkSourceByPath;
		if (!(srcMap instanceof Map)) return false;
		const src = normalizeNonEpochPath(srcMap.get(p));
		return !!src && src !== p;
	} catch {
		return false;
	}
}

export function computeTargetsForMarkMenuAction(_plugin: unknown, args: {
	entryPath: string;
	resolvedAncestorPath: string;
	isEntryInherited: boolean;
	isEntryExplicit: boolean;
	isEntrySimilarToActive: boolean;
	currentColorIndex: number | null;
	nextColorIndex: number | string | null;
	activeFilePath: string;
	isActiveFileInherited: boolean;
}): Set<string> {
	const entry = normalizeNonEpochPath(args.entryPath);
	const ancestor = normalizeNonEpochPath(args.resolvedAncestorPath);
	const active = normalizeNonEpochPath(args.activeFilePath);
	const out = new Set<string>();

	if (!entry) return out;
	if (ancestor) out.add(ancestor);

	const current = normalizeMarkColorIndex(args.currentColorIndex);
	const isCustom = typeof args.nextColorIndex === "string";
	const next = normalizeMarkColorIndex(args.nextColorIndex);
	const isClear = !isCustom && next == null;
	const isRecolor = isCustom || (next != null && (current == null || next !== current));

	// Explicitly marked entries are always their own target.
	if (args.isEntryExplicit) {
		return new Set<string>([entry]);
	}

	// If an inherited-colored item is being recolored/cleared, always operate on its
	// ancestor (seed) (even if some other note is currently active).
	// The inherited recompute will update the whole group (including ancestor)
	// without turning descendants into explicit marks.
	if (args.isEntryInherited && (isClear || isRecolor)) {
		return new Set<string>([ancestor || entry]);
	}

	// With an active note open:
	// - if the clicked entry is the active note OR is similar/highlighted to it, always anchor on the active note
	// - otherwise, anchor on the clicked entry (start a new group there)
	// Note: even if the active note was previously inherited, we now promote it to an explicit seed when used as anchor.
	if (active) {
		if (args.isEntrySimilarToActive || entry === active) {
			return new Set<string>([active]);
		}
		return new Set<string>([entry]);
	}

	return new Set<string>([ancestor || entry]);
}

export async function getSimilarGroupPathsForMarking(
	plugin: unknown,
	centerPath: string
): Promise<Set<string>> {
	const out = new Set<string>();
	const base = String(centerPath || "");
	if (!base || base.startsWith("epoch://")) return out;
	out.add(base);
	const p = plugin as MarkGroupPluginLike;

	try {
		const hasPro = hasSimilarityAccess(p);
		if (!hasPro) return out;
		const vectorsEnabled = embeddingsSimilarityEnabled(p);

		if (vectorsEnabled && typeof p.getSemanticRelatedPathsForFile === "function") {
			const related: unknown = await p.getSemanticRelatedPathsForFile(base);
			if (related instanceof Set) {
				for (const p of related) {
					if (typeof p === "string" && p && !p.startsWith("epoch://")) out.add(p);
				}
			}
			return out;
		}

		if (typeof p.getGraphRelatedPathsForFile === "function") {
			const related: unknown = await p.getGraphRelatedPathsForFile(base);
			if (related instanceof Set) {
				for (const p of related) {
					if (typeof p === "string" && p && !p.startsWith("epoch://")) out.add(p);
				}
			}
		}
	} catch {
		// ignore
	}

	return out;
}

export function getMarkCenterPathForGroupActions(
	indexer: MarkGroupIndexerLike,
	entryPath: string,
	inheritedSourcePath: string | null
): string {
	const entry = String(entryPath || "");
	const inherited = inheritedSourcePath ? String(inheritedSourcePath || "") : "";
	if (!entry || entry.startsWith("epoch://")) return entry;
	if (!inherited || inherited.startsWith("epoch://") || inherited === entry) return entry;

	try {
		if (hasExplicitMark(indexer, entry)) return entry;
	} catch {
		// ignore
	}

	return inherited;
}

export async function resolveMarkAncestorPath(
	plugin: unknown,
	indexer: MarkGroupIndexerLike,
	entryPath: string,
	inheritedSourcePath?: string | null
): Promise<string> {
	const entry = normalizeNonEpochPath(entryPath);
	if (!entry) return String(entryPath || "");
	const p = plugin as MarkGroupPluginLike;

	// Explicitly marked entries are their own ancestor.
	try {
		if (hasExplicitMark(indexer, entry)) return entry;
	} catch {
		// ignore
	}

	// If the UI already knows the inherited source, trust it.
	const inherited = normalizeNonEpochPath(inheritedSourcePath);
	if (inherited && inherited !== entry) return inherited;

	// Try cached inherited-source map from the plugin.
	try {
		const srcMap: unknown = p.__epochInheritedMarkSourceByPath;
		if (srcMap instanceof Map) {
			const cached = normalizeNonEpochPath(srcMap.get(entry));
			if (cached && cached !== entry) return cached;
		}
	} catch {
		// ignore
	}

	// Fallback: scan semantic scored results for the first explicitly marked file.
	try {
		const hasPro = hasSimilarityAccess(p);
		if (hasPro && typeof p.getSemanticRelatedScoredForFile === "function") {
			const scoredRaw: unknown = await p.getSemanticRelatedScoredForFile(entry);
			const scored: ScoredPathLike[] = Array.isArray(scoredRaw) ? scoredRaw as ScoredPathLike[] : [];
			if (Array.isArray(scored)) {
				for (const item of scored) {
					const candidate = normalizeNonEpochPath(item?.path);
					if (!candidate || candidate === entry) continue;
					try {
						if (hasExplicitMark(indexer, candidate)) return candidate;
					} catch {
						// ignore
					}
				}
			}
		}
	} catch {
		// ignore
	}

	// Fallback: scan graph-related set for any explicitly marked file.
	try {
		const hasPro = hasSimilarityAccess(p);
		if (hasPro && typeof p.getGraphRelatedPathsForFile === "function") {
			const related: unknown = await p.getGraphRelatedPathsForFile(entry);
			if (related instanceof Set) {
				for (const p0 of related) {
					const candidate = normalizeNonEpochPath(p0);
					if (!candidate || candidate === entry) continue;
					try {
						if (hasExplicitMark(indexer, candidate)) return candidate;
					} catch {
						// ignore
					}
				}
			}
		}
	} catch {
		// ignore
	}

	// No ancestor found; treat as self.
	return entry;
}

export async function resolveMarkGroupAnchorPath(
	plugin: unknown,
	indexer: MarkGroupIndexerLike,
	entryPath: string,
	options?: {
		inheritedSourcePath?: string | null;
		targetColorIndex?: number | null;
	}
): Promise<string> {
	const entry = normalizeNonEpochPath(entryPath);
	if (!entry) return String(entryPath || "");

	const inherited = normalizeNonEpochPath(options?.inheritedSourcePath);
	const resolvedAncestor = await resolveMarkAncestorPath(plugin, indexer, entry, inherited);

	const targetIdx = (() => {
		const fromOpt = normalizeMarkColorIndex(options?.targetColorIndex);
		if (fromOpt != null) return fromOpt;
		try {
			return normalizeMarkColorIndex(indexer.getFileMarkColor(entry));
		} catch {
			// ignore
		}
		return null;
	})();

	// If we can't determine a color to optimize for, fall back to ancestor resolution.
	if (targetIdx == null) return resolvedAncestor;

	const candidates = new Set<string>();
	candidates.add(resolvedAncestor);
	candidates.add(entry);
	if (inherited) candidates.add(inherited);

	try {
		const around = await getSimilarGroupPathsForMarking(plugin, resolvedAncestor);
		for (const p0 of around) {
			const p = normalizeNonEpochPath(p0);
			if (!p) continue;
			try {
				const idx = indexer.getFileMarkColor(p);
				if (normalizeMarkColorIndex(idx) === targetIdx) candidates.add(p);
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}

	let best = resolvedAncestor;
	let bestCount = -1;
	for (const c of candidates) {
		const cand = normalizeNonEpochPath(c);
		if (!cand) continue;
		let group: Set<string> | null = null;
		try {
			group = await getSimilarGroupPathsForMarking(plugin, cand);
		} catch {
			group = null;
		}
		if (!group || group.size === 0) continue;
		let count = 0;
		for (const p0 of group) {
			const p = normalizeNonEpochPath(p0);
			if (!p) continue;
			try {
				const idx = indexer.getFileMarkColor(p);
				if (normalizeMarkColorIndex(idx) === targetIdx) count++;
			} catch {
				// ignore
			}
		}
		if (count > bestCount || (count === bestCount && cand < best)) {
			best = cand;
			bestCount = count;
		}
	}

	return best;
}
