import {
	getNoteTitleFromPath,
	normalizeTitleForSimilarity,
	jaroWinkler,
	NOTE_TITLE_SIMILARITY_JW_THRESHOLD,
	NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF
} from "../utils";
import { MAX_MARK_COLORS } from "./mark-colors";

export type SimilarityIndexFiles = Record<string, { v?: number[] } | undefined>;

export type InheritedMarkData = {
	indexByPath: Map<string, number>;
	sourceByPath: Map<string, string>;
	reasonByPath?: Map<string, InheritedMarkReason>;
};

export type PrecomputedVectorCandidates = Map<string, Array<{ path: string; score: number }>>;
export type PrecomputedTermCandidates = Map<string, Array<{ path: string; score: number }>>;
export type PrecomputedGraphCandidates = Map<string, Array<{ path: string; score?: number }>>;

export type InheritedMarkReason = "embedding" | "topic" | "title" | "link" | "tag" | "unknown";

export type EpochChildRecord = { path: string; lineCount: number };

function normalizeMarkIndex(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	const v = Math.floor(value);
	if (v >= 1 && v <= MAX_MARK_COLORS) return v;
	return null;
}

function dot(a: number[], b: number[]): number {
	let sum = 0;
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) sum += (a[i] || 0) * (b[i] || 0);
	return sum;
}

function sortedVectorCandidates(
	centerPath: string,
	centerVector: number[],
	storeFiles: SimilarityIndexFiles,
	threshold: number
): Array<{ path: string; score: number }> {
	const candidates: Array<{ path: string; score: number }> = [];

	for (const [otherPath, otherRec] of Object.entries(storeFiles)) {
		if (!otherPath || otherPath === centerPath) continue;
		const v2 = otherRec?.v;
		if (!Array.isArray(v2) || v2.length === 0) continue;
		const score = dot(centerVector, v2);
		if (threshold > 0 && score < threshold) continue;
		candidates.push({ path: otherPath, score });
	}

	if (candidates.length === 0) return [];
	candidates.sort((a, b) => b.score - a.score);
	return candidates;
}

