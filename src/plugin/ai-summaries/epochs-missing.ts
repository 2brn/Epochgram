import type { EpochPlugin } from "../../main";
import type { DateEntry } from "../../indexer/types";

import { EPOCH_BUCKET_ORDER, isDateKey, parseDateKey, pickEpochPeriod } from "./shared";
import { buildEpochJobs } from "./epochs-build";

export function countMissingEpochsFast(plugin: EpochPlugin): number {
	try {
		const indexerAny: any = plugin.indexer as any;
		const index: Record<string, DateEntry[]> = indexerAny?.index ?? {};
		const dateKeys = Object.keys(index).filter(isDateKey);
		if (dateKeys.length === 0) return 0;

		const requiredPeriods = new Set<string>();
		for (const key of dateKeys) {
			const entries = Array.isArray(index[key]) ? index[key]! : [];
			if (entries.length === 0) continue;
			const hasNonEpoch = entries.some((e) => e && !String((e as any)?.file ?? "").startsWith("epoch://"));
			if (!hasNonEpoch) continue;
			const d = parseDateKey(key);
			if (!d) continue;
			for (const bucket of EPOCH_BUCKET_ORDER) {
				const p = pickEpochPeriod(bucket, d);
				if (!isDateKey(p.start)) continue;
				requiredPeriods.add(`${bucket}|${p.start}`);
			}
		}
		if (requiredPeriods.size === 0) return 0;

		const present = new Set<string>();
		for (const key of dateKeys) {
			const entries = Array.isArray(index[key]) ? index[key]! : [];
			for (const e of entries) {
				if (!e || !String((e as any)?.file ?? "").startsWith("epoch://")) continue;
				const bucket = String((e as any).epochBucket || "");
				const start = String((e as any).epochStart || "");
				if (!bucket || !isDateKey(start)) continue;
				const auto = String((e as any).aiSummary || (e as any).summary || "").trim();
				const s = auto;
				if (!s) continue;
				present.add(`${bucket}|${start}`);
			}
		}

		let missing = 0;
		for (const k of requiredPeriods) {
			if (!present.has(k)) missing++;
		}
		return missing;
	} catch {
		return 0;
	}
}

export async function countMissingEpochs(plugin: EpochPlugin): Promise<number> {
	try {
		const jobs = await buildEpochJobs(plugin, "missing");
		return jobs.length;
	} catch {
		return 0;
	}
}

export function hasMissingEpochsFast(plugin: EpochPlugin): boolean {
	return countMissingEpochsFast(plugin) > 0;
}
