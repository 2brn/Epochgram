import type { AiSummaryJob } from "../../ai-bridge";
import { EPOCH_BUCKET_ORDER } from "../shared";

export function sortEpochJobsByHierarchy(jobs: AiSummaryJob[]): AiSummaryJob[] {
	const order = new Map<string, number>(EPOCH_BUCKET_ORDER.map((b, i) => [b, i]));
	return jobs.slice().sort((a, b) => {
		const da = String((a as any).epochStart || a.date || "");
		const db = String((b as any).epochStart || b.date || "");
		if (da !== db) return da < db ? 1 : -1; // newest -> oldest

		const ba = String((a as any).epochBucket || "");
		const bb = String((b as any).epochBucket || "");
		const oa = order.has(ba) ? (order.get(ba) as number) : 999;
		const ob = order.has(bb) ? (order.get(bb) as number) : 999;
		if (oa !== ob) return oa - ob; // day -> ... -> year

		const ga = String((a as any).groupId ?? "");
		const gb = String((b as any).groupId ?? "");
		if (ga !== gb) return ga < gb ? -1 : 1;
		const ia = typeof (a as any).chunkIndex === "number" ? (a as any).chunkIndex : 999999;
		const ib = typeof (b as any).chunkIndex === "number" ? (b as any).chunkIndex : 999999;
		if (ia !== ib) return ia - ib;
		return 0;
	});
}
