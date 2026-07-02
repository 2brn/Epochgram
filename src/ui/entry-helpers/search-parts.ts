import type { TimelineQuery } from "../timeline-search";

export function buildMiniSearchQueryParts(parsed: TimelineQuery): {
	includeText: string;
	excludeTokens: string[];
	exactPhrases: string[];
	excludedPhrases: string[];
	hasAnySearch: boolean;
} {
	const isBehaviorToken = (tokenRaw: string): boolean => {
		const token = String(tokenRaw || "").trim().toLowerCase();
		return token === "!marked" || token === "!hidden" || token === "!similar"
			|| token === "!current" || token === "$marked" || token === "$hidden" || token === "$similar"
			|| token === "$current";
	};
	const include: string[] = [];
	const exclude: string[] = [];
	try {
		const toks = String(parsed?.fuzzyText || "")
			.split(/\s+/g)
			.map((t) => String(t || "").trim())
			.filter(Boolean);
		for (const tok of toks) {
			const low = tok.toLowerCase();
			if (tok.startsWith("-") && tok.length > 1) {
				const ex = tok.slice(1);
				if (isBehaviorToken(ex)) continue;
				exclude.push(ex);
				continue;
			}
			if (isBehaviorToken(low)) continue;
			include.push(tok);
		}
	} catch {
		// ignore
	}
	const exactPhrases = (() => {
		try {
			return (parsed?.exactPhrases ?? []).map((p) => String(p || "").trim()).filter(Boolean);
		} catch {
			return [];
		}
	})();
	const excludedPhrases = (() => {
		try {
			return (parsed?.excludedPhrases ?? []).map((p) => String(p || "").trim()).filter(Boolean);
		} catch {
			return [];
		}
	})();
	const includeText = include.join(" ").trim();
	const excludeTokens = exclude.map((t) => String(t || "").trim()).filter(Boolean);
	return {
		includeText,
		excludeTokens,
		exactPhrases,
		excludedPhrases,
		hasAnySearch: includeText.length > 0 || excludeTokens.length > 0 || exactPhrases.length > 0 || excludedPhrases.length > 0
	};
}