export function computeInheritedMarkData(args: {
	visiblePaths: Iterable<string>;
	seedPaths?: Iterable<string>;
	storeFiles: SimilarityIndexFiles;
	vectorCandidatesBySeedPath?: PrecomputedVectorCandidates;
	termCandidatesBySeedPath?: PrecomputedTermCandidates;
	linkCandidatesBySeedPath?: PrecomputedGraphCandidates;
	tagCandidatesBySeedPath?: PrecomputedGraphCandidates;
	canMatch?: (seedPath: string, candidatePath: string, reason: InheritedMarkReason) => boolean;
	getFileMarkColor: (path: string) => unknown;
	getEpochChildRecords?: (epochPath: string) => EpochChildRecord[];
	threshold: number;
	termMinScore?: number;
	titleJwThreshold?: number;
}): InheritedMarkData | null {
	const { visiblePaths, storeFiles, getFileMarkColor } = args;
	const threshold = Number(args.threshold);
	const termMinScoreRaw = Number(args.termMinScore);
	const termMinScore = Number.isFinite(termMinScoreRaw) ? termMinScoreRaw : 0;

	const titleJwRaw = Number(args.titleJwThreshold);
	const titleJwThreshold = Number.isFinite(titleJwRaw)
		? Math.max(0, Math.min(1, titleJwRaw))
		: NOTE_TITLE_SIMILARITY_JW_THRESHOLD;
	const titleMaxLenDiff = NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF;

	const visible = new Set<string>();
	for (const p of visiblePaths) {
		if (typeof p === "string" && p) visible.add(p);
	}
	if (visible.size === 0) return null;

	const ownMarked = new Map<string, number>();
	const vectorSeeds: Array<{ path: string; idx: number; v: number[] }> = [];
	const termSeeds: Array<{ path: string; idx: number }> = [];
	const titleSeeds: Array<{ path: string; idx: number; title: string }> = [];

	for (const p of visible) {
		const idx = normalizeMarkIndex(getFileMarkColor(p));
		if (idx == null) continue;
		ownMarked.set(p, idx);
	}

	const seedIter: Iterable<string> = args.seedPaths ? args.seedPaths : visible;
	const seenSeed = new Set<string>();
	for (const p of seedIter) {
		if (typeof p !== "string" || !p) continue;
		if (p.startsWith("epoch://")) continue;
		if (seenSeed.has(p)) continue;
		seenSeed.add(p);
		const idx = normalizeMarkIndex(getFileMarkColor(p));
		if (idx == null) continue;
		termSeeds.push({ path: p, idx });
		try {
			const title = normalizeTitleForSimilarity(getNoteTitleFromPath(p));
			if (title) titleSeeds.push({ path: p, idx, title });
		} catch {
			// ignore
		}
		const v = storeFiles[p]?.v;
		if (Array.isArray(v) && v.length > 0) {
			vectorSeeds.push({ path: p, idx, v });
		}
	}

	const hasTermSeeds = termSeeds.length > 0 && !!args.termCandidatesBySeedPath;
	if (vectorSeeds.length === 0 && titleSeeds.length === 0 && !hasTermSeeds) {
		// No seeds => no expansion.
		return ownMarked.size > 0 ? { indexByPath: ownMarked, sourceByPath: new Map(), reasonByPath: new Map() } : null;
	}

	const PRIORITY: Record<InheritedMarkReason, number> = {
		link: 1,
		tag: 2,
		title: 3,
		topic: 4,
		embedding: 5,
		unknown: 99
	};

	type BestPick = { priority: number; score: number; idx: number; seedPath: string; reason: InheritedMarkReason };
	const best = new Map<string, BestPick>();

	const shouldConsiderCandidate = (candPath: string): boolean => {
		if (!candPath) return false;
		if (!visible.has(candPath)) return false;
		if (candPath.startsWith("epoch://")) return false;
		if (ownMarked.has(candPath)) return false;
		return true;
	};

	const betterThan = (next: BestPick, prev: BestPick): boolean => {
		if (next.priority !== prev.priority) return next.priority < prev.priority;
		if (next.score !== prev.score) return next.score > prev.score;
		// Tie-break deterministically so results don't flap.
		return next.seedPath < prev.seedPath;
	};

	const addCandidate = (candPath: string, seedPath: string, idx: number, reason: InheritedMarkReason, score: number): void => {
		if (!shouldConsiderCandidate(candPath)) return;
		try {
			if (typeof args.canMatch === "function" && !args.canMatch(seedPath, candPath, reason)) return;
		} catch {
			return;
		}
		const prio = PRIORITY[reason] ?? 99;
		const safeScore = Number.isFinite(score) ? score : 0;
		const next: BestPick = { priority: prio, score: safeScore, idx, seedPath, reason };
		const prev = best.get(candPath);
		if (!prev || betterThan(next, prev)) best.set(candPath, next);
	};

	// Link candidates (highest priority)
	if (args.linkCandidatesBySeedPath && termSeeds.length > 0) {
		for (const seed of termSeeds) {
			const pre = args.linkCandidatesBySeedPath.get(seed.path);
			if (!pre || pre.length === 0) continue;
			for (const cand of pre) {
				const candPath = typeof cand?.path === "string" ? cand.path : "";
				if (!candPath || candPath === seed.path) continue;
				addCandidate(candPath, seed.path, seed.idx, "link", typeof cand?.score === "number" ? cand.score : 1);
			}
		}
	}

	// Tag candidates
	if (args.tagCandidatesBySeedPath && termSeeds.length > 0) {
		for (const seed of termSeeds) {
			const pre = args.tagCandidatesBySeedPath.get(seed.path);
			if (!pre || pre.length === 0) continue;
			for (const cand of pre) {
				const candPath = typeof cand?.path === "string" ? cand.path : "";
				if (!candPath || candPath === seed.path) continue;
				addCandidate(candPath, seed.path, seed.idx, "tag", typeof cand?.score === "number" ? cand.score : 1);
			}
		}
	}

	// Title threshold expansion (Jaro–Winkler).
	// This helps inherit marks even when vectors are missing for some notes.
	if (titleSeeds.length > 0 && titleJwThreshold > 0) {
		const visibleTitles = new Map<string, string>();
		for (const p of visible) {
			if (p.startsWith("epoch://")) continue;
			if (ownMarked.has(p)) continue;
			try {
				const t = normalizeTitleForSimilarity(getNoteTitleFromPath(p));
				if (t) visibleTitles.set(p, t);
			} catch {
				// ignore
			}
		}

		for (const seed of titleSeeds) {
			for (const [candPath, candTitle] of visibleTitles) {
				if (candPath === seed.path) continue;
				if (titleMaxLenDiff >= 0) {
					const diff = Math.abs(seed.title.length - candTitle.length);
					if (diff > titleMaxLenDiff) continue;
				}
				const score = jaroWinkler(seed.title, candTitle);
				if (score < titleJwThreshold) continue;
				addCandidate(candPath, seed.path, seed.idx, "title", score);
			}
		}
	}

	// Topic similarity expansion (zero-shot). This is only used when precomputed candidates are provided.
	// termMinScore: 0 disables topics
	if (args.termCandidatesBySeedPath && termSeeds.length > 0 && termMinScore > 0 && termMinScore < 1) {
		for (const seed of termSeeds) {
			const pre = args.termCandidatesBySeedPath.get(seed.path);
			if (!pre || pre.length === 0) continue;
			for (const cand of pre) {
				if (!cand || typeof cand.path !== "string" || !cand.path) continue;
				if (cand.path === seed.path) continue;
				if (cand.score < termMinScore) continue;
				addCandidate(cand.path, seed.path, seed.idx, "topic", cand.score);
			}
		}
	}

	// Embedding similarity expansion (lowest priority)
	for (const seed of vectorSeeds) {
		// threshold: 0 disables vectors
		if (!(threshold > 0 && threshold < 1)) break;
		const pre = args.vectorCandidatesBySeedPath?.get(seed.path);
		const candidates = pre && pre.length > 0 ? pre : sortedVectorCandidates(seed.path, seed.v, storeFiles, threshold);
		for (const cand of candidates) {
			if (threshold > 0 && cand.score < threshold) continue;
			addCandidate(cand.path, seed.path, seed.idx, "embedding", cand.score);
		}
	}

	const indexByPath = new Map<string, number>(ownMarked);
	const sourceByPath = new Map<string, string>();
	const reasonByPath = new Map<string, InheritedMarkReason>();
	for (const [p, info] of best) {
		indexByPath.set(p, info.idx);
		sourceByPath.set(p, info.seedPath);
		reasonByPath.set(p, info.reason);
	}

	// Epoch entries: derive inherited mark color from marked child records only.
	if (typeof args.getEpochChildRecords === "function") {
		for (const p of visible) {
			if (!p.startsWith("epoch://")) continue;
			if (ownMarked.has(p)) continue;
			let children: EpochChildRecord[] = [];
			try {
				children = args.getEpochChildRecords(p) ?? [];
			} catch {
				children = [];
			}
			if (!Array.isArray(children) || children.length === 0) continue;

			const byColor = new Map<
				number,
				{ count: number; lines: number; sourcePath: string; sourceLines: number }
			>();
			for (const child of children) {
				if (!child || typeof child.path !== "string" || !child.path) continue;
				// Only consider child records that are actually rendered with a color in this view.
				const renderedIdx = indexByPath.get(child.path);
				if (renderedIdx == null) continue;
				const lineCount = typeof child.lineCount === "number" && Number.isFinite(child.lineCount)
					? Math.max(0, Math.floor(child.lineCount))
					: 0;
				const rec = byColor.get(renderedIdx) ?? { count: 0, lines: 0, sourcePath: "", sourceLines: -1 };
				rec.count += 1;
				rec.lines += lineCount;
				if (lineCount > rec.sourceLines) {
					rec.sourceLines = lineCount;
					rec.sourcePath = child.path;
				}
				byColor.set(renderedIdx, rec);
			}
			if (byColor.size === 0) continue;

			let bestIdx: number | null = null;
			let bestCount = -1;
			let bestLines = -1;
			let bestSourcePath = "";
			for (const [idx, rec] of byColor) {
				if (rec.count > bestCount || (rec.count === bestCount && rec.lines > bestLines)) {
					bestIdx = idx;
					bestCount = rec.count;
					bestLines = rec.lines;
					bestSourcePath = rec.sourcePath;
				}
			}
			if (bestIdx != null) {
				indexByPath.set(p, bestIdx);
				if (bestSourcePath) sourceByPath.set(p, bestSourcePath);
			}
		}
	}

	return indexByPath.size > 0 ? { indexByPath, sourceByPath, reasonByPath } : null;
}
