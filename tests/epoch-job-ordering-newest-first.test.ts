import { describe, expect, it } from "vitest";

import { sortEpochJobsByHierarchy } from "../src/plugin/ai-summaries/epochs/job-sort";

// Newest-first overall, bucket hierarchy within the same date.
describe("epoch job ordering", () => {
	it("sorts jobs newest→oldest by epochStart, then day→year within a date", () => {
		const jobs: any[] = [
			{ id: "1", epochBucket: "week", epochStart: "2026-01-01", date: "2026-01-01" },
			{ id: "2", epochBucket: "day", epochStart: "2026-02-10", date: "2026-02-10" },
			{ id: "3", epochBucket: "year", epochStart: "2026-02-10", date: "2026-02-10" },
			{ id: "4", epochBucket: "day", epochStart: "2026-01-01", date: "2026-01-01" },
			{ id: "5", epochBucket: "week", epochStart: "2026-02-10", date: "2026-02-10" },
		];

		const sorted = sortEpochJobsByHierarchy(jobs).map(j => j.id);
		// 2026-02-10 first (day, then week, then year), then 2026-01-01 (day, then week)
		expect(sorted).toEqual(["2", "5", "3", "4", "1"]);
	});
});
