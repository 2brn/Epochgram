import * as chrono from "chrono-node";
import { flattenForDates } from "./flattener";
import { formatDate } from "utils";

function buildStrictChrono() {
	const strict = new chrono.Chrono(chrono.en.GB);

	const bannedParserClasses = new Set([
		// casual
		"ENCasualDateParser",
		"ENCasualTimeParser",
		"ENCasualYearMonthParser",

		// relative
		"ENRelativeDateFormatParser",
		"ENPrioritizeForwardRefiner",
		"ENMergeRelativeResultRefiner",
		"ENTimeUnitAgoFormatParser",
		"ENTimeUnitWithinFormatParser",

		// time expressions
		"ENTimeExpressionParser",
		"ENISOTimeExpressionParser",
		"ENTimeParser",

		// weekdays
		"ENWeekdayParser",
	]);

	const bannedRefiners = new Set([
		"ENMergeRelativeResultRefiner",
		"ENPrioritizeForwardRefiner",
		"ENCasualDateRefiner"
	]);

	strict.parsers = strict.parsers.filter(p => {
		const name = p.constructor?.name || "";
		return !bannedParserClasses.has(name);
	});

	strict.refiners = strict.refiners.filter(r => {
		const name = r.constructor?.name || "";
		return !bannedRefiners.has(name);
	});

	return strict;
}

const strictChrono = buildStrictChrono();

const ORD = "(st|nd|rd|th)";
const MONTH = "(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)";

const MONTH_NAME_MAP: Record<string, number> = {
	jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
	apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
	aug: 8, august: 8, sep: 9, sept: 9, september: 9,
	oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isLikelyDate(t: string): boolean {
	const s = t.toLowerCase();

	const isValidYMD = (year: number, month: number, day: number): boolean => {
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
		if (year <= 1000 || year >= 2100) return false;
		if (month < 1 || month > 12) return false;
		if (day < 1) return false;
		const daysInMonth = new Date(year, month, 0).getDate();
		return day <= daysInMonth;
	};

	const hasValidNumericDate = (): boolean => {
		const scan = s.replace(/(\d)(?=\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/g, "$1 ");
		const yearFirst = /\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?=(?:\b|$|[^\d]|\d{4}[.\-/]))/g;
		let m: RegExpExecArray | null;
		while ((m = yearFirst.exec(scan))) {
			const year = Number(m[1]);
			const month = Number(m[2]);
			const day = Number(m[3]);
			if (isValidYMD(year, month, day)) {
				return true;
			}
		}

		const dayFirst = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?=(?:\b|$|[^\d]|\d{1,2}[.\-/]))/g;
		while ((m = dayFirst.exec(scan))) {
			const day = Number(m[1]);
			const month = Number(m[2]);
			const year = Number(m[3]);
			if (isValidYMD(year, month, day)) {
				return true;
			}
		}

		return false;
	};

	if (new RegExp(`\\b\\d{1,2}${ORD}?\\s+${MONTH}\\s+\\d{4}\\b`).test(s)) return true;
	if (new RegExp(`\\b${MONTH}\\s+\\d{1,2}${ORD}?,?\\s+\\d{4}\\b`).test(s)) return true;
	if (new RegExp(`\\b\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?\\s+${MONTH}\\s+\\d{4}\\b`).test(s)) return true;
	if (new RegExp(`\\b\\d{1,2}[\\-]${MONTH}[\\-]\\d{2,4}\\b`).test(s)) return true;

	if (/\b(\d{4})(\d{2})(\d{2})(?=\b|[^\d])/.test(s)) return true;

	if (hasValidNumericDate()) return true;

	return false;
}
const ORDER_INCREMENT = 0.01;

function daysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

function formatYMD(year: number, month: number, day: number): string {
	const yyyy = String(year).padStart(4, "0");
	const mm = String(month).padStart(2, "0");
	const dd = String(day).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function parseDateKeyToLocalDate(key: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
	const year = Number(key.slice(0, 4));
	const month = Number(key.slice(5, 7));
	const day = Number(key.slice(8, 10));
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
	if (year <= 1000 || year >= 2100) return null;
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > daysInMonth(year, month)) return null;
	const d = new Date(year, month - 1, day);
	d.setHours(0, 0, 0, 0);
	return d;
}

function expandInclusiveDateKeyRange(a: string, b: string): string[] {
	const da = parseDateKeyToLocalDate(a);
	const db = parseDateKeyToLocalDate(b);
	if (!da || !db) return [];
	const start = da.getTime() <= db.getTime() ? da : db;
	const end = da.getTime() <= db.getTime() ? db : da;
	const oneDay = 24 * 60 * 60 * 1000;
	const deltaDays = Math.round((end.getTime() - start.getTime()) / oneDay);
	const MAX_RANGE_DAYS = 3660;
	if (deltaDays < 0) return [];
	if (deltaDays > MAX_RANGE_DAYS) return [];
	const out: string[] = [];
	for (let i = 0; i <= deltaDays; i++) {
		const t = start.getTime() + i * oneDay;
		const d = new Date(t);
		d.setHours(0, 0, 0, 0);
		out.push(formatDate(d));
	}
	return out;
}

