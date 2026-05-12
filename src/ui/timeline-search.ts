import { parseAnyDate } from "../indexer/extractor";

export type TimelineQueryDateRange = { start: string; end: string };

export type TimelineQuery = {
	raw: string;
	invalid: boolean;
	exactPhrases: string[];
	excludedPhrases: string[];
	fuzzyText: string;
	dateRange: TimelineQueryDateRange | null;
};

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_ONE_TOKEN_RE = /^(\d{4}-\d{1,2}-\d{1,2})-(\d{4}-\d{1,2}-\d{1,2})$/;
const RANGE_DMY_DASH_ONE_TOKEN_RE = /^(\d{1,2}-\d{1,2}-\d{2,4})-(\d{1,2}-\d{1,2}-\d{2,4})$/;
const RANGE_DOTS_ONE_TOKEN_RE = /^([^\s]+)\.{2,3}([^\s]+)$/;
// One-token dash ranges for numeric dates that do NOT use '-' as a date separator.
// This intentionally avoids the ambiguous case where '-' could be both the date
// separator and the range separator.
const RANGE_NUM_DASH_ONE_TOKEN_RE = /^((?:\d{4}[./]\d{1,2}[./]\d{1,2})|(?:\d{1,2}[./]\d{1,2}[./]\d{2,4}))-((?:\d{4}[./]\d{1,2}[./]\d{1,2})|(?:\d{1,2}[./]\d{1,2}[./]\d{2,4}))$/;

function isDateKey(value: string): boolean {
	return DATE_KEY_RE.test(String(value || ""));
}

function stripDateTokenEdges(tokenRaw: string): string {
	let t = String(tokenRaw || "").trim();
	// Strip common punctuation around tokens so inputs like "(01-02-2026)" still work.
	t = t.replace(/^[[\](){} ,;:'"`\]]+/g, "");
	t = t.replace(/[[\](){} ,;:'"`\]]+$/g, "");
	return t.trim();
}

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

function parseNumericDateKey(tokenRaw: string): string | null {
	const t = stripDateTokenEdges(tokenRaw);
	if (!t) return null;

	const ymd = t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
	if (ymd) {
		const year = Number(ymd[1]);
		const month = Number(ymd[2]);
		const day = Number(ymd[3]);
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
		if (year <= 1000 || year >= 2100) return null;
		if (month < 1 || month > 12) return null;
		if (day < 1 || day > daysInMonth(year, month)) return null;
		return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}

	const dmy = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
	if (dmy) {
		const day = Number(dmy[1]);
		const month = Number(dmy[2]);
		const yRaw = String(dmy[3]);
		let year = Number(yRaw);
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
		if (yRaw.length === 2) year += year >= 70 ? 1900 : 2000;
		if (year <= 1000 || year >= 2100) return null;
		if (month < 1 || month > 12) return null;
		if (day < 1 || day > daysInMonth(year, month)) return null;
		return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	}

	return null;
}

function parseSearchDateKey(tokenRaw: string): string | null {
	const t = stripDateTokenEdges(tokenRaw);
	if (!t) return null;
	if (isDateKey(t)) return t;
	const numeric = parseNumericDateKey(t);
	if (numeric) return numeric;
	try {
		return parseAnyDate(t);
	} catch {
		return null;
	}
}

function normalizeRange(a: string, b: string): TimelineQueryDateRange | null {
	const da = parseSearchDateKey(a);
	const db = parseSearchDateKey(b);
	if (!da || !db) return null;
	const start = da <= db ? da : db;
	const end = da <= db ? db : da;
	return { start, end };
}

function isRangeConnector(tokenRaw: string): boolean {
	const t = String(tokenRaw || "").trim().toLowerCase();
	if (!t) return false;
	if (t === ".." || t === "..." || t === "-" || t === "–" || t === "—") return true;
	// (Query language only; keep this intentionally small and predictable.)
	if (t === "to" || t === "until" || t === "through" || t === "till" || t === "thru") return true;
	return false;
}

function extractQuotedPhrases(queryRaw: string): { stripped: string; phrases: string[]; excluded: string[] } {
	const q = String(queryRaw || "");
	const phrases: string[] = [];
	const excluded: string[] = [];
	// Simple double-quote extraction (no escaping). Supports exclusion like -"foo bar".
	const stripped = q.replace(/(-?)"([^"]*)"/g, (_m, dash, inner) => {
		const v = String(inner || "");
		if (v.trim()) {
			if (String(dash || "") === "-") excluded.push(v);
			else phrases.push(v);
		}
		return " ";
	});
	return { stripped, phrases, excluded };
}

export function parseTimelineQuery(queryRaw: string): TimelineQuery {
	const raw = String(queryRaw || "").trim();
	if (!raw) {
		return { raw: "", invalid: false, exactPhrases: [], excludedPhrases: [], fuzzyText: "", dateRange: null };
	}

	const { stripped, phrases, excluded } = extractQuotedPhrases(raw);
	const tokens = String(stripped || "").trim().split(/\s+/g).filter(Boolean);
	const fuzzyTokens: string[] = [];
	let dateRange: TimelineQueryDateRange | null = null;

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i] ?? "";
		const t = String(tok || "");

		if (!dateRange) {
			const m = t.match(RANGE_ONE_TOKEN_RE);
			if (m) {
				const r = normalizeRange(m[1]!, m[2]!);
				if (r) {
					dateRange = r;
					continue;
				}
			}
			const mdmy = t.match(RANGE_DMY_DASH_ONE_TOKEN_RE);
			if (mdmy) {
				const r = normalizeRange(mdmy[1]!, mdmy[2]!);
				if (r) {
					dateRange = r;
					continue;
				}
			}
			const mn = t.match(RANGE_NUM_DASH_ONE_TOKEN_RE);
			if (mn) {
				const r = normalizeRange(mn[1]!, mn[2]!);
				if (r) {
					dateRange = r;
					continue;
				}
			}
			const md = t.match(RANGE_DOTS_ONE_TOKEN_RE);
			if (md) {
				const r = normalizeRange(md[1]!, md[2]!);
				if (r) {
					dateRange = r;
					continue;
				}
			}
			const a = t;
			const b = tokens[i + 1] ?? "";
			const c = tokens[i + 2] ?? "";
			if (parseSearchDateKey(a) && isRangeConnector(b) && parseSearchDateKey(c)) {
				const r = normalizeRange(a, c);
				if (r) {
					dateRange = r;
					i += 2;
					continue;
				}
			}
		}

		fuzzyTokens.push(t);
	}

	return {
		raw,
		invalid: false,
		exactPhrases: phrases,
		excludedPhrases: excluded,
		fuzzyText: fuzzyTokens.join(" "),
		dateRange
	};
}

export function formatTimelineSearchBadge(queryRaw: string): string {
	const q = String(queryRaw || "").trim();
	if (!q) return "";
	return q;
}
