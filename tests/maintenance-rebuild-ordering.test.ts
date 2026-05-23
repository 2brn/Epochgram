import { describe, expect, it, vi } from "vitest";

import { EPOCH_BUCKETS } from "../src/indexer/types";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string, _timeout?: number) {}
	},
	Platform: { isDesktopApp: true },
}));

import { runRebuild } from "../src/plugin/maintenance";

describe("maintenance rebuild ordering", () => {
	it("allows manual AI summaries rebuild when Auto summarize is off", async () => {
		const ensureIndexLoaded = vi.fn(async () => undefined);
		const generateAiSummariesForAllRecords = vi.fn(async () => undefined);

		const plugin: any = {
			indexer: { index: {} },
			settings: {
				enableAi: true,
				summarizeAI: false,
				generateEpochs: false,
				enableSimilaritySearch: false,
				enableTopics: false,
			},
			hasProAccess: () => true,
			ensureIndexLoaded,
			generateAiSummariesForAllRecords,
		};
		withTrustedPro(plugin);

		await runRebuild(plugin, {
			index: false,
			semantics: false,
			topics: false,
			aiSummaries: true,
			epochs: false,
		});

		await new Promise((r) => setTimeout(r, 0));

		expect(generateAiSummariesForAllRecords).toHaveBeenCalledTimes(1);
		expect(ensureIndexLoaded).toHaveBeenCalled();
	});

	it("schedules epochs after AI idle when both AI summaries and epochs are selected", async () => {
			const ensureIndexLoaded = vi.fn(async () => undefined);
		const generateAiSummariesForAllRecords = vi.fn(async () => undefined);
		const enqueueEpochsForDateKeys = vi.fn(async () => undefined);

		const plugin: any = {
			indexer: {
				index: {
					"2026-01-01": [{ source: "note", file: "note.md", date: "2026-01-01", summary: "x" }]
				}
			},
			settings: {
				enableAi: true,
				summarizeAI: true,
				generateEpochs: true,
				enableSimilaritySearch: false,
				enableTopics: false,
			},
			hasProAccess: () => true,
				ensureIndexLoaded,
			generateAiSummariesForAllRecords,
			enqueueEpochsForDateKeys,
		};
		withTrustedPro(plugin);

		await runRebuild(plugin, {
			index: false,
			semantics: false,
			topics: false,
			aiSummaries: true,
			epochs: true,
		});

		// runRebuild spawns a background async task; give it a tick.
		await new Promise((r) => setTimeout(r, 0));

		expect(generateAiSummariesForAllRecords).toHaveBeenCalledTimes(1);
		expect(enqueueEpochsForDateKeys).toHaveBeenCalledTimes(1);
		expect(enqueueEpochsForDateKeys).toHaveBeenCalledWith(["2026-01-01"], {
			force: true,
			showNotice: true,
			buckets: EPOCH_BUCKETS,
		});

		const aiCallOrder = generateAiSummariesForAllRecords.mock.invocationCallOrder[0];
		const epochsCallOrder = enqueueEpochsForDateKeys.mock.invocationCallOrder[0];
		expect(aiCallOrder).toBeLessThan(epochsCallOrder);

			expect(ensureIndexLoaded).toHaveBeenCalled();
			const ensureCallOrder = ensureIndexLoaded.mock.invocationCallOrder[0];
			expect(ensureCallOrder).toBeLessThan(aiCallOrder);
	});

	it("runs epochs immediately when only epochs is selected", async () => {
			const ensureIndexLoaded = vi.fn(async () => undefined);
		const generateAiSummariesForAllRecords = vi.fn(async () => undefined);
		const enqueueEpochsForDateKeys = vi.fn(async () => undefined);

		const plugin: any = {
			indexer: {
				index: {
					"2026-01-01": [{ source: "note", file: "note.md", date: "2026-01-01", summary: "x" }]
				}
			},
			settings: {
				enableAi: true,
				summarizeAI: true,
				generateEpochs: true,
				enableSimilaritySearch: false,
				enableTopics: false,
			},
			hasProAccess: () => true,
				ensureIndexLoaded,
			generateAiSummariesForAllRecords,
			enqueueEpochsForDateKeys,
		};
		withTrustedPro(plugin);

		await runRebuild(plugin, {
			index: false,
			semantics: false,
			topics: false,
			aiSummaries: false,
			epochs: true,
		});

		await new Promise((r) => setTimeout(r, 0));

		expect(generateAiSummariesForAllRecords).not.toHaveBeenCalled();
		expect(enqueueEpochsForDateKeys).toHaveBeenCalledTimes(1);
	});
});
