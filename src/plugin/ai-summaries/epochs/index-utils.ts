import type { EpochPlugin } from "../../../main";
import type { DateEntry, EpochBucket } from "../../../indexer/types";
import {
	EPOCH_BUCKET_ORDER,
	isDateKey,
	parseDateKey
} from "../shared";
import { schedulePersist } from "../persistence";

function prevDateKey(dateKey: string): string {
	const d = parseDateKey(dateKey);
	if (!d) return dateKey;
	d.setUTCDate(d.getUTCDate() - 1);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function removeEpochEntriesFromIndexByStart(index: Record<string, DateEntry[]>, bucket: EpochBucket, start: string): boolean {
	const list = Array.isArray(index[start]) ? index[start] : [];
	if (list.length === 0) return false;
	const next = list.filter(e => {
		if (!e || !String(e.file ?? "").startsWith("epoch://")) return true;
		return !(e.epochBucket === bucket && e.epochStart === start);
	});
	if (next.length === list.length) return false;
	if (next.length > 0) index[start] = next;
	else delete index[start];
	return true;
}

export function normalizeEpochEntriesInIndex(plugin: EpochPlugin, index: Record<string, DateEntry[]>): boolean {
	let changed = false;
	const isEpochFile = (e: DateEntry | null | undefined): boolean => String(e?.file ?? "").startsWith("epoch://");

	const buckets: ReadonlyArray<EpochBucket> = EPOCH_BUCKET_ORDER;
	const bucketSet = new Set<string>(buckets);
	for (const start of Object.keys(index)) {
		if (!isDateKey(start)) continue;
		const list = Array.isArray(index[start]) ? index[start] : [];
		const epochEntries = list.filter(e => e && isEpochFile(e));
		if (epochEntries.length === 0) continue;
		const keepByBucket = new Map<EpochBucket, DateEntry>();
		for (const e of epochEntries) {
			const bRaw = String(e.epochBucket || "");
			const b = bucketSet.has(bRaw) ? (bRaw as EpochBucket) : undefined;
			const s = String(e.epochStart || "");
			if (!b || s !== start) {
				changed = true;
				continue;
			}
			const prev = keepByBucket.get(b);
			if (!prev) {
				keepByBucket.set(b, e);
				continue;
			}
			const prevEnd = String(prev.epochEnd || "");
			const end = String(e.epochEnd || "");
			const prevSummaryLen = String(prev.aiSummary || prev.summary || "").trim().length;
			const summaryLen = String(e.aiSummary || e.summary || "").trim().length;
			if (end > prevEnd || (end === prevEnd && summaryLen > prevSummaryLen)) {
				keepByBucket.set(b, e);
			}
		}

		let nextList = list.filter(e => !e || !isEpochFile(e));
		for (const b of buckets) {
			const kept = keepByBucket.get(b);
			if (kept) nextList.push(kept);
		}
		if (nextList.length !== list.length) {
			if (nextList.length > 0) index[start] = nextList;
			else delete index[start];
			changed = true;
		}
	}

	for (const bucket of buckets) {
		const entries: Array<{ start: string; entry: DateEntry }> = [];
		for (const start of Object.keys(index)) {
			if (!isDateKey(start)) continue;
			const list = Array.isArray(index[start]) ? index[start] : [];
			const epoch = list.find(e => e && isEpochFile(e) && e.epochBucket === bucket && String(e.epochStart || "") === start);
			if (!epoch) continue;
			entries.push({ start, entry: epoch });
		}
		entries.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
		for (let i = 0; i < entries.length - 1; i++) {
			const cur = entries[i].entry;
			const nextStart = entries[i + 1].start;
			const curStart = String(cur.epochStart || "");
			let curEnd = String(cur.epochEnd || curStart);
			if (!isDateKey(curStart) || !isDateKey(curEnd) || !isDateKey(nextStart)) continue;
			if (curEnd < nextStart) continue;
			let truncated = prevDateKey(nextStart);
			if (truncated < curStart) truncated = curStart;
			if (truncated !== curEnd) {
				cur.epochEnd = truncated;
				cur.file = `epoch://${bucket}/${curStart}-${truncated}`;
				cur.aiSummaryInputHash = "";
				changed = true;
			}
		}
	}

	if (changed) {
		schedulePersist(plugin);
	}
	return changed;
}

export function truncateOverlappingEpochPeriods<T extends { bucket: EpochBucket; start: string; end: string }>(
	periods: T[]
): T[] {
	const byBucket = new Map<EpochBucket, T[]>();
	for (const p of periods) {
		const list = byBucket.get(p.bucket) ?? [];
		list.push(p);
		byBucket.set(p.bucket, list);
	}
	for (const list of byBucket.values()) {
		list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
		for (let i = 0; i < list.length - 1; i++) {
			const cur = list[i];
			const next = list[i + 1];
			if (!isDateKey(cur.end) || !isDateKey(next.start)) continue;
			if (cur.end < next.start) continue;
			let truncated = prevDateKey(next.start);
			if (truncated < cur.start) truncated = cur.start;
			cur.end = truncated;
		}
	}
	return periods;
}
