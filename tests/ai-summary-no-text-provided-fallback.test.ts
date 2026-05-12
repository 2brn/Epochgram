import { describe, it, expect, vi } from "vitest";
import { handleBridgeResult } from "../src/plugin/ai-summaries/result-handler";

describe("AI summary rejection", () => {
	it("does not accept 'No text provided' and leaves existing summary/aiSummary intact", () => {
		const entry: any = {
			date: "2026-02-13",
			file: "Note.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "NORMAL",
			aiSummary: "OLD",
			source: "content"
		};

		const plugin: any = {
			indexer: {
				files: {
					"Note.md": {
						cdate: null,
						namedDate: null,
						contentDates: [entry],
						trackedDates: {},
						trackedSnapshot: null,
						trackedSnapshotDate: null,
						trackedBaselineSnapshot: null,
						trackedBaselineDate: null
					}
				},
				latestLines: {},
				updateAggregatedEntries: vi.fn()
			},
			persistIndex: vi.fn().mockResolvedValue(undefined),
			refreshEpochViews: vi.fn(),
			hasProAccess: () => true,
			settings: { generateEpochs: true }
		};

		const job: any = {
			id: "j1",
			filePath: "Note.md",
			kind: "content",
			date: "2026-02-13",
			blockStart: 0,
			blockEnd: 0,
			source: "content",
			inputHash: "h1"
		};

		handleBridgeResult(plugin, job, { summary: "No text provided" });

		expect(entry.aiSummary).toBe("OLD");
		expect(entry.summary).toBe("NORMAL");
	});
});
