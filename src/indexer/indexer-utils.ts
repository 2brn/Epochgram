import type { EpochIndex, DateEntry } from "./types";

function dateKey(d: string) {
	const [yyyy, mm, dd] = [d.slice(0, 4), d.slice(5, 7), d.slice(8, 10)];
	return Number(`${yyyy}${mm}${dd}`);
}

function trackedTimestamp(entry: DateEntry): number {
	if (!entry || entry.source !== "tracked") return Number.NEGATIVE_INFINITY;
	const raw = entry.trackedTime;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string") {
		const parsed = Date.parse(raw);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Number.NEGATIVE_INFINITY;
}

export function sortIndex(index: EpochIndex): EpochIndex {
	const out: EpochIndex = {};
	const dates = Object.keys(index).sort((a, b) => dateKey(a) - dateKey(b));

	for (const d of dates) {
		const entries = index[d].slice();
		entries.sort((a, b) => {
			const pinnedRank = (entry: DateEntry) => (entry.pinned === true ? 0 : 1);
			const sourceRank = (entry: DateEntry) => {
				switch (entry.source) {
					case "tracked":
						return 0;
					case "content":
						return 1;
					case "namedate":
					case "cdate":
					default:
						return 2;
				}
			};
			const pinA = pinnedRank(a);
			const pinB = pinnedRank(b);
			if (pinA !== pinB) return pinA - pinB;
			const srcA = sourceRank(a);
			const srcB = sourceRank(b);
			if (srcA !== srcB) return srcA - srcB;
			const fileCmp = a.file.localeCompare(b.file);
			if (fileCmp !== 0) return fileCmp;
			if (a.source === "tracked" && b.source === "tracked") {
				const timeA = trackedTimestamp(a);
				const timeB = trackedTimestamp(b);
				if (timeA !== timeB) return timeB - timeA;
			}
			return a.blockStart - b.blockStart;
		});
		out[d] = entries;
	}
	return out;
}

export function removeEntriesForFile(index: EpochIndex, path: string) {
	for (const key of Object.keys(index)) {
		const filtered = index[key].filter(entry => entry.file !== path);
		if (filtered.length) {
			index[key] = filtered;
		} else {
			delete index[key];
		}
	}
}

export function addEntries(index: EpochIndex, entries: DateEntry[]) {
	for (const entry of entries) {
		if (!index[entry.date]) index[entry.date] = [];
		index[entry.date].push(entry);
	}
}
