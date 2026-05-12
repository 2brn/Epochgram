import { EPOCH_BUCKETS, epochBucketRoughDays, isEpochBucket, type EpochBucket } from "../../indexer/types";

export const AI_CHUNK_MAX_CHARS = 2500;
export const AI_REDUCE_MAX_DEPTH = 4;

export function shouldIncludeRelatedContext(inputText: string): boolean {
	const raw = String(inputText ?? "").trim();
	if (!raw) return false;

	const stripFrontmatter = (s: string): string => {
		const text = String(s ?? "");
		if (!text.startsWith("---")) return text;
		const end = text.indexOf("\n---", 3);
		if (end < 0) return text;
		const after = text.slice(end + "\n---".length);
		return after.replace(/^\r?\n/, "");
	};

	// Remove YAML frontmatter + URLs so metadata doesn't trick the heuristic.
	const noFrontmatter = stripFrontmatter(raw);
	const urlRegex = /https?:\/\/\S+/gi;
	const urlMatches = noFrontmatter.match(urlRegex) ?? [];
	const urlCount = urlMatches.length;

	// Keep markdown link text but drop link targets.
	const noMdLinkTargets = noFrontmatter.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	const signalText = noMdLinkTargets.replace(urlRegex, " ").trim();

	const wordMatches = signalText.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?/gu) ?? [];
	const wordCount = wordMatches.length;

	const nonEmptyLines = signalText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
	const singleLine = nonEmptyLines.length === 1;
	const singleLineUrlOnly = singleLine && /^https?:\/\/\S+$/i.test((nonEmptyLines[0] ?? "").trim());
	if (singleLineUrlOnly) return false;
	if (!signalText) return false;

	// Heuristic: if the input is extremely short (or mostly a URL), attaching rich related
	// context tends to dominate the model output.
	if (wordCount < 10 && signalText.length < 120) return false;
	if (urlCount >= 1 && wordCount <= 3) return false;
	if (urlCount >= 1 && wordCount < 20 && signalText.length < 200) return false;
	if (wordCount < 20 && signalText.length < 80) return false;

	return true;
}

export function clipChunk(raw: string): string {
	if (!raw) return "";
	return raw.length > AI_CHUNK_MAX_CHARS ? raw.slice(0, AI_CHUNK_MAX_CHARS) : raw;
}

export function splitIntoAiChunks(raw: string): string[] {
	const text = raw ?? "";
	if (!text) return [""];
	if (text.length <= AI_CHUNK_MAX_CHARS) return [text];

	const chunks: string[] = [];
	let cursor = 0;
	const softSearch = 800;
	while (cursor < text.length) {
		let end = Math.min(text.length, cursor + AI_CHUNK_MAX_CHARS);
		if (end < text.length) {
			const lookStart = Math.max(cursor, end - softSearch);
			const window = text.slice(lookStart, end);
			let cut = window.lastIndexOf("\n\n");
			if (cut < 0) cut = window.lastIndexOf("\n");
			if (cut >= 0) {
				end = lookStart + cut;
				if (end <= cursor) {
					end = Math.min(text.length, cursor + AI_CHUNK_MAX_CHARS);
				}
			}
		}
		chunks.push(text.slice(cursor, end));
		cursor = end;
		while (cursor < text.length && text[cursor] === "\n") cursor++;
	}
	return chunks;
}

export function splitIntoAiChunksByLines(raw: string, maxChars: number = AI_CHUNK_MAX_CHARS): string[] {
	const text = raw ?? "";
	if (!text) return [""];
	const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.max(1, Math.floor(maxChars)) : AI_CHUNK_MAX_CHARS;
	if (text.length <= limit) return [text];

	const parts = text.split(/(\r\n|\n|\r|\u2028|\u2029)/);
	const lines: string[] = [];
	for (let i = 0; i < parts.length; i += 2) {
		const line = parts[i] ?? "";
		const eol = parts[i + 1] ?? "";
		lines.push(line + eol);
	}

	const chunks: string[] = [];
	let current = "";
	for (const line of lines) {
		if (!line) continue;
		if (!current) {
			current = line;
			continue;
		}
		if ((current.length + line.length) <= limit) {
			current += line;
			continue;
		}
		chunks.push(current);
		current = line;
	}
	if (current) chunks.push(current);

	return chunks.length > 0 ? chunks : [text];
}

