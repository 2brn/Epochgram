import type { DateEntry, FileDateEntry, FileIndexData } from "./types";

export function applyEntryState(
	previous: FileIndexData | undefined,
	next: FileIndexData
): void {
	try {
		const prev = (previous as any)?.recurHiddenDates;
		if (Array.isArray(prev)) {
			(next as any).recurHiddenDates = prev.slice();
		}
	} catch {
		// ignore
	}

	try {
		const prev = (previous as any)?.recurReviewedDates;
		if (Array.isArray(prev)) {
			(next as any).recurReviewedDates = prev.slice();
		}
	} catch {
		// ignore
	}

	const prevEmbeddingTerm = typeof previous?.embeddingTerm === "string" ? String(previous.embeddingTerm).trim() : "";
	if (prevEmbeddingTerm) {
		next.embeddingTerm = prevEmbeddingTerm;
	}
	const prevMark = typeof previous?.markColor === "number" ? previous.markColor : null;
	next.markColor = prevMark != null ? prevMark : undefined;
	next.pinnedFile = previous?.pinnedFile === true;

	if (next.cdate) {
		transferAiSingle(previous?.cdate ?? null, next.cdate);
		transferHiddenSingle(previous?.cdate ?? null, next.cdate);
		transferReviewedSingle(previous?.cdate ?? null, next.cdate, next);
	}
	if (next.namedDate) {
		transferAiSingle(previous?.namedDate ?? null, next.namedDate);
		transferHiddenSingle(previous?.namedDate ?? null, next.namedDate);
		transferReviewedSingle(previous?.namedDate ?? null, next.namedDate, next);
	}
	if (next.dateProp) {
		transferAiSingle(previous?.dateProp ?? null, next.dateProp);
		transferHiddenSingle(previous?.dateProp ?? null, next.dateProp);
		transferReviewedSingle(previous?.dateProp ?? null, next.dateProp, next);
	}
	if (Array.isArray(next.contentDates)) {
		transferAiArray(previous?.contentDates, next.contentDates);
		transferHiddenArray(previous?.contentDates, next.contentDates);
		transferReviewedArray(previous?.contentDates, next.contentDates, next);
	}
	if (next.trackedDates) {
		transferAiTracked(previous?.trackedDates, next.trackedDates);
		transferHiddenTracked(previous?.trackedDates, next.trackedDates);
		transferReviewedTracked(previous?.trackedDates, next.trackedDates, next);
	}

	applyHighlightState(next);
}

function hiddenCarryForwardKey(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	if (entry.source === "tracked") return trackedEntryKey(entry);
	return [
		entry.file ?? "",
		entry.source ?? "",
		entryEffectiveDate(entry)
	].join("|");
}

function transferHiddenSingle(
	previous: FileDateEntry | null | undefined,
	next: FileDateEntry | null
): void {
	if (!next || !previous) return;
	if (hiddenCarryForwardKey(previous) !== hiddenCarryForwardKey(next)) return;
	if (previous.reviewState === "hidden") {
		next.reviewState = "hidden";
	}
}


function trackedReviewClearedDateKeys(nextFileData: FileIndexData): Set<string> {
	try {
		const raw = (nextFileData as any)?.__trackedReviewStateClearedDates;
		if (!Array.isArray(raw)) return new Set<string>();
		return new Set<string>(
			raw
				.map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
				.filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value))
		);
	} catch {
		return new Set<string>();
	}
}

function transferReviewedSingle(
	previous: FileDateEntry | null | undefined,
	next: FileDateEntry | null,
	_nextFileData: FileIndexData
): void {
	if (!next || !previous) return;
	if (reviewedCarryForwardKey(previous) !== reviewedCarryForwardKey(next)) return;
	if (previous.reviewState === "reviewed") {
		next.reviewState = "reviewed";
	}
}

function transferReviewedArray(
	previous: FileDateEntry[] | undefined,
	next: FileDateEntry[],
	_nextFileData: FileIndexData
): void {
	if (!next || next.length === 0) return;
	const reviewed = new Set<string>();
	if (Array.isArray(previous)) {
		for (const entry of previous) {
			if (!entry) continue;
			if (entry.reviewState !== "reviewed") continue;
			reviewed.add(reviewedCarryForwardKey(entry));
		}
	}
	if (reviewed.size === 0) return;
	for (const entry of next) {
		if (reviewed.has(reviewedCarryForwardKey(entry))) {
			entry.reviewState = "reviewed";
		}
	}
}