export function parseAnyDates(text: string): string[] {
	const flat = flattenForDates(text);
	if (!isLikelyDate(flat)) return [];
	const scan = flat.replace(/(\d)(?=\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})/g, "$1 ");

	type Token = { key: string; index: number; endIndex: number };
	const tokens: Token[] = [];

	const found = new Map<string, { key: string; order: number }>();
	const pushYMD = (year: number, month: number, day: number, order: number) => {
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return;
		if (year <= 1000 || year >= 2100) return;
		if (month < 1 || month > 12) return;
		if (day < 1) return;
		const dim = daysInMonth(year, month);
		if (day > dim) return;
		const key = formatYMD(year, month, day);
		const existing = found.get(key);
		if (!existing || order < existing.order) {
			found.set(key, { key, order });
		}
	};

	const compactYMD = /\b(\d{4})(\d{2})(\d{2})(?=\b|[^\d])/g;
	let match: RegExpExecArray | null;
	while ((match = compactYMD.exec(scan))) {
		const [, y, m, d] = match;
		const idx = typeof match.index === "number" ? match.index : 0;
		pushYMD(Number(y), Number(m), Number(d), idx);
		try {
			tokens.push({ key: formatYMD(Number(y), Number(m), Number(d)), index: idx, endIndex: idx + 8 });
		} catch {
			// ignore
		}
	}

	const dayMonthNameYear = new RegExp(`\\b(\\d{1,2})[\\-](${MONTH.slice(1, -1)})[\\-](\\d{2,4})\\b`, "gi");
	while ((match = dayMonthNameYear.exec(scan))) {
		const [, dRaw, mName, yRaw] = match;
		const idx = typeof match.index === "number" ? match.index : 0;
		const mon = MONTH_NAME_MAP[String(mName).toLowerCase()];
		if (!mon) continue;
		let year = Number(yRaw);
		if (String(yRaw).length === 2) year += year >= 70 ? 1900 : 2000;
		pushYMD(year, mon, Number(dRaw), idx + ORDER_INCREMENT);
		try {
			tokens.push({ key: formatYMD(year, mon, Number(dRaw)), index: idx, endIndex: idx + String(match[0] ?? "").length });
		} catch {
			// ignore
		}
	}

	const monthNameDayYear = new RegExp(`\\b(${MONTH.slice(1, -1)})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi");
	while ((match = monthNameDayYear.exec(scan))) {
		const [, mName, dRaw, yRaw] = match;
		const idx = typeof match.index === "number" ? match.index : 0;
		const mon = MONTH_NAME_MAP[String(mName).toLowerCase()];
		if (!mon) continue;
		pushYMD(Number(yRaw), mon, Number(dRaw), idx + ORDER_INCREMENT * 0.5);
		try {
			tokens.push({ key: formatYMD(Number(yRaw), mon, Number(dRaw)), index: idx, endIndex: idx + String(match[0] ?? "").length });
		} catch {
			// ignore
		}
	}

	const yearFirst = /\b(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?=(?:\b|$|[^\d]|\d{4}[.\-/]))/g;
	while ((match = yearFirst.exec(scan))) {
		const [, y, m, d] = match;
		pushYMD(Number(y), Number(m), Number(d), match.index ?? found.size);
		try {
			const idx = typeof match.index === "number" ? match.index : 0;
			tokens.push({ key: formatYMD(Number(y), Number(m), Number(d)), index: idx, endIndex: idx + String(match[0] ?? "").length });
		} catch {
			// ignore
		}
	}

	const dayFirst = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?=(?:\b|$|[^\d]|\d{1,2}[.\-/]))/g;
	while ((match = dayFirst.exec(scan))) {
		const [, d, m, yRaw] = match;
		const idx = typeof match.index === "number" ? match.index : 0;
		// Avoid parsing a day-first date that is actually the middle of an ISO date+range like:
		// "2026-02-03-2026-02-05" which contains "02-03-2026" (interpretable as 2 Mar 2026).
		// If the match starts immediately after "YYYY-"/"YYYY/"/"YYYY." then skip it.
		if (idx >= 5) {
			const prefix = scan.slice(idx - 5, idx);
			if (/^\d{4}[.\-/]$/.test(prefix)) continue;
		}
		let year = Number(yRaw);
		if (yRaw.length === 2) year += year >= 70 ? 1900 : 2000;
		pushYMD(year, Number(m), Number(d), match.index ?? found.size + ORDER_INCREMENT);
		try {
			tokens.push({ key: formatYMD(year, Number(m), Number(d)), index: idx, endIndex: idx + String(match[0] ?? "").length });
		} catch {
			// ignore
		}
	}

	const parsed = strictChrono.parse(scan);
	for (const res of parsed) {
		// Avoid day-first numeric matches that are embedded inside ISO range strings like
		// "2026-02-03-2026-02-05" (contains "02-03-2026").
		try {
			const idx = typeof (res as any)?.index === "number" ? Number((res as any).index) : 0;
			const t = String((res as any)?.text ?? "");
			if (idx >= 5 && /^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}$/.test(t)) {
				const prefix = scan.slice(idx - 5, idx);
				if (/^\d{4}[.\-/]$/.test(prefix)) continue;
			}
		} catch {
			// ignore
		}
		// Avoid inferring the year for month/day inputs; accept chrono results only when
		// the matched substring contains an explicit 4-digit year.
		const yearInTextMatch = (res.text ?? "").match(/\b(\d{4})\b/);
		if (!yearInTextMatch) continue;
		const explicitYear = Number(yearInTextMatch[1]);
		const index = typeof res.index === "number" ? res.index : found.size + ORDER_INCREMENT;

		const cStart: any = res.start as any;
		const year = typeof cStart?.get === "function" ? Number(cStart.get("year")) : NaN;
		const month = typeof cStart?.get === "function" ? Number(cStart.get("month")) : NaN;
		const day = typeof cStart?.get === "function" ? Number(cStart.get("day")) : NaN;
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
		if (Number.isFinite(explicitYear) && explicitYear !== year) continue;

		const cEnd: any = (res as any).end as any;
		if (cEnd && typeof cEnd?.get === "function") {
			const endYear = Number(cEnd.get("year"));
			const endMonth = Number(cEnd.get("month"));
			const endDay = Number(cEnd.get("day"));
			if (Number.isFinite(endYear) && Number.isFinite(endMonth) && Number.isFinite(endDay)) {
				if (Number.isFinite(explicitYear) && explicitYear !== endYear) continue;
				const startKey = formatYMD(year, month, day);
				const endKey = formatYMD(endYear, endMonth, endDay);
				const expanded = expandInclusiveDateKeyRange(startKey, endKey);
				if (expanded.length > 1) {
					const len = String(res.text ?? "").length;
					const span = Math.max(1, len);
					for (let j = 0; j < expanded.length; j++) {
						const t = expanded.length === 1 ? 0 : j / (expanded.length - 1);
						const order = index + span * t + j * 0.000001;
						const existing = found.get(expanded[j]!);
						if (!existing || order < existing.order) {
							found.set(expanded[j]!, { key: expanded[j]!, order });
						}
					}
					continue;
				}
			}
		}

		pushYMD(year, month, day, index);
		try {
			const idx = typeof res.index === "number" ? res.index : 0;
			const len = String(res.text ?? "").length;
			tokens.push({ key: formatYMD(year, month, day), index: idx, endIndex: idx + Math.max(0, len) });
		} catch {
			// ignore
		}
	}

	const normalizeBetween = (s: string): string => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
	const isRangeConnector = (between: string, beforeA: string): boolean => {
		const bt = normalizeBetween(between);
		if (!bt) return false;
		if (/^(?:to|until|through|till|thru)$/.test(bt)) return true;
		if (/^(?:-|–|—)$/.test(bt)) return true;
		if (/^(?:\.\.|\.\.\.)$/.test(bt)) return true;
		if (bt === "and") {
			const prefix = normalizeBetween(beforeA).replace(/[\s([{,:;[]+$/g, "");
			return /\bbetween$/.test(prefix);
		}
		return false;
	};

	const orderedTokens = tokens
		.filter(t => t && typeof t.key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.key) && Number.isFinite(t.index) && Number.isFinite(t.endIndex))
		.sort((a, b) => a.index - b.index);
	for (let i = 0; i < orderedTokens.length - 1; i++) {
		const a = orderedTokens[i]!;
		const b = orderedTokens[i + 1]!;
		const between = scan.slice(a.endIndex, b.index);
		const beforeA = scan.slice(Math.max(0, a.index - 40), a.index);
		if (!isRangeConnector(between, beforeA)) continue;
		const expanded = expandInclusiveDateKeyRange(a.key, b.key);
		if (expanded.length <= 1) continue;
		const span = Math.max(1, b.index - a.index);
		for (let j = 0; j < expanded.length; j++) {
			const t = expanded.length === 1 ? 0 : j / (expanded.length - 1);
			const order = a.index + span * t + j * 0.000001;
			const existing = found.get(expanded[j]!);
			if (!existing || order < existing.order) {
				found.set(expanded[j]!, { key: expanded[j]!, order });
			}
		}
	}

	const ordered = Array.from(found.values()).sort((a, b) => a.order - b.order);
	return ordered.map(item => item.key);
}

export function parseAnyDate(text: string): string | null {
	const dates = parseAnyDates(text);
	return dates.length > 0 ? dates[0] : null;
}

export function normalizeDateFromTimestamp(ts: number): string {
	return formatDate(new Date(ts));
}

export function computeBlocks(lines: string[]) {
	const blocks = [];
	let start = 0;

	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim() === "") {
			if (i > start) blocks.push({ start, end: i - 1 });
			start = i + 1;
		}
	}

	if (start < lines.length) blocks.push({ start, end: lines.length - 1 });
	return blocks;
}