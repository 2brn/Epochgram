import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string, _timeout?: number) {}
	},
	Platform: { isDesktop: true },
}));

vi.mock("../src/plugin/ai-summaries/bridge-server", () => ({
	ensureAiBridgeServerRunning: vi.fn(async () => undefined),
	maybeNudgeBridgeNotReady: vi.fn(() => undefined),
}));

const buildForDateKeys = vi.fn();

vi.mock("../src/plugin/ai-summaries/epochs", () => ({
	buildEpochJobs: vi.fn(async () => []),
	buildEpochJobsForDateKeys: (...args: any[]) => buildForDateKeys(...args),
}));

import { scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys } from "../src/plugin/ai-summaries/epochs-after-ai";

describe("epoch-after-AI cascade", () => {
	it("continues to next bucket when a bucket has zero jobs", async () => {
		vi.useFakeTimers();
		// The production code uses window.setInterval; provide a minimal shim for node tests.
		(globalThis as any).window = globalThis as any;
		buildForDateKeys.mockReset();

		// First bucket (6months) returns 0 jobs; second bucket (year) returns 1 job.
		buildForDateKeys.mockImplementation((_plugin: any, _dateKeys: string[], _mode: string, buckets?: string[]) => {
			const bucket = Array.isArray(buckets) && buckets.length > 0 ? String(buckets[0]) : "";
			if (bucket === "6months") return [];
			if (bucket === "year") return [{ id: "j-year", epochBucket: "year" }];
			return [];
		});

		const enqueue = vi.fn(() => undefined);
		const plugin: any = {
			settings: { generateEpochs: true },
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				enqueue,
				getStatus: () => ({ clientConnected: true, queued: 0, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys(plugin, ["2026-02-12"], "staleOrMissing", ["6months", "year"] as any, false);

		// Tick once: runs 6months (0 jobs) and schedules next bucket.
		await vi.advanceTimersByTimeAsync(1600);
		// Tick again: runs year and enqueues.
		await vi.advanceTimersByTimeAsync(1600);

		expect(buildForDateKeys).toHaveBeenCalled();
		expect(enqueue).toHaveBeenCalledTimes(1);
		const jobs = enqueue.mock.calls[0]?.[0] as any[];
		expect(Array.isArray(jobs)).toBe(true);
		expect(jobs[0]?.epochBucket).toBe("year");

		vi.useRealTimers();
	});
});
