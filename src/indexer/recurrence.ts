import { RRule, rrulestr } from "rrule";
import { formatDate } from "utils";
import type { RecurrenceIndexData } from "./types";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDateKey(value: string): boolean {
	return DATE_KEY_RE.test(String(value || ""));
}

function parseDateKeyToLocalDate(key: string): Date | null {
	if (!isDateKey(key)) return null;
	const year = Number(key.slice(0, 4));
	const month = Number(key.slice(5, 7));
	const day = Number(key.slice(8, 10));
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
	if (year < 1000 || year > 2100) return null;
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > 31) return null;
	const d = new Date(year, month - 1, day);
	// Use local noon to keep UTC/local day alignment for weekday-based rules.
	// (RRule internally operates in UTC-like terms; midnight can drift across
	// day boundaries in non-UTC timezones and shift BYDAY results.)
	d.setHours(12, 0, 0, 0);
	return Number.isFinite(d.getTime()) ? d : null;
}

function endOfLocalDay(d: Date): Date {
	const x = new Date(d.getTime());
	x.setHours(23, 59, 59, 999);
	return x;
}

function addDaysLocal(key: string, days: number): string {
	const d = parseDateKeyToLocalDate(key);
	if (!d) return key;
	d.setDate(d.getDate() + days);
	d.setHours(0, 0, 0, 0);
	return formatDate(d);
}

function normalizeRruleString(raw: string): string {
	let s = String(raw || "").trim();
	if (!s) return "";
	if (/^RRULE\s*:/i.test(s)) s = s.replace(/^RRULE\s*:/i, "").trim();
	// Strip DTSTART/EXDATE/etc if pasted multi-line; keep only RRULE-ish.
	try {
		// If user pasted an iCalendar block, keep the RRULE line only.
		const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
		const rruleLine = lines.find((l) => /^FREQ=/i.test(l) || /^RRULE:/i.test(l));
		if (rruleLine) {
			s = rruleLine.replace(/^RRULE\s*:/i, "").trim();
		}
	} catch {
		// ignore
	}
	return s;
}

const WEEKDAY_MAP: Record<string, WeekdayCode> = {
    mon: "MO", monday: "MO",
    tue: "TU", tues: "TU", tuesday: "TU",
    wed: "WE", wednesday: "WE",
    thu: "TH", thur: "TH", thurs: "TH", thursday: "TH",
    fri: "FR", friday: "FR",
    sat: "SA", saturday: "SA",
    sun: "SU", sunday: "SU",
    // Additional variations
    mo: "MO", tu: "TU", we: "WE", th: "TH", fr: "FR", sa: "SA", su: "SU"
};

type WeekdayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

function parseWeekdayList(raw: string): WeekdayCode[] {
    const out: WeekdayCode[] = [];
    const seen = new Set<string>();
    for (const seg of String(raw || "").split(/\s*,\s*/g)) {
        const k = String(seg || "").trim().toLowerCase();
        const code = WEEKDAY_MAP[k];
        if (!code) continue;
        if (seen.has(code)) continue;
        seen.add(code);
        out.push(code);
    }
    return out;
}

export { parseWeekdayList };

function extractModifierDate(raw: string, key: "from" | "until"): { value: string | null; stripped: string } {
	const re = key === "from" ? /\bfrom\s+(\d{4}-\d{2}-\d{2})\b/i : /\buntil\s+(\d{4}-\d{2}-\d{2})\b/i;
	const m = String(raw || "").match(re);
	const value = m && isDateKey(m[1] ?? "") ? String(m[1]) : null;
	const stripped = String(raw || "").replace(re, " ");
	return { value, stripped };
}

function extractModifierCount(raw: string): { value: number | null; stripped: string } {
	const re = /\bcount\s+(\d+)\b/i;
	const m = String(raw || "").match(re);
	const nRaw = m ? Number(m[1]) : NaN;
	const value = Number.isFinite(nRaw) && nRaw > 0 ? Math.floor(nRaw) : null;
	const stripped = String(raw || "").replace(re, " ");
	return { value, stripped };
}