function transferReviewedTracked(
	previous: Record<string, FileDateEntry[]> | undefined,
	next: Record<string, FileDateEntry[]>,
	nextFileData: FileIndexData
): void {
	const clearedDates = trackedReviewClearedDateKeys(nextFileData);
	const reviewed = new Set<string>();
	if (previous) {
		for (const entries of Object.values(previous)) {
			for (const entry of entries) {
				if (!entry) continue;
				if (clearedDates.has(entryEffectiveDate(entry))) continue;
				if (entry.reviewState !== "reviewed") continue;
				reviewed.add(trackedEntryKey(entry));
			}
		}
	}
	if (reviewed.size === 0) return;
	for (const entries of Object.values(next)) {
		for (const entry of entries) {
			if (reviewed.has(trackedEntryKey(entry))) {
				entry.reviewState = "reviewed";
			}
		}
	}
}

function transferHiddenArray(
	previous: FileDateEntry[] | undefined,
	next: FileDateEntry[]
): void {
	if (!next || next.length === 0) return;
	const hidden = new Set<string>();
	if (Array.isArray(previous)) {
		for (const entry of previous) {
			if (!entry) continue;
			if (entry.reviewState !== "hidden") continue;
			hidden.add(hiddenCarryForwardKey(entry));
		}
	}
	if (hidden.size === 0) return;
	for (const entry of next) {
		if (hidden.has(hiddenCarryForwardKey(entry))) {
			entry.reviewState = "hidden";
		}
	}
}

function hiddenTrackedEntryKey(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	return [
		entry.file ?? "",
		entry.source ?? "",
		entryEffectiveDate(entry),
		Number.isFinite(entry.blockStart) ? String(entry.blockStart) : ""
	].join("|");
}

function transferHiddenTracked(
	previous: Record<string, FileDateEntry[]> | undefined,
	next: Record<string, FileDateEntry[]>
): void {
	const hidden = new Set<string>();
	if (previous) {
		for (const entries of Object.values(previous)) {
			for (const entry of entries) {
				if (!entry) continue;
				if (entry.reviewState !== "hidden") continue;
				hidden.add(hiddenTrackedEntryKey(entry));
			}
		}
	}
	if (hidden.size === 0) return;
	for (const entries of Object.values(next)) {
		for (const entry of entries) {
			if (hidden.has(hiddenTrackedEntryKey(entry))) {
				entry.reviewState = "hidden";
			}
		}
	}
}

export function applyHighlightState(data: FileIndexData): void {
	const rawMark = typeof data.markColor === "number" ? data.markColor : null;
	const effectiveMarkColor =
		rawMark != null && Number.isFinite(rawMark) && Math.floor(rawMark) > 0 ? Math.floor(rawMark) : null;
	data.markColor = effectiveMarkColor != null ? effectiveMarkColor : undefined;
	const apply = (entry: FileDateEntry | null) => {
		if (!entry) return;
		entry.markColor = effectiveMarkColor != null ? effectiveMarkColor : undefined;
	};

	apply(data.cdate);
	apply(data.namedDate);
	apply(data.dateProp);
	for (const entry of data.contentDates) {
		apply(entry);
	}
	for (const entries of Object.values(data.trackedDates)) {
		for (const entry of entries) {
			apply(entry);
		}
	}
}

export function gatherFileEntries(data: FileIndexData | undefined | null): FileDateEntry[] {
	if (!data) return [];
	const entries: FileDateEntry[] = [];
	if (data.cdate) entries.push(data.cdate);
	if (data.namedDate) entries.push(data.namedDate);
	if (data.dateProp) entries.push(data.dateProp);
	if (Array.isArray(data.contentDates)) {
		entries.push(...data.contentDates);
	}
	if (data.trackedDates) {
		for (const value of Object.values(data.trackedDates)) {
			entries.push(...value);
		}
	}
	return entries;
}

export function entryEffectiveDate(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	const date = entry.date ?? "";
	const original = entry.originalDate;
	return typeof original === "string" && original.length > 0 ? original : date;
}

export function entrySignature(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	return [
		entry.file ?? "",
		entry.source ?? "",
		entryEffectiveDate(entry),
		Number.isFinite(entry.blockStart) ? String(entry.blockStart) : "",
		Number.isFinite(entry.blockEnd) ? String(entry.blockEnd) : ""
	].join("|");
}