export function isDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function parseDateKey(dateKey: string): Date | null {
	if (!isDateKey(dateKey)) return null;
	// Treat date keys as a date-only UTC value for deterministic bucketing.
	// This avoids timezone-dependent shifts near year boundaries.
	const d = new Date(dateKey + "T00:00:00Z");
	return Number.isFinite(d.getTime()) ? d : null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const EPOCH_BUCKET_ORDER: ReadonlyArray<EpochBucket> = EPOCH_BUCKETS;

export { isEpochBucket };

export function ordinalFromLocalDate(d: Date): number {
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	const day = d.getUTCDate();
	return Math.floor(Date.UTC(y, m, day) / MS_PER_DAY);
}

export function dateKeyFromOrdinal(ord: number): string {
	const ms = ord * MS_PER_DAY;
	const dt = new Date(ms);
	const yyyy = dt.getUTCFullYear().toString();
	const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(dt.getUTCDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function pickEpochPeriod(bucket: EpochBucket, d: Date): { start: string; end: string } {
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	const day = d.getUTCDate();

	const ord = ordinalFromLocalDate(d);

	const startOfMonthOrd = (year: number, monthIndex0: number): number =>
		Math.floor(Date.UTC(year, monthIndex0, 1) / MS_PER_DAY);
	const endOfMonthOrd = (year: number, monthIndex0: number): number =>
		Math.floor(Date.UTC(year, monthIndex0 + 1, 0) / MS_PER_DAY);

	if (bucket === "day") {
		return { start: dateKeyFromOrdinal(ord), end: dateKeyFromOrdinal(ord) };
	}
	if (bucket === "2days" || bucket === "4days") {
		const days = epochBucketRoughDays(bucket);
		const startOrd = Math.floor(ord / days) * days;
		const endOrd = startOrd + days - 1;
		return { start: dateKeyFromOrdinal(startOrd), end: dateKeyFromOrdinal(endOrd) };
	}
	if (bucket === "week") {
		const dt = new Date(Date.UTC(y, m, day));
		const dow = dt.getUTCDay();
		const mondayOffset = (dow + 6) % 7;
		const startOrd = ord - mondayOffset;
		const endOrd = startOrd + 6;
		return { start: dateKeyFromOrdinal(startOrd), end: dateKeyFromOrdinal(endOrd) };
	}
	if (bucket === "2weeks") {
		const dt = new Date(Date.UTC(y, m, day));
		const dow = dt.getUTCDay();
		const mondayOffset = (dow + 6) % 7;
		const weekStartOrd = ord - mondayOffset;
		const startOrd = Math.floor(weekStartOrd / 14) * 14;
		const endOrd = startOrd + 13;
		return { start: dateKeyFromOrdinal(startOrd), end: dateKeyFromOrdinal(endOrd) };
	}
	if (bucket === "month") {
		const startOrd = startOfMonthOrd(y, m);
		const endOrd = endOfMonthOrd(y, m);
		return { start: dateKeyFromOrdinal(startOrd), end: dateKeyFromOrdinal(endOrd) };
	}
	if (bucket === "year") {
		const startOrd = startOfMonthOrd(y, 0);
		const endOrd = endOfMonthOrd(y, 11);
		return { start: dateKeyFromOrdinal(startOrd), end: dateKeyFromOrdinal(endOrd) };
	}

	const monthsPerBucket =
		bucket === "3months" ? 3 :
		bucket === "6months" ? 6 :
		1;
	const startMonth0 = Math.floor(m / monthsPerBucket) * monthsPerBucket;
	const startOrd = startOfMonthOrd(y, startMonth0);
	const endMonth0 = startMonth0 + monthsPerBucket - 1;
	const endOrd = endOfMonthOrd(y, endMonth0);
	return { start: dateKeyFromOrdinal(startOrd), end: dateKeyFromOrdinal(endOrd) };
}