export function parseRecurrenceFrontmatter(params: {
	rawValue: unknown;
	line: number;
	fallbackStartDateKey: string | null;
}): RecurrenceIndexData | null {
	const { rawValue, line, fallbackStartDateKey } = params;
	const raw0 = typeof rawValue === "string"
		? rawValue
		: (typeof rawValue === "number" || typeof rawValue === "boolean" || typeof rawValue === "bigint")
			? String(rawValue)
			: "";
	const raw = String(raw0 || "").trim();
	if (!raw) return null;

	let working = raw;
	const fromMod = extractModifierDate(working, "from");
	working = fromMod.stripped;
	const untilMod = extractModifierDate(working, "until");
	working = untilMod.stripped;
	const countMod = extractModifierCount(working);
	working = countMod.stripped;

	const from = fromMod.value || (fallbackStartDateKey && isDateKey(fallbackStartDateKey) ? fallbackStartDateKey : undefined);
	const until = untilMod.value || undefined;
	const count = countMod.value || undefined;

	const core = String(working || "").replace(/\s+/g, " ").trim();
	if (!core) return null;

	// RRULE format
	if (/\bFREQ\s*=\s*/i.test(core) || /^RRULE\s*:/i.test(core)) {
		const rule = normalizeRruleString(core);
		if (!rule) return null;
		return {
			raw,
			line: Math.max(0, Math.floor(Number.isFinite(line) ? line : 0)),
			from,
			until,
			count,
			rrule: rule,
			kind: "rrule"
		};
	}

	// Friendly formats
	const everyDay = core.match(/^every\s+day$/i);
	const everyNDays = core.match(/^every\s+(\d+)\s+days?$/i);
	const everyWeekOn = core.match(/^every\s+week\s+on\s+([a-z]+(?:\s*,\s*[a-z]+)*)$/i);
	const everyNWeeksOn = core.match(/^every\s+(\d+)\s+weeks?\s+on\s+([a-z]+(?:\s*,\s*[a-z]+)*)$/i);
	const everyMonthOn = core.match(/^every\s+month\s+on\s+(-?\d{1,2})$/i);
	const everyYearOn = core.match(/^every\s+year\s+on\s+(\d{2})-(\d{2})$/i);

	let rule: string | null = null;
	if (everyDay) {
		rule = "FREQ=DAILY";
	} else if (everyNDays) {
		const n = Math.max(1, Math.floor(Number(everyNDays[1])));
		rule = `FREQ=DAILY;INTERVAL=${n}`;
	} else if (everyWeekOn) {
		const list = parseWeekdayList(everyWeekOn[1] ?? "");
		if (list.length > 0) {
			rule = `FREQ=WEEKLY;BYDAY=${list.join(",")}`;
		}
	} else if (everyNWeeksOn) {
		const n = Math.max(1, Math.floor(Number(everyNWeeksOn[1])));
		const list = parseWeekdayList(everyNWeeksOn[2] ?? "");
		if (list.length > 0) {
			rule = `FREQ=WEEKLY;INTERVAL=${n};BYDAY=${list.join(",")}`;
		}
	} else if (everyMonthOn) {
		const dayRaw = Math.floor(Number(everyMonthOn[1]));
		const day = Number.isFinite(dayRaw) && ((dayRaw >= 1 && dayRaw <= 31) || (dayRaw <= -1 && dayRaw >= -31)) ? dayRaw : null;
		if (day != null) {
			rule = `FREQ=MONTHLY;BYMONTHDAY=${day}`;
		}
	} else if (everyYearOn) {
		const mmRaw = Math.floor(Number(everyYearOn[1]));
		const ddRaw = Math.floor(Number(everyYearOn[2]));
		const mm = Number.isFinite(mmRaw) && mmRaw >= 1 && mmRaw <= 12 ? mmRaw : null;
		const dd = Number.isFinite(ddRaw) && ddRaw >= 1 && ddRaw <= 31 ? ddRaw : null;
		if (mm != null && dd != null) {
			rule = `FREQ=YEARLY;BYMONTH=${mm};BYMONTHDAY=${dd}`;
		}
	}

	if (!rule) return null;

	return {
		raw,
		line: Math.max(0, Math.floor(Number.isFinite(line) ? line : 0)),
		from,
		until,
		count,
		rrule: rule,
		kind: "friendly"
	};
}

