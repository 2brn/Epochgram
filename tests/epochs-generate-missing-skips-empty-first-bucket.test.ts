import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";
import { EPOCH_BUCKETS } from "../src/indexer/types";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string, _timeout?: number) {}
	},
	Platform: { isDesktop: true },
}));

vi.mock("../src/plugin/notice-utils", () => ({
	isUserEditingMarkdown: vi.fn(() => false),
}));

vi.mock("../src/plugin/ai-summaries/bridge-server", () => ({
	ensureAiBridgeServerRunning: vi.fn(async () => undefined),
	maybeNudgeBridgeNotReady: vi.fn(() => undefined),
}));

const scheduleCascade = vi.fn(() => undefined);

vi.mock("../src/plugin/ai-summaries/epochs-after-ai", () => ({
	scheduleEpochRegenerationAfterAiIdle: vi.fn(() => undefined),
	scheduleEpochRegenerationAfterAiIdleForDateKeys: vi.fn(() => undefined),
	scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys: (...args: any[]) => scheduleCascade(...args),
}));

vi.mock("../src/plugin/ai-summaries/epochs", () => ({
	buildEpochJobs: vi.fn(async () => []),
	buildEpochJobsForDateKeys: vi.fn(async (_plugin: any, _keys: string[], _mode: string, bucketsOverride: string[]) => {
		const bucket = String(Array.isArray(bucketsOverride) ? bucketsOverride[0] : "");
		if (bucket === "day") return [];
		if (bucket === "2days") {
			return [{ kind: "epoch", epochBucket: "2days", input: "x" }];
		}
		return [];
	}),
}));

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	buildJobsForFile: vi.fn(async () => ({ jobs: [] })),
	sortJobsNewestFirst: vi.fn((jobs: any[]) => jobs),
}));

vi.mock("../src/plugin/ai-summaries/enqueue-throttle", () => ({
	enqueueThrottledJobs: vi.fn(async () => undefined),
}));

import { regenerateMissingEpochsForAllRecords } from "../src/plugin/ai-summaries/methods-epochs";

describe("regenerateMissingEpochsForAllRecords bucket fallback", () => {
	it("enqueues first non-empty bucket when day bucket has no jobs", async () => {
		scheduleCascade.mockClear();

		const enqueue = vi.fn(() => undefined);
		const plugin: any = {
			settings: {
				generateEpochs: true,
				summarizeAI: false,
			},
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			indexer: {
				index: {},
				files: {
					"note.md": {
						cdate: { date: "2026-02-12", file: "note.md" },
					},
				},
			},
			aiBridge: {
				enqueue,
				getStatus: () => ({ clientConnected: true, queued: 0, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await regenerateMissingEpochsForAllRecords.call(plugin);

		expect(enqueue).toHaveBeenCalledTimes(1);
		const firstBatch = enqueue.mock.calls[0]?.[0] as any[];
		expect(Array.isArray(firstBatch)).toBe(true);
		expect(firstBatch.length).toBe(1);
		expect(firstBatch[0]?.epochBucket).toBe("2days");

		expect(scheduleCascade).toHaveBeenCalledTimes(1);
		const queue = scheduleCascade.mock.calls[0]?.[3] as string[];
		expect(Array.isArray(queue)).toBe(true);
		expect(queue).not.toContain("day");
		expect(queue).not.toContain("2days");
		for (const b of EPOCH_BUCKETS.slice(2)) {
			expect(queue).toContain(b);
		}
	});
});
