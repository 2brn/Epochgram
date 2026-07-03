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

const scheduleCascade = vi.fn(() => undefined);
const scheduleAfterIdle = vi.fn(() => undefined);

vi.mock("../src/plugin/ai-summaries/epochs-after-ai", () => ({
	scheduleEpochRegenerationAfterAiIdle: vi.fn(() => undefined),
	scheduleEpochRegenerationAfterAiIdleForDateKeys: (...args: any[]) => scheduleAfterIdle(...args),
	scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys: (...args: any[]) => scheduleCascade(...args),
}));

import { EPOCH_BUCKETS } from "../src/indexer/types";
import { enqueueEpochsForDateKeys } from "../src/plugin/ai-summaries/methods-epochs";

describe("enqueueEpochsForDateKeys default cascade", () => {
	it("defaults to cascading day→…→year when buckets are omitted", async () => {
		scheduleCascade.mockClear();
		scheduleAfterIdle.mockClear();

		const enqueue = vi.fn(() => undefined);
		const plugin: any = {
			settings: {
				generateEpochs: true,
				summarizeAI: false,
			},
			indexer: {
				index: {
					"2026-02-12": [{ source: "note", file: "note.md", date: "2026-02-12", summary: "x" }],
				},
			},
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

		await enqueueEpochsForDateKeys.call(plugin, ["2026-02-12"], {});

		expect(scheduleAfterIdle).not.toHaveBeenCalled();
		expect(scheduleCascade).toHaveBeenCalledTimes(1);
		expect(enqueue).toHaveBeenCalledTimes(1);

		const args = scheduleCascade.mock.calls[0] ?? [];
		const queue = args[3] as string[];
		expect(Array.isArray(queue)).toBe(true);
		// Cascade queue should schedule the remaining buckets after the first (day).
		expect(queue).not.toContain("day");
		for (const b of EPOCH_BUCKETS.slice(1)) {
			expect(queue).toContain(b);
		}
		// Sanity: starts at 2days and ends at year.
		expect(queue[0]).toBe("2days");
		expect(queue[queue.length - 1]).toBe("year");

		const firstJobs = enqueue.mock.calls[0]?.[0] as any[];
		expect(Array.isArray(firstJobs)).toBe(true);
		expect(firstJobs.length).toBeGreaterThan(0);
		for (const j of firstJobs) {
			expect(j.epochBucket).toBe("day");
		}
	});
});
