import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

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

const scheduleCascade = vi.fn(() => undefined);

vi.mock("../src/plugin/ai-summaries/epochs-after-ai", () => ({
	scheduleEpochRegenerationAfterAiIdle: vi.fn(() => undefined),
	scheduleEpochRegenerationAfterAiIdleForDateKeys: vi.fn(() => undefined),
	scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys: (...args: any[]) => scheduleCascade(...args),
}));

vi.mock("../src/plugin/ai-summaries/epochs", () => ({
	buildEpochJobs: vi.fn(async () => []),
	buildEpochJobsForDateKeys: vi.fn(() => []),
}));

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	buildJobsForFile: vi.fn(async () => ({
		jobs: [
			{
				id: "j1",
				filePath: "a.md",
				kind: "summary",
				groupDate: "2026-02-12",
				date: "2026-02-12",
				input: "x"
			}
		]
	})),
	sortJobsNewestFirst: vi.fn((jobs: any[]) => jobs),
}));

const enqueueThrottledJobsMock = vi.fn(async (_plugin: any) => {
	// Simulate user canceling while internal summary enqueue loop is running.
	if (_plugin) _plugin.__epochAiEnqueueCancelKey = 1;
});

vi.mock("../src/plugin/ai-summaries/enqueue-throttle", () => ({
	enqueueThrottledJobs: (...args: any[]) => enqueueThrottledJobsMock(...args),
}));

import { enqueueEpochsForDateKeys } from "../src/plugin/ai-summaries/methods-epochs";

import { buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";

describe("enqueueEpochsForDateKeys defer behavior", () => {
	it("schedules cascade-after-idle even when notice job count is zero", async () => {
		scheduleCascade.mockClear();

		const plugin: any = {
			settings: {
				generateEpochs: true,
				summarizeAI: true,
			},
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				getStatus: () => ({ clientConnected: false, queued: 1, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await enqueueEpochsForDateKeys.call(plugin, ["2026-02-12"], { force: true, showNotice: true });

		expect(scheduleCascade).toHaveBeenCalledTimes(1);
		// showNotice should NOT propagate, otherwise the after-idle run shows a second Notice.
		expect(scheduleCascade.mock.calls[0]?.[4]).toBe(false);
	});

	it("computes planned hierarchy totals per-bucket", async () => {
		scheduleCascade.mockClear();
		const buildMock: any = buildEpochJobsForDateKeys as any;
		buildMock.mockReset();
		buildMock.mockImplementation((_plugin: any, _keys: any[], _mode: any, bucketsOverride: any[]) => {
			if (!Array.isArray(bucketsOverride) || bucketsOverride.length !== 1) throw new Error("expected single bucket");
			const b = String(bucketsOverride[0] ?? "");
			if (b === "day") return [{ kind: "epoch", input: "aaaa" }, { kind: "epoch", input: "bbbb" }];
			if (b === "2days") return [{ kind: "epoch", input: "cccc" }];
			return [];
		});

		const plugin: any = {
			settings: {
				generateEpochs: true,
				summarizeAI: true,
			},
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				getStatus: () => ({ clientConnected: false, queued: 1, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await enqueueEpochsForDateKeys.call(plugin, ["2026-02-12"], {
			force: true,
			showNotice: false,
			buckets: ["day", "2days"],
		});

		expect(plugin.__epochEpochHierarchyTotalJobs).toBe(3);
	});

	it("does not schedule cascade when canceled during internal summary enqueue", async () => {
		scheduleCascade.mockClear();
		enqueueThrottledJobsMock.mockClear();

		const plugin: any = {
			settings: {
				generateEpochs: true,
				summarizeAI: true,
			},
			hasProAccess: () => true,
			__epochAiEnqueueCancelKey: 0,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			indexer: {
				index: {
					"2026-02-12": [{ file: "a.md" }]
				}
			},
			aiBridge: {
				getStatus: () => ({ clientConnected: false, queued: 1, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await enqueueEpochsForDateKeys.call(plugin, ["2026-02-12"], { force: true, showNotice: true });

		expect(enqueueThrottledJobsMock).toHaveBeenCalledTimes(1);
		expect(scheduleCascade).not.toHaveBeenCalled();
	});
});
