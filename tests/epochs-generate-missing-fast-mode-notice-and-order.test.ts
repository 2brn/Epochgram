import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

const noticeCalls: string[] = [];

vi.mock("obsidian", () => ({
	Notice: vi.fn(function (message: string) {
		noticeCalls.push(String(message ?? ""));
		return {} as any;
	}),
	Platform: { isDesktopApp: true },
}));

vi.mock("../src/plugin/ai-summaries/bridge-server", () => ({
	ensureAiBridgeServerRunning: vi.fn(async () => undefined),
	maybeNudgeBridgeNotReady: vi.fn(() => undefined),
}));

vi.mock("../src/plugin/notice-utils", () => ({
	isUserEditingMarkdown: vi.fn(() => true),
}));

const scheduleCascade = vi.fn(() => undefined);

vi.mock("../src/plugin/ai-summaries/epochs-after-ai", () => ({
	scheduleEpochRegenerationAfterAiIdle: vi.fn(() => undefined),
	scheduleEpochRegenerationAfterAiIdleForDateKeys: vi.fn(() => undefined),
	scheduleEpochRegenerationCascadeAfterAiIdleForDateKeys: (...args: any[]) => scheduleCascade(...args),
}));

const buildJobsForFileMock = vi.fn(async (_plugin: any, filePath: string, _force: boolean) => {
	const groupDate = String(filePath).includes("new") ? "2026-02-12" : "2026-02-10";
	return {
		jobs: [
			{
				id: `j-${filePath}`,
				filePath,
				kind: "content",
				date: groupDate,
				blockStart: 0,
				blockEnd: 0,
				source: "content",
				input: "hello",
				context: "",
				inputHash: "h",
				createdAt: 1,
				groupType: "content",
				groupDate,
			},
		],
	};
});

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	buildJobsForFile: (...args: any[]) => buildJobsForFileMock(...args),
	sortJobsNewestFirst: (jobs: any[]) => jobs,
}));

const enqueueThrottledJobsMock = vi.fn(async () => undefined);

vi.mock("../src/plugin/ai-summaries/enqueue-throttle", () => ({
	enqueueThrottledJobs: (...args: any[]) => enqueueThrottledJobsMock(...args),
}));

import { regenerateMissingEpochsForAllRecords } from "../src/plugin/ai-summaries/methods-epochs";

describe("regenerateMissingEpochsForAllRecords fast mode", () => {
	it("shows a notice and queues newest-to-oldest", async () => {
		noticeCalls.length = 0;
		scheduleCascade.mockClear();
		buildJobsForFileMock.mockClear();
		enqueueThrottledJobsMock.mockClear();

		const plugin: any = {
			settings: {
					generateEpochs: true,
				summarizeAI: false,
			},
			indexer: {
				index: {
					"2026-02-10": [{ source: "content", file: "old.md", date: "2026-02-10", summary: "x" }],
					"2026-02-12": [{ source: "content", file: "new.md", date: "2026-02-12", summary: "x" }],
				},
			},
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				enqueue: vi.fn(),
				getStatus: () => ({ clientConnected: true, queued: 0, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await regenerateMissingEpochsForAllRecords.call(plugin);

		expect(noticeCalls.some((m) => m.toLowerCase().includes("epochs:") && /\d+/.test(m))).toBe(true);
		expect(noticeCalls.some((m) => m.toLowerCase().includes("queued") && /\d+/.test(m))).toBe(true);

		expect(buildJobsForFileMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(buildJobsForFileMock.mock.calls[0]?.[1]).toBe("new.md");
	});
});
