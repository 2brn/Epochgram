import type { AiSummaryJob } from "../../ai-bridge";
import { EPOCH_BUCKET_ORDER } from "../shared";

export function sortEpochJobsByHierarchy(jobs: AiSummaryJob[]): AiSummaryJob[] {
	const order = new Map<string, number>(EPOCH_BUCKET_ORDER.map((b, i) => [b, i]));
	return jobs.slice().sort((a, b) => {
		const da = String(a.epochStart || a.date || "");
		const db = String(b.epochStart || b.date || "");
		if (da !== db) return da < db ? 1 : -1; // newest -> oldest

		const ba = String(a.epochBucket || "");
		const bb = String(b.epochBucket || "");
		const oa = order.get(ba) ?? 999;
		const ob = order.get(bb) ?? 999;
		if (oa !== ob) return oa - ob; // day -> ... -> year

		const ga = String(a.groupId ?? "");
		const gb = String(b.groupId ?? "");
		if (ga !== gb) return ga < gb ? -1 : 1;
		const ia = typeof a.chunkIndex === "number" ? a.chunkIndex : 999999;
		const ib = typeof b.chunkIndex === "number" ? b.chunkIndex : 999999;
		if (ia !== ib) return ia - ib;
		return 0;
	});
}
