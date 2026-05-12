import { describe, it, expect, vi } from "vitest";
import { storeEpochSummary } from "../src/plugin/ai-summaries/epochs";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("storeEpochSummary refresh", () => {
	it("requests an Epochgram view refresh after inserting a new epoch entry", async () => {
		vi.useFakeTimers();
		try {
			const refreshEpochViews = vi.fn(() => {});
			const plugin: any = {
				settings: { generateEpochs: true },
				hasProAccess: () => true,
				refreshEpochViews,
				indexer: {
					index: {
						"2026-02-22": [{ file: "a.md", date: "2026-02-22", source: "content", blockStart: 0, blockEnd: 0 }]
					}
				}
			};
			withTrustedPro(plugin);

			const job: any = {
				id: "j1",
				kind: "epoch",
				filePath: "epoch://day/2026-02-22-2026-02-22",
				date: "2026-02-22",
				source: "epoch",
				inputHash: "h1",
				createdAt: Date.now(),
				epochBucket: "day",
				epochStart: "2026-02-22",
				epochEnd: "2026-02-22"
			};

			storeEpochSummary(plugin, job, "Summary text");

			expect(refreshEpochViews).toHaveBeenCalledTimes(0);
			await vi.advanceTimersByTimeAsync(60);
			expect(refreshEpochViews).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not allow an older epoch job to overwrite a newer stored summary", () => {
		const plugin: any = {
			settings: { generateEpochs: true },
			hasProAccess: () => true,
			refreshEpochViews: () => {},
			indexer: {
				index: {
					"2026-02-22": []
				}
			}
		};
		withTrustedPro(plugin);

		const newerJob: any = {
			id: "j-new",
			kind: "epoch",
			filePath: "epoch://day/2026-02-22-2026-02-22",
			date: "2026-02-22",
			source: "epoch",
			inputHash: "h-new",
			createdAt: 200,
			epochBucket: "day",
			epochStart: "2026-02-22",
			epochEnd: "2026-02-22"
		};

		const olderJob: any = {
			...newerJob,
			id: "j-old",
			inputHash: "h-old",
			createdAt: 100
		};

		storeEpochSummary(plugin, newerJob, "New summary");
		storeEpochSummary(plugin, olderJob, "Old summary");

		const list: any[] = plugin.indexer.index["2026-02-22"];
		const epoch = list.find((e) => String(e?.file ?? "") === "epoch://day/2026-02-22-2026-02-22");
		expect(epoch?.summary).toBe("New summary");
		expect(epoch?.aiSummary).toBe("New summary");
		expect(epoch?.aiSummaryInputHash).toBe("h-new");
	});
});
