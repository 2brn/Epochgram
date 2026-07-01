const DATE_FORMAT = "yyyy-MM-dd";

type ObsidianMomentLike = ((input?: unknown, fmt?: string, strict?: boolean) => {
	format?: (fmt: string) => string;
	isValid?: () => boolean;
	year?: () => number;
	month?: () => number;
	date?: () => number;
}) & {
	utc?: (
		input?: unknown,
		fmt?: string,
		strict?: boolean
	) => {
		format?: (fmt: string) => string;
		isValid?: () => boolean;
		year?: () => number;
		month?: () => number;
		date?: () => number;
	};
};

export function sanitizeSummaryText(input: string): string {
	try {
		const s = String(input ?? "");
		return s.replace(/\uFFFD/g, "");
	} catch {
		return "";
	}
}

export function normalizeIsoDatePrefix(input: string): string {
	const raw = String(input || "").trim();
	if (!raw) return "";
	const m = raw.match(/^(\d{4}-\d{2}-\d{2})[Tt].*$/);
	if (m && m[1]) return m[1];
	const compact = raw.match(/^(\d{4})(\d{2})(\d{2})[Tt].*$/);
	if (compact && compact[1] && compact[2] && compact[3]) {
		return `${compact[1]}-${compact[2]}-${compact[3]}`;
	}
	return raw;
}

export function normalizeDailyNoteDateFormatInput(format: string): string {
	let f = String(format || "").trim();
	if (!f) return "";
	// Keep normalization conservative:
	// - Obsidian uses Moment-style tokens and case matters.
	// - Lowercase tokens like `dddd` (weekday) and `mm` (minutes) are meaningful.
	// We only normalize common *date* intent patterns in a way that avoids breaking
	// weekday or time tokens.
	// Examples:
	// - note_ddmmyyy -> note_DDMMYYYY (if no time tokens)
	// - YY-MM-DD stays as-is
	f = f.replace(/yyyy/g, "YYYY");
	f = f.replace(/yyy/g, "YYYY");
	// Avoid touching weekday tokens like ddd/dddd.
	f = f.replace(/(?<!d)dd(?!d)/g, "DD");
	// Only normalize month `mm` -> `MM` when format does not look like it contains time.
	// (In Moment, `mm` is minutes.)
	if (!/[Hh:]/.test(f)) {
		f = f.replace(/(?<!m)mm(?!m)/g, "MM");
	}
	// Two-digit year is safe to normalize.
	f = f.replace(/yy/g, "YY");
	return f;
}

function getObsidianMoment(): ObsidianMomentLike | null {
	try {
		const root: Window | null = typeof window !== "undefined" ? window : null;
		const maybeMoment = root && "moment" in root ? (root as Window & { moment?: unknown }).moment : null;
		return typeof maybeMoment === "function"
			? (maybeMoment as ObsidianMomentLike)
			: null;
	} catch {
		return null;
	}
}

function coerce2DigitYear(year2: number): number {
	if (!Number.isFinite(year2)) return NaN;
	const y = Math.floor(year2);
	if (y < 0 || y > 99) return NaN;
	// Match chrono's pivot behavior: 70-99 => 1970-1999, 00-69 => 2000-2069
	return y >= 70 ? 1900 + y : 2000 + y;
}