export function trackedEntryKey(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	if (entry.source !== "tracked") {
		return entrySignature(entry);
	}
	const summary = (entry.summary ?? "").trim();
	return [
		entry.file ?? "",
		entry.source ?? "",
		entry.trackedChange ?? "",
		entryEffectiveDate(entry),
		summary
	].join("|");
}

function reviewedCarryForwardKey(entry: DateEntry | null | undefined): string {
	if (!entry) return "";
	if (entry.source === "tracked") return trackedEntryKey(entry);
	return [
		entry.file ?? "",
		entry.source ?? "",
		entryEffectiveDate(entry)
	].join("|");
}

export function trackedEntriesEquivalent(
	previous: FileDateEntry | null | undefined,
	next: FileDateEntry | null | undefined
): boolean {
	if (!previous || !next) return false;
	const previousHash = previous.trackedHash;
	const nextHash = next.trackedHash;
	if (previousHash && nextHash) {
		return previousHash === nextHash;
	}
	if (!previousHash && !nextHash) {
		return (
			previous.trackedChange === next.trackedChange &&
			entrySignature(previous) === entrySignature(next) &&
			(previous.summary ?? "") === (next.summary ?? "")
		);
	}
	return false;
}

function transferAiSingle(
	previous: FileDateEntry | null | undefined,
	next: FileDateEntry | null
): void {
	if (!next || !previous) return;
	if (!entriesMatch(previous, next)) return;
	const prevAny: any = previous as any;
	const nextAny: any = next as any;
	if (typeof prevAny.aiSummary === "string" && prevAny.aiSummary.trim()) {
		nextAny.aiSummary = prevAny.aiSummary;
	}
	if (typeof prevAny.aiSummaryInputHash === "string" && prevAny.aiSummaryInputHash.trim()) {
		nextAny.aiSummaryInputHash = prevAny.aiSummaryInputHash;
	}
}

function transferAiArray(
	previous: FileDateEntry[] | undefined,
	next: FileDateEntry[]
): void {
	if (!next || next.length === 0) return;
	const map = new Map<string, { s?: string; h?: string }>();
	if (Array.isArray(previous)) {
		for (const entry of previous) {
			if (!entry) continue;
			const anyEntry: any = entry as any;
			const s = typeof anyEntry.aiSummary === "string" ? anyEntry.aiSummary.trim() : "";
			const h = typeof anyEntry.aiSummaryInputHash === "string" ? anyEntry.aiSummaryInputHash.trim() : "";
			if (!s && !h) continue;
			map.set(entrySignature(entry), { s: s || undefined, h: h || undefined });
		}
	}
	for (const entry of next) {
		const saved = map.get(entrySignature(entry));
		if (!saved) continue;
		const anyEntry: any = entry as any;
		if (saved.s) anyEntry.aiSummary = saved.s;
		if (saved.h) anyEntry.aiSummaryInputHash = saved.h;
	}
}

function transferAiTracked(
	previous: Record<string, FileDateEntry[]> | undefined,
	next: Record<string, FileDateEntry[]>
): void {
	const map = new Map<string, { s?: string; h?: string }>();
	if (previous) {
		for (const entries of Object.values(previous)) {
			for (const entry of entries) {
				if (!entry) continue;
				const anyEntry: any = entry as any;
				const s = typeof anyEntry.aiSummary === "string" ? anyEntry.aiSummary.trim() : "";
				const h = typeof anyEntry.aiSummaryInputHash === "string" ? anyEntry.aiSummaryInputHash.trim() : "";
				if (!s && !h) continue;
				map.set(trackedEntryKey(entry), { s: s || undefined, h: h || undefined });
			}
		}
	}
	for (const entries of Object.values(next)) {
		for (const entry of entries) {
			const saved = map.get(trackedEntryKey(entry));
			if (!saved) continue;
			const anyEntry: any = entry as any;
			if (saved.s) anyEntry.aiSummary = saved.s;
			if (saved.h) anyEntry.aiSummaryInputHash = saved.h;
		}
	}
}

function entriesMatch(
	a: DateEntry | null | undefined,
	b: DateEntry | null | undefined
): boolean {
	if (!a || !b) return false;
	return entrySignature(a) === entrySignature(b);
}
