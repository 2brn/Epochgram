import { TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import type { FileIndexData } from "../../indexer/types";

function dateKey(d: string): number {
	try {
		const s = String(d || "");
		if (s.length < 10) return -1;
		const [yyyy, mm, dd] = [s.slice(0, 4), s.slice(5, 7), s.slice(8, 10)];
		const key = Number(`${yyyy}${mm}${dd}`);
		return Number.isFinite(key) ? key : -1;
	} catch {
		return -1;
	}
}

function newestRecordDateKeyFromIndexData(data: FileIndexData | null | undefined): number {
	let best = -1;
	const consider = (d: unknown) => {
		const k = typeof d === "string" ? dateKey(d) : -1;
		if (k > best) best = k;
	};
	try {
		if (!data) return best;
		consider((data as any)?.cdate?.date);
		consider((data as any)?.namedDate?.date);
		const content = (data as any)?.contentDates;
		if (Array.isArray(content)) {
			for (const e of content) consider((e as any)?.date);
		}
		const tracked = (data as any)?.trackedDates;
		if (tracked && typeof tracked === "object") {
			for (const [d, list] of Object.entries(tracked as Record<string, unknown>)) {
				consider(d);
				if (Array.isArray(list)) {
					for (const e of list as any[]) consider((e as any)?.date);
				}
			}
		}
	} catch {
		// ignore
	}
	return best;
}

function newestRecordDateKey(plugin: EpochPlugin, path: string): number {
	try {
		const idx: any = (plugin as any)?.indexer;
		const fn = idx?.getFileIndexData;
		if (typeof fn !== "function") return -1;
		const data = fn.call(idx, path) as FileIndexData | null;
		return newestRecordDateKeyFromIndexData(data);
	} catch {
		return -1;
	}
}

export function getFileMtime(file: any): number {
	try {
		const m = Number(file?.stat?.mtime ?? 0);
		return Number.isFinite(m) ? m : 0;
	} catch {
		return 0;
	}
}

export function sortFilesNewestRecordFirst<T extends { stat?: { mtime?: number }; path?: string }>(
	plugin: EpochPlugin,
	files: T[]
): T[] {
	return files
		.slice()
		.sort((a, b) => {
			const ap = String((a as any)?.path ?? "");
			const bp = String((b as any)?.path ?? "");
			const ad = ap ? newestRecordDateKey(plugin, ap) : -1;
			const bd = bp ? newestRecordDateKey(plugin, bp) : -1;
			const dd = bd - ad;
			if (dd !== 0) return dd;
			const dm = getFileMtime(b) - getFileMtime(a);
			if (dm !== 0) return dm;
			return ap < bp ? -1 : ap > bp ? 1 : 0;
		});
}

export function pickNewestPendingPath(plugin: EpochPlugin, pending: Set<string>): string | null {
	try {
		let bestPath: string | null = null;
		let bestRecordDate = -1;
		let bestMtime = -1;
		for (const p of pending.values()) {
			if (!p) continue;
			const d = newestRecordDateKey(plugin, p);
			let m = 0;
			try {
				const af = plugin.app.vault.getAbstractFileByPath(p);
				if (af instanceof TFile) m = getFileMtime(af);
			} catch {
				m = 0;
			}
			if (d > bestRecordDate || (d === bestRecordDate && m > bestMtime)) {
				bestRecordDate = d;
				bestMtime = m;
				bestPath = p;
			}
		}
		if (!bestPath) {
			const first = pending.values().next().value as string;
			return first || null;
		}
		return bestPath;
	} catch {
		const first = pending.values().next().value as string;
		return first || null;
	}
}
