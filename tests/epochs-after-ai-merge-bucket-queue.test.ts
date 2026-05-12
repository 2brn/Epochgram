import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string, _timeout?: number) {}
	},
	Platform: { isDesktopApp: true },
}));

vi.mock("../src/plugin/notice-utils", () => ({
	isUserEditingMarkdown: vi.fn(() => false),
}));

vi.mock("../src/plugin/ai-summaries/bridge-server", () => ({
	ensureAiBridgeServerRunning: vi.fn(async () => undefined),
	maybeNudgeBridgeNotReady: vi.fn(() => undefined),
}));

vi.mock("../src/plugin/ai-summaries/epochs", () => ({
	buildEpochJobs: vi.fn(async () => []),
	buildEpochJobsForDateKeys: vi.fn(() => []),
}));

import { EPOCH_BUCKETS } from "../src/indexer/types";
import { scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys } from "../src/plugin/ai-summaries/epochs-after-ai";

describe("epochs-after-ai bucket queue merge", () => {
	it("merges bucket queues so later schedules cannot drop 'day'", () => {
		const plugin: any = {
			settings: { generateEpochs: true },
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
		};

		// Simulate an already-running timer (so scheduleEpochRegenerationAfterAiIdleForDateKeys returns early).
		plugin.epochRegenAfterAiTimer = 123;

		// Existing full cascade.
		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(plugin, ["2026-02-10"], "force", EPOCH_BUCKETS.slice() as any, false);
		const first = plugin.epochRegenAfterAiBucketsQueue as string[];
		expect(first[0]).toBe("day");

		// Later schedule tries to set only the remaining buckets (2days..year).
		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(plugin, ["2026-02-10"], "force", EPOCH_BUCKETS.slice(1) as any, false);
		const merged = plugin.epochRegenAfterAiBucketsQueue as string[];

		expect(merged[0]).toBe("day");
		for (const b of EPOCH_BUCKETS) {
			expect(merged).toContain(b);
		}
	});
});
