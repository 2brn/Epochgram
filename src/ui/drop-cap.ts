const STOP_EN = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"but",
	"so",
	"yet",
	"for",
	"to",
	"of",
	"in",
	"on",
	"at",
	"by",
	"with",
	"from",
	"into",
	"over",
	"under",
	"about",
	"is",
	"am",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"do",
	"does",
	"did",
	"have",
	"has",
	"had",
	"will",
	"would",
	"can",
	"could",
	"may",
	"might",
	"must",
	"should",
	"not",
	"no",
	"if",
	"then",
	"than"
]);

function findLeadBoundary(
	text: string,
	stop: ReadonlySet<string> = STOP_EN,
	options?: { fallbackWordsWhenNoPunctuation?: number }
): number {
	const s = String(text ?? "");
	if (!s) return 0;

	// Stop at the first newline (lead should not cross lines).
	const nl = s.search(/[\r\n]/);
	const lineEnd = nl === -1 ? s.length : nl;
	if (lineEnd <= 0) return 0;

	// "Strong" punctuation that typically indicates a natural short lead boundary.
	// Intentionally excludes '.' by default to avoid stopping early on abbreviations like "U.S.".
	const isPunc = (ch: string) => /[,!?;:]/.test(ch);
	// If the first line contains punctuation at all, prefer using it as the lead boundary
	// rather than stop-words. This matches the UI intent: punctuation indicates a natural
	// short title-like prefix (e.g. "Checklist," or "Italy:").
	const lineHasPunctuation = /[,!?;:]/.test(s.slice(0, lineEnd));

	// Include numbers so we can stop at punctuation after years like "2025:".
	const reWord = /(?:\p{L}|\p{N})+(?:['’-](?:\p{L}|\p{N})+)?/gu;

	// If we have strong punctuation on the first line, prefer stopping at the FIRST occurrence
	// (even if it comes after a non-word character like ')': "(2013):").
	const lineSlice = s.slice(0, lineEnd);
	const punctPos = lineHasPunctuation ? lineSlice.search(/[,!?;:]/) : -1;

	// Sentence-ending period boundary: treat a '.' as a natural boundary only when it looks
	// like the end of a sentence (dot followed by whitespace or end-of-line, and preceded by
	// a lowercase letter/number/closing paren/bracket). This avoids common abbreviation cases
	// like "U.S." where the dot is preceded by an uppercase letter.
	let dotPos = -1;
	for (let i = 1; i < lineSlice.length; i++) {
		if (lineSlice[i] !== ".") continue;
		if (lineSlice[i - 1] === ".") continue; // avoid ellipsis/stacked dots
		const next = i + 1 < lineSlice.length ? lineSlice[i + 1] : "";
		if (next && !/\s/.test(next)) continue;
		if (!/(?:\p{Ll}|\p{N}|[)\]])/u.test(lineSlice[i - 1]!)) continue;
		dotPos = i;
		break;
	}

	// Boundary precedence:
	// - If we have a sentence-ending '.', prefer it when it occurs before the first strong
	//   punctuation (e.g. multi-sentence summaries that later contain commas).
	// - Otherwise, in punctuation-first mode, stop at the first strong punctuation.
	if (dotPos > 0 && (punctPos < 0 || dotPos < punctPos)) return dotPos;
	if (punctPos > 0) return punctPos;

	const fallbackWordsWhenNoPunctuation =
		options && typeof options.fallbackWordsWhenNoPunctuation === "number" && Number.isFinite(options.fallbackWordsWhenNoPunctuation)
			? Math.max(0, Math.floor(options.fallbackWordsWhenNoPunctuation))
			: 0;
	let m: RegExpExecArray | null;
	let sawContent = false;
	let lastEnd = 0;
	let foundBoundary = false;

	reWord.lastIndex = 0;

	while ((m = reWord.exec(s))) {
		const rawWord = m[0];
		const w = rawWord.toLowerCase();
		const start = m.index;
		if (start >= lineEnd) break;

		const isStop = stop.has(w);
		const fullEnd = Math.min(start + rawWord.length, lineEnd);
		const end = fullEnd;

		if (!lineHasPunctuation) {
			if (!sawContent) {
				if (!isStop) sawContent = true;
				lastEnd = end;
			} else {
				// After the first content word, a stop-word ends the lead (do not include it).
				if (isStop) {
					foundBoundary = true;
					break;
				}
				lastEnd = end;
			}
		} else {
			// Punctuation-first mode: include words (including stop-words) until punctuation.
			lastEnd = end;
		}

		// If the next char is punctuation, stop here (do NOT include the punctuation).
		if (end < lineEnd && isPunc(s[end]!)) {
			foundBoundary = true;
			break;
		}
	}

	// Optional fallback: only apply if we couldn't find any natural boundary
	// (no punctuation and no stop-word boundary).
	if (!lineHasPunctuation && !foundBoundary && fallbackWordsWhenNoPunctuation > 0) {
		reWord.lastIndex = 0;
		let w: RegExpExecArray | null;
		let wordCount = 0;
		let fallbackEnd = 0;
		while ((w = reWord.exec(s))) {
			const start = w.index;
			if (start >= lineEnd) break;
			const end = Math.min(start + w[0].length, lineEnd);
			fallbackEnd = end;
			wordCount++;
			if (wordCount >= fallbackWordsWhenNoPunctuation) break;
		}
		if (fallbackEnd > 0) return Math.max(0, Math.min(fallbackEnd, lineEnd));
	}

	return Math.max(0, Math.min(lastEnd, lineEnd));
}

export function splitLeadByStopWordsOrPunctuation(
	text: string,
	stop: ReadonlySet<string> = STOP_EN,
	options?: { fallbackWordsWhenNoPunctuation?: number }
): { prefix: string; rest: string } {
	const s = String(text ?? "");
	if (!s) return { prefix: "", rest: "" };
	const boundary = findLeadBoundary(s, stop, options);
	if (boundary <= 0) return { prefix: "", rest: s };
	if (boundary >= s.length) return { prefix: s, rest: "" };
	return {
		prefix: s.slice(0, boundary),
		rest: s.slice(boundary).trimStart()
	};
}
