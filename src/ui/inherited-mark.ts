import { getFolderPathFromFilePath, getNoteTitleFromPath, normalizeTitleForSimilarity, jaroWinkler, NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF } from "../utils";
import { MAX_MARK_COLORS } from "./mark-colors";
export type InheritedMarkReason = "link" | "tag" | "title";
export type InheritedMarkData = { indexByPath: Map<string, number>; sourceByPath: Map<string, string>; reasonByPath: Map<string, InheritedMarkReason> };
export type PrecomputedGraphCandidates = Map<string, Array<{ path: string; score?: number }>>;
export function computeInheritedMarkData(args: {
	visiblePaths: Iterable<string>;
	seedPaths?: Iterable<string>;
	linkCandidatesBySeedPath?: PrecomputedGraphCandidates;
	tagCandidatesBySeedPath?: PrecomputedGraphCandidates;
	canMatch?: (seed: string, candidate: string, reason: InheritedMarkReason) => boolean;
	getFileMarkColor: (path: string) => unknown;
	getFileMarkHex?: (path: string) => unknown;
	titleJwThreshold?: number;
}): InheritedMarkData | null {
	const visible = new Set(args.visiblePaths);
	if (!visible.size) return null;
	const markIndex = (path: string): number | null => {
		const raw = args.getFileMarkColor(path);
		return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 && raw <= MAX_MARK_COLORS ? Math.floor(raw) : null;
	};
	const explicit = new Set<string>();
	const result: InheritedMarkData = { indexByPath: new Map(), sourceByPath: new Map(), reasonByPath: new Map() };
	for (const path of visible) {
		const color = markIndex(path);
		if (color != null || args.getFileMarkHex?.(path)) explicit.add(path);
		if (color != null) result.indexByPath.set(path, color);
	}
	const rawThreshold = Number(args.titleJwThreshold ?? 1);
	const threshold = Number.isFinite(rawThreshold) ? Math.max(0, Math.min(1, rawThreshold)) : 1;
	const priority = { link: 1, tag: 2, title: 3 };
	type Pick = { seed: string; color: number; reason: InheritedMarkReason; score: number };
	const best = new Map<string, Pick>();
	for (const seed of new Set(args.seedPaths ?? visible)) {
		const color = markIndex(seed);
		if (color == null) continue;
		const consider = (path: string, reason: InheritedMarkReason, score = 1) => {
			if (path === seed || !visible.has(path) || explicit.has(path) || args.canMatch?.(seed, path, reason) === false) return;
			score = Number.isFinite(score) ? score : 0;
			const previous = best.get(path);
			if (!previous || priority[reason] < priority[previous.reason] || (priority[reason] === priority[previous.reason] && (score > previous.score || (score === previous.score && seed < previous.seed)))) best.set(path, { seed, color, reason, score });
		};
		for (const candidate of args.linkCandidatesBySeedPath?.get(seed) ?? []) consider(candidate.path, "link", candidate.score);
		for (const candidate of args.tagCandidatesBySeedPath?.get(seed) ?? []) consider(candidate.path, "tag", candidate.score);
		if (threshold > 0) {
			const title = normalizeTitleForSimilarity(getNoteTitleFromPath(seed));
			for (const path of visible) {
				if (threshold === 1) { if (getFolderPathFromFilePath(seed) === getFolderPathFromFilePath(path)) consider(path, "title"); continue; }
				const other = normalizeTitleForSimilarity(getNoteTitleFromPath(path));
				if (!title || !other || Math.abs(title.length - other.length) > NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF) continue;
				const score = jaroWinkler(title, other);
				if (score >= threshold) consider(path, "title", score);
			}
		}
	}
	for (const [path, pick] of best) { result.indexByPath.set(path, pick.color); result.sourceByPath.set(path, pick.seed); result.reasonByPath.set(path, pick.reason); }
	return result.indexByPath.size ? result : null;
}