export function expandRecurrenceToDateKeys(params: {
	recur: RecurrenceIndexData;
	fallbackFromKey?: string | null;
	todayKey: string;
}): string[] {
	const { recur, fallbackFromKey, todayKey } = params;
	const fromKey = recur.from && isDateKey(recur.from)
		? recur.from
		: (fallbackFromKey && isDateKey(fallbackFromKey) ? fallbackFromKey : null);
	if (!fromKey) return [];

	const parseParam = (rule: string, name: string): string | null => {
		const m = String(rule || "").match(new RegExp(`(?:^|;)${name}=([^;]+)`, "i"));
		return m ? String(m[1] ?? "").trim() : null;
	};

	const snapWeeklyStartForFriendly = (key: string, rule: string): string => {
		if (recur.kind !== "friendly") return key;
		if (!/\bFREQ=WEEKLY\b/i.test(rule)) return key;
		const byday = parseParam(rule, "BYDAY");
		if (!byday) return key;
		const intervalRaw = Number(parseParam(rule, "INTERVAL") ?? "1");
		const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 1;
		if (interval <= 1) return key;

		const start = parseDateKeyToLocalDate(key);
		if (!start) return key;
		const codes = new Set<WeekdayCode>();
		for (const seg of String(byday || "").split(/\s*,\s*/g)) {
			const s = String(seg || "").trim().toUpperCase();
			if (s === "MO" || s === "TU" || s === "WE" || s === "TH" || s === "FR" || s === "SA" || s === "SU") {
				codes.add(s);
			}
		}
		if (codes.size === 0) return key;
		for (let i = 0; i <= 13; i++) {
			const d = new Date(start.getTime());
			d.setDate(d.getDate() + i);
			const code = (["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d.getDay()] ?? "MO") as WeekdayCode;
			if (!codes.has(code)) continue;
			const snapped = formatDate(d);
			return isDateKey(snapped) ? snapped : key;
		}
		return key;
	};

	const ruleForStart = String(recur.rrule || "").trim();
	const effectiveFromKey = snapWeeklyStartForFriendly(fromKey, ruleForStart);
	const dtstart = parseDateKeyToLocalDate(effectiveFromKey);
	if (!dtstart) return [];

	const intervalHasNoByday = (): boolean => {
		const s = String(recur.rrule || "");
		return /FREQ=WEEKLY/i.test(s) && !/\bBYDAY=/i.test(s);
	};

	// For weekly rules without an explicit BYDAY (e.g. "every 2 weeks"),
	// default to the DTSTART weekday so the schedule is stable.
	const normalizeWeeklyByDayFallback = (rule: string): string => {
		if (!intervalHasNoByday()) return rule;
		const weekday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][dtstart.getDay()] ?? "MO";
		return rule.includes("BYDAY=") ? rule : `${rule};BYDAY=${weekday}`;
	};

	const ruleStr = normalizeWeeklyByDayFallback(String(recur.rrule || "").trim());
	if (!ruleStr) return [];

	let rrule: RRule;
	try {
		// Parse as string but force DTSTART via options so we can keep it date-only.
		rrule = rrulestr(ruleStr, { dtstart }) as unknown as RRule;
	} catch {
		try {
			rrule = RRule.fromString(ruleStr);
			// If fromString succeeded but DTSTART is missing, it will default to now;
			// re-create with dtstart by re-parsing through rrulestr.
			rrule = rrulestr(ruleStr, { dtstart }) as unknown as RRule;
		} catch {
			return [];
		}
	}

	// Apply modifiers.
	const opts: any = (rrule as any)?.options ? { ...(rrule as any).options } : null;
	if (opts) {
		if (Array.isArray(opts.bynmonthday) && opts.bynmonthday.length > 0) {
			const base = Array.isArray(opts.bymonthday) ? opts.bymonthday : [];
			opts.bymonthday = [...base, ...opts.bynmonthday];
			delete opts.bynmonthday;
		}
		if (typeof recur.count === "number" && Number.isFinite(recur.count) && recur.count > 0) {
			opts.count = Math.floor(recur.count);
			delete opts.until;
		} else if (typeof recur.until === "string" && isDateKey(recur.until)) {
			const u = parseDateKeyToLocalDate(recur.until);
			if (u) {
				opts.until = endOfLocalDay(u);
			}
		}
		try {
			rrule = new RRule(opts);
		} catch {
			// ignore; fallback to the parsed rule
		}
	}

	const untilKey = typeof recur.until === "string" && isDateKey(recur.until) ? recur.until : null;

	// Bounded expansion rules:
	// - If UNTIL: expand exactly [from..until]
	// - If COUNT: ask rrule for all occurrences (bounded by count)
	// - Else: expand in a large rolling window around today so the timeline remains scrollable.
	const PAST_DAYS = 365 * 5;
	const FUTURE_DAYS = 365 * 5;

	let rangeStartKey = fromKey;
	let rangeEndKey = untilKey;
	if (!rangeEndKey && !(typeof recur.count === "number" && recur.count > 0)) {
		rangeStartKey = addDaysLocal(todayKey, -PAST_DAYS);
		rangeEndKey = addDaysLocal(todayKey, FUTURE_DAYS);
		if (rangeStartKey < fromKey) rangeStartKey = fromKey;
	}

	const MAX_OCCURRENCES = 50_000;

	try {
		if (typeof recur.count === "number" && Number.isFinite(recur.count) && recur.count > 0) {
			const requested = Math.max(1, Math.floor(recur.count));
			const cap = Math.min(requested, MAX_OCCURRENCES);
			const out: string[] = [];
			const seen = new Set<string>();
			let cursor = new Date(dtstart.getTime() - 1);
			for (let i = 0; i < cap; i++) {
				const next = (rrule as any)?.after?.(cursor, false) as Date | null | undefined;
				if (!(next instanceof Date) || !Number.isFinite(next.getTime())) break;
				const key = formatDate(next);
				if (!isDateKey(key)) {
					cursor = next;
					continue;
				}
				if (key < fromKey) {
					cursor = next;
					continue;
				}
				if (untilKey && key > untilKey) break;
				if (!seen.has(key)) {
					seen.add(key);
					out.push(key);
				}
				cursor = next;
				if (out.length >= cap) break;
			}
			return out;
		}

		if (!rangeEndKey) return [];
		const start = parseDateKeyToLocalDate(rangeStartKey);
		const end = parseDateKeyToLocalDate(rangeEndKey);
		if (!start || !end) return [];
		const dates = rrule.between(start, endOfLocalDay(end), true);
		const out: string[] = [];
		const seen = new Set<string>();
		for (const d of dates) {
			const key = formatDate(d);
			if (!isDateKey(key)) continue;
			if (key < fromKey) continue;
			if (untilKey && key > untilKey) continue;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(key);
			if (out.length >= MAX_OCCURRENCES) break;
		}
		return out;
	} catch {
		return [];
	}
}
