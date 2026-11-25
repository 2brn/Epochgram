import type { EpochCanvas } from "../epoch-canvas";
import type { DateEntry } from "../../indexer/types";
import { normalizeReviewState } from "../../indexer/review-state";
import type { EpochPlugin } from "../../main";
import { frontmatterToIndexTokens } from "../../utils";
import { buildMiniSearchQueryParts } from "./search-parts";
import { getInheritedMarkIndexByPath, getParsedTimelineQuery, getSimilarScopeSignature, hasCurrentOnlyToken, hasHiddenOnlyToken, hasSimilarOnlyToken, isColorMarked, state } from "./shared";
import { TFile } from "obsidian";
type Runtime = { plugin?: EpochPlugin & { __timelineSearchIndexVersion?: number }; __indexVersion?: number };
const miniCache = new WeakMap<object, { signature: string; matches: Set<string> }>();
const matchCache = new WeakMap<object, { signature: string; matches: WeakMap<DateEntry, boolean> }>();
function normalize(text: string): string { return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\\/_.:\-\u2010-\u2015\u2212]+/g, " ").replace(/\s+/g, " ").trim(); }
export function matchesSearch(canvas: EpochCanvas, entry: DateEntry): boolean {
	const parsed = getParsedTimelineQuery(canvas);
	if (parsed.invalid) return false;
	if (!parsed.raw.trim()) return true;
	const c = state(canvas), runtime = canvas as unknown as Runtime, plugin = runtime.plugin;
	const inherited = getInheritedMarkIndexByPath(canvas);
	const signature = [parsed.raw, runtime.__indexVersion, plugin?.__timelineSearchIndexVersion, getSimilarScopeSignature(canvas, parsed), c.plugin?.__epochInheritedMarkComputedAt].join("|");
	let cached = matchCache.get(canvas);
	if (!cached || cached.signature !== signature) { cached = { signature, matches: new WeakMap() }; matchCache.set(canvas, cached); }
	const previous = cached.matches.get(entry); if (previous !== undefined) return previous;
	const finish = (value: boolean) => { cached.matches.set(entry, value); return value; };
	const tokens = parsed.fuzzyText.toLowerCase().split(/\s+/g);
	if (hasHiddenOnlyToken(parsed) && entry.reviewState !== "hidden") return finish(false);
	if (tokens.some(t => t === "$marked" || t === "!marked") && !isColorMarked(entry, inherited)) return finish(false);
	if (hasCurrentOnlyToken(parsed) && c.activeFilePath && entry.file !== c.activeFilePath) return finish(false);
	const base = c.relatedBasePath ?? c.activeFilePath;
	if (hasSimilarOnlyToken(parsed) && base && entry.file !== base && !c.relatedPaths?.has(entry.file)) return finish(false);
	const parts = buildMiniSearchQueryParts(parsed);
	if (!parts.hasAnySearch) return finish(true);
	if (plugin?.timelineSearchIndex?.searchFileIds) {
		const miniSignature = [parsed.raw, plugin.__timelineSearchIndexVersion].join("|");
		let mini = miniCache.get(canvas);
		if (!mini || mini.signature !== miniSignature) { mini = { signature: miniSignature, matches: plugin.timelineSearchIndex.searchFileIds(parts) }; miniCache.set(canvas, mini); }
		if (mini.matches.has(entry.file)) return finish(true);
	}
	const hayParts = [entry.file, entry.date, entry.originalDate ?? "", entry.summary, entry.source, normalizeReviewState(entry.reviewState), entry.markColor ? `mark:${entry.markColor}` : "", entry.pinned ? "pinned" : ""];
	const file = plugin?.app?.vault?.getAbstractFileByPath?.(entry.file);
	if (file instanceof TFile) {
		const metadata = plugin?.app.metadataCache?.getFileCache?.(file);
		for (const tag of metadata?.tags ?? []) hayParts.push(tag.tag);
		if (metadata?.frontmatter) hayParts.push(...frontmatterToIndexTokens(metadata.frontmatter));
	}
	const hay = normalize(hayParts.join("\n"));
	for (const token of [...parts.excludeTokens, ...parts.excludedPhrases]) if (hay.includes(normalize(token))) return finish(false);
	for (const phrase of parts.exactPhrases) if (!hay.includes(normalize(phrase))) return finish(false);
	for (const token of parts.includeText.split(/\s+/g).filter(Boolean)) if (!hay.includes(normalize(token))) return finish(false);
	return finish(true);
}