function escapeRegexLiteral(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDateWithTokensUtc(dateUtc: Date, format: string): string | null {
	const f = normalizeDailyNoteDateFormatInput(format);
	if (!f) return "";
	const yyyy = String(dateUtc.getUTCFullYear()).padStart(4, "0");
	const yy = yyyy.slice(-2);
	const mm = String(dateUtc.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(dateUtc.getUTCDate()).padStart(2, "0");
	return f.replace(/YYYY/g, yyyy).replace(/YY/g, yy).replace(/MM/g, mm).replace(/DD/g, dd);
}

function formatYmdParts(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidYmdParts(year: number, month: number, day: number): boolean {
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
	if (month < 1 || month > 12) return false;
	if (day < 1) return false;
	const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	if (!Number.isFinite(maxDay) || maxDay < 1) return false;
	return day <= maxDay;
}

function hasValidFallbackFullDateTokens(format: string): boolean {
	const f = normalizeDailyNoteDateFormatInput(format);
	if (!f) return true;
	// Fallback parser supports only YYYY/YY/MM/DD + literals.
	const tokens = f.match(/YYYY|YY|MM|DD/g) ?? ([] as string[]);
	const hasYYYY = tokens.includes("YYYY");
	const hasYY = tokens.includes("YY");
	const yearTokCount = tokens.filter((t) => t === "YYYY" || t === "YY").length;
	const monthCount = tokens.filter((t) => t === "MM").length;
	const dayCount = tokens.filter((t) => t === "DD").length;
	if (hasYYYY && hasYY) return false;
	if (yearTokCount !== 1) return false;
	if (monthCount !== 1) return false;
	if (dayCount !== 1) return false;
	return true;
}

export function isValidDailyNoteDateFormat(format: string): boolean {
	const f = normalizeDailyNoteDateFormatInput(format);
	if (!f) return true;

	// Prefer Obsidian moment when available so we can accept rich formats:
	// weekdays, week numbers, day-of-year, time tokens, literals, etc.
	const moment = getObsidianMoment();
	if (moment) {
		const refs = [
			new Date(Date.UTC(2026, 0, 6)),
			new Date(Date.UTC(1985, 10, 23)),
			new Date(Date.UTC(2004, 1, 29)),
		];
		for (const refUtc of refs) {
			let sample = "";
			try {
				const fmtObj = typeof moment.utc === "function" ? moment.utc(refUtc) : moment(refUtc);
				sample = String(fmtObj?.format?.(f) ?? "");
			} catch {
				return false;
			}
			if (!sample) return false;
			let parsed:
				| {
						isValid?: () => boolean;
						year?: () => number;
						month?: () => number;
						date?: () => number;
				  }
				| undefined;
			try {
				parsed = typeof moment.utc === "function" ? moment.utc(sample, f, true) : moment(sample, f, true);
			} catch {
				return false;
			}
			if (!parsed || typeof parsed.isValid !== "function" || !parsed.isValid()) return false;
			const y = Number(parsed.year?.());
			const m = Number(parsed.month?.()) + 1;
			const d = Number(parsed.date?.());
			if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
			if (y !== refUtc.getUTCFullYear()) return false;
			if (m !== refUtc.getUTCMonth() + 1) return false;
			if (d !== refUtc.getUTCDate()) return false;
		}
		return true;
	}

	if (!hasValidFallbackFullDateTokens(f)) return false;

	// Fallback: require a full date with tokens we can reliably parse.
	const refUtc = new Date(Date.UTC(2026, 0, 6));
	const sample = formatDateWithTokensUtc(refUtc, f);
	if (sample == null) return false;
	const expected = formatYmdParts(refUtc.getUTCFullYear(), refUtc.getUTCMonth() + 1, refUtc.getUTCDate());
	return parseDateFromDailyNoteFormat(sample, f) === expected;
}

export function parseDateFromDailyNoteFormat(text: string, format: string): string | null {
	const t = String(text || "");
	const f = normalizeDailyNoteDateFormatInput(format);
	if (!t || !f) return null;

	// Prefer Obsidian moment when available so we can parse rich formats.
	const moment = getObsidianMoment();
	if (moment) {
		try {
			const parsed = typeof moment.utc === "function" ? moment.utc(t, f, true) : moment(t, f, true);
			if (parsed && typeof parsed.isValid === "function" && parsed.isValid()) {
				const y = Number(parsed.year?.());
				const m = Number(parsed.month?.()) + 1;
				const d = Number(parsed.date?.());
				if (isValidYmdParts(y, m, d)) {
					return formatYmdParts(y, m, d);
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	if (!hasValidFallbackFullDateTokens(f)) return null;

	// Fallback parser: compile a regex from YYYY/YY/MM/DD tokens and literals.
	const tokens = f.match(/YYYY|YY|MM|DD/g) ?? ([] as string[]);
	const yearTok = tokens.includes("YYYY") ? "YYYY" : tokens.includes("YY") ? "YY" : null;
	if (!yearTok) return null;
	if (tokens.filter((x) => x === yearTok).length !== 1) return null;
	if (tokens.filter((x) => x === "MM").length !== 1) return null;
	if (tokens.filter((x) => x === "DD").length !== 1) return null;

	const reParts: string[] = ["^"];
	const groups: Array<"YYYY" | "YY" | "MM" | "DD"> = [];
	let i = 0;
	while (i < f.length) {
		const rest = f.slice(i);
		const tok = rest.startsWith("YYYY")
			? "YYYY"
			: rest.startsWith("YY")
				? "YY"
				: rest.startsWith("MM")
					? "MM"
					: rest.startsWith("DD")
						? "DD"
						: null;
		if (tok) {
			groups.push(tok);
			reParts.push(tok === "YYYY" ? "(\\d{4})" : tok === "YY" ? "(\\d{2})" : "(\\d{2})");
			i += tok.length;
			continue;
		}
		reParts.push(escapeRegexLiteral(f[i] ?? ""));
		i++;
	}
	reParts.push("$");
	const re = new RegExp(reParts.join(""));
	const m = t.match(re);
	if (!m) return null;

	const vals: Partial<Record<"YYYY" | "YY" | "MM" | "DD", number>> = {};
	for (let gi = 0; gi < groups.length; gi++) {
		const group = groups[gi];
		if (!group) continue;
		vals[group] = Number(m[gi + 1]);
	}
	const yearRaw = yearTok === "YYYY" ? vals.YYYY : vals.YY;
	const year = yearTok === "YYYY" ? Number(yearRaw) : coerce2DigitYear(Number(yearRaw));
	const month = Number(vals.MM);
	const day = Number(vals.DD);
	if (!isValidYmdParts(year, month, day)) return null;
	return formatYmdParts(year, month, day);
}

// Title-similarity (Jaro–Winkler) constants.
// Kept here so both semantic related notes and mark inheritance can share the same behavior.
export const NOTE_TITLE_SIMILARITY_JW_THRESHOLD = 0.85;
export const NOTE_TITLE_SIMILARITY_MAX_LEN_DIFF = 14;
const NOTE_TITLE_SIMILARITY_WINKLER_P = 0.1;
const NOTE_TITLE_SIMILARITY_WINKLER_MAX_PREFIX = 8;

// Topic editing:
// Use a sentinel value to represent an explicit per-file "no topic" override.
// This lets users exclude a note from inferred topic grouping (distinct note)
// while still keeping the topic system enabled globally.
const NO_TOPIC_SENTINEL = "__epoch_no_topic__";

export function isNoTopicSentinel(term: string): boolean {
	return String(term || "").trim() === NO_TOPIC_SENTINEL;
}

export function stripYamlFrontmatterBlock(text: string): string {
	const raw = String(text ?? "");
	if (!raw) return "";
	try {
		return raw.replace(/^[\uFEFF]?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	} catch {
		return raw;
	}
}

export function frontmatterToIndexTokens(frontmatter: unknown, options?: { excludeKeys?: string[] }): string[] {
	const exclude = new Set<string>();
	try {
		for (const k of options?.excludeKeys ?? []) exclude.add(String(k || ""));
	} catch {
		// ignore
	}

	const out: string[] = [];
	const seen = new Set<string>();

	const push = (s: string) => {
		const v = String(s ?? "").replace(/\s+/g, " ").trim();
		if (!v) return;
		if (seen.has(v)) return;
		seen.add(v);
		out.push(v);
	};

	const toScalarString = (value: unknown): string => {
		if (value == null) return "";
		if (typeof value === "string") return value;
		if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
		if (typeof value === "boolean") return value ? "true" : "false";
		if (typeof value === "bigint") return value.toString();
		if (typeof value === "symbol" || typeof value === "function") return "";
		if (typeof value === "object") {
			try {
				return JSON.stringify(value) ?? "";
			} catch {
				return "";
			}
		}
		try {
			if (value instanceof Date && Number.isFinite(value.getTime())) {
				return value.toISOString();
			}
		} catch {
			// ignore
		}
		return "";
	};

	const walk = (keyPath: string, value: unknown, depth: number) => {
		if (value == null) return;
		if (depth > 3) {
			const s = toScalarString(value);
			if (s) push(`${keyPath}:${s}`);
			return;
		}

		if (Array.isArray(value)) {
			for (const item of value) walk(keyPath, item, depth + 1);
			return;
		}

		const t = typeof value;
		if (t === "string" || t === "number" || t === "boolean") {
			const s = toScalarString(value);
			if (!s) return;
			const truncated = s.length > 2000 ? s.slice(0, 2000) : s;
			push(`${keyPath}:${truncated}`);
			return;
		}

		try {
			if (value instanceof Date && Number.isFinite(value.getTime())) {
				push(`${keyPath}:${value.toISOString()}`);
				return;
			}
		} catch {
			// ignore
		}

		if (value && typeof value === "object") {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				const childKey = String(k ?? "").trim();
				if (!childKey) continue;
				walk(`${keyPath}.${childKey}`, v, depth + 1);
			}
			return;
		}

		const s = toScalarString(value);
		if (s) push(`${keyPath}:${s}`);
	};

	try {
		const fm = frontmatter;
		if (!fm || typeof fm !== "object") return [];
		for (const [k, v] of Object.entries(fm as Record<string, unknown>)) {
			const key = String(k ?? "").trim();
			if (!key) continue;
			if (exclude.has(key.toLowerCase())) continue;
			walk(key, v, 0);
		}
	} catch {
		return [];
	}

	return out;
}

type ParsedTopicTerm =
	| { kind: "none"; raw: ""; name: "" }
	| { kind: "no-topic"; raw: string; name: "" }
	| { kind: "auto"; raw: string; name: string };

export function canonicalizeTopicTerm(rawTerm: string): string {
	const raw = String(rawTerm ?? "").trim();
	if (!raw) return "";
	if (isNoTopicSentinel(raw)) return NO_TOPIC_SENTINEL;
	return raw;
}

export function parseTopicTerm(rawTerm: string): ParsedTopicTerm {
	const raw0 = String(rawTerm ?? "").trim();
	if (!raw0) return { kind: "none", raw: "", name: "" };
	if (isNoTopicSentinel(raw0)) return { kind: "no-topic", raw: NO_TOPIC_SENTINEL, name: "" };
	const raw = canonicalizeTopicTerm(raw0);
	if (!raw) return { kind: "none", raw: "", name: "" };
	return { kind: "auto", raw, name: raw };
}

function topicSortKey(term: string): string {
	const parsed = parseTopicTerm(term);
	if (parsed.kind === "none" || parsed.kind === "no-topic") return "";
	return String(parsed.name).toLowerCase();
}

export function sortTopicTermsIgnorePrefix(a: string, b: string): number {
	const ka = topicSortKey(a);
	const kb = topicSortKey(b);
	if (ka !== kb) return ka.localeCompare(kb);
	return String(a || "").localeCompare(String(b || ""));
}

export function isAutoTopicTerm(term: string): boolean {
	return parseTopicTerm(term).kind === "auto";
}

function hashFNV1a(raw: string): string {
	let h = 2166136261;
	for (let i = 0; i < raw.length; i++) {
		h ^= raw.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16);
}

export function computeTextHash(raw: string): string {
	const s = String(raw ?? "");
	return hashFNV1a(`${s.length}\n${s}`);
}

export function computeAiSummaryInputHash(
	filePath: string,
	entryDate: string,
	inputText: string,
	maxChars: number = 6000
): string {
	const meta = `file:${filePath}\ndate:${entryDate}\n`;
	const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 6000;
	const clipped = String(inputText ?? "").slice(0, limit);
	return hashFNV1a(meta + clipped);
}

export function formatDate(d: Date): string {
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const yyyy = d.getFullYear().toString();

	return DATE_FORMAT
		.replace(/dd/g, dd)
		.replace(/MM/g, mm)
		.replace(/yyyy/g, yyyy);
}

export function getNoteTitleFromPath(filePath: string): string {
	const p = String(filePath || "");
	const base = p.split("/").pop() || p;
	return base.replace(/\.md$/i, "");
}

export function getFolderPathFromFilePath(filePath: string): string {
	const p = String(filePath || "").trim();
	if (!p) return "";
	const idx = p.lastIndexOf("/");
	return idx >= 0 ? p.slice(0, idx) : "";
}

const LIKELY_TEXT_EXTENSIONS = new Set([
	"md",
	"markdown",
	"mdown",
	"mkd",
	"mdx",
	"canvas",
	"txt",
	"html",
	"htm",
	"json",
	"csv",
	"tsv"
]);

export function isLikelyTextFileExtension(extRaw: string): boolean {
	const ext = String(extRaw || "").trim().toLowerCase();
	if (!ext) return false;
	return LIKELY_TEXT_EXTENSIONS.has(ext);
}

function isEpochgramExportHtmlPath(pathRaw: string): boolean {
	const p = String(pathRaw || "").trim();
	if (!p) return false;
	const base = p.split("/").pop() || p;
	const leaf = String(base || "").trim().toLowerCase();
	return leaf.startsWith("epochgram-") && (leaf.endsWith(".html") || leaf.endsWith(".htm"));
}

export function isLikelyTextFilePath(pathRaw: string): boolean {
	const p = String(pathRaw || "").trim();
	if (!p) return false;
	const base = p.split("/").pop() || p;
	// Epochgram exports: keep searchable by filename/path, but treat as non-text so
	// AI summaries / epochs / vectors never try to consume the HTML body.
	if (isEpochgramExportHtmlPath(p)) return false;
	const dot = base.lastIndexOf(".");
	const ext = dot >= 0 ? base.slice(dot + 1) : "";
	return isLikelyTextFileExtension(ext);
}

export function normalizeTitleForSimilarity(raw: string): string {
	let s = String(raw || "");
	s = s.replace(/\.md$/i, "");
	// Remove common date patterns from note titles so daily-note naming
	// conventions don't skew title-based similarity.
	// Examples: 2025-12-31, 2025/12/31, 2025.12.31, 31-12-2025, 31122025
	// (This only affects title-similarity; embeddings still use content.)
	try {
		// yyyy-mm-dd (or with / . _)
		s = s.replace(/\b\d{4}[-/._]\d{1,2}[-/._]\d{1,2}\b/g, " ");
		// dd-mm-yyyy (or with / . _), also supports 2-digit year
		s = s.replace(/\b\d{1,2}[-/._]\d{1,2}[-/._]\d{2,4}\b/g, " ");
		// yyyymmdd / ddmmyyyy compact
		s = s.replace(/\b\d{8}\b/g, " ");
	} catch {
		// ignore
	}
	s = s.toLowerCase();
	// Unify common separators into spaces.
	s = s.replace(/[\s_\-–—]+/g, " ");
	// Also strip spaced date patterns after separator normalization.
	// Examples: "2025 12 31" or "31 12 2025"
	s = s.replace(/\b\d{4}\s+\d{1,2}\s+\d{1,2}\b/g, " ");
	s = s.replace(/\b\d{1,2}\s+\d{1,2}\s+\d{2,4}\b/g, " ");
	// Drop most punctuation but keep letters/numbers from all scripts.
	// (Unicode property escapes; supported in modern JS runtimes.)
	try {
		s = s.replace(/[^\p{L}\p{N} ]+/gu, " ");
	} catch {
		s = s.replace(/[^a-z0-9 ]+/g, " ");
	}
	s = s.replace(/\s+/g, " ").trim();
	return s;
}

export function jaroWinkler(aRaw: string, bRaw: string): number {
	const a = String(aRaw || "");
	const b = String(bRaw || "");
	if (!a && !b) return 1;
	if (!a || !b) return 0;
	if (a === b) return 1;

	const aLen = a.length;
	const bLen = b.length;
	const matchDistance = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);

	const aMatches = new Array<boolean>(aLen).fill(false);
	const bMatches = new Array<boolean>(bLen).fill(false);

	let matches = 0;
	for (let i = 0; i < aLen; i++) {
		const start = Math.max(0, i - matchDistance);
		const end = Math.min(i + matchDistance + 1, bLen);
		for (let j = start; j < end; j++) {
			if (bMatches[j]) continue;
			if (a[i] !== b[j]) continue;
			aMatches[i] = true;
			bMatches[j] = true;
			matches++;
			break;
		}
	}

	if (matches === 0) return 0;

	let t = 0;
	let k = 0;
	for (let i = 0; i < aLen; i++) {
		if (!aMatches[i]) continue;
		while (k < bLen && !bMatches[k]) k++;
		if (k < bLen && a[i] !== b[k]) t++;
		k++;
	}
	const transpositions = t / 2;

	const m = matches;
	const jaro = (m / aLen + m / bLen + (m - transpositions) / m) / 3;

	let prefix = 0;
	const maxPrefix = NOTE_TITLE_SIMILARITY_WINKLER_MAX_PREFIX;
	for (let i = 0; i < Math.min(maxPrefix, aLen, bLen); i++) {
		if (a[i] === b[i]) prefix++;
		else break;
	}
	const p = NOTE_TITLE_SIMILARITY_WINKLER_P;
	return jaro + prefix * p * (1 - jaro);
}