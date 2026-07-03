import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

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

const buildJobsForFileMock = vi.fn(async (_plugin: any, _filePath: string, _force: boolean) => ({
	jobs: [
		{
			id: "j1",
			filePath: "note.md",
			kind: "content",
			date: "2026-02-12",
			blockStart: 0,
			blockEnd: 0,
			source: "content",
			input: "hello",
			context: "",
			inputHash: "h",
			createdAt: 1,
			groupType: "content",
			groupDate: "2026-02-12",
		},
	],
}));

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	buildJobsForFile: (...args: any[]) => buildJobsForFileMock(...args),
	sortJobsNewestFirst: (jobs: any[]) => jobs,
}));

const enqueueThrottledJobsMock = vi.fn(async () => undefined);

vi.mock("../src/plugin/ai-summaries/enqueue-throttle", () => ({
	enqueueThrottledJobs: (...args: any[]) => enqueueThrottledJobsMock(...args),
}));

vi.mock("../src/plugin/ai-summaries/epochs", () => ({
	buildEpochJobs: vi.fn(async () => []),
	buildEpochJobsForDateKeys: vi.fn(() => []),
}));

import { enqueueEpochsForDateKeys } from "../src/plugin/ai-summaries/methods-epochs";

describe("enqueueEpochsForDateKeys fast mode force behavior", () => {
	it("does not force internal per-note AI summaries when forcing epochs", async () => {
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
					"2026-02-12": [{ source: "content", file: "note.md", date: "2026-02-12", summary: "x" }],
				},
			},
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				getStatus: () => ({ clientConnected: false, queued: 0, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await enqueueEpochsForDateKeys.call(plugin, ["2026-02-12"], { force: true, showNotice: false, buckets: ["year"] });

		expect(buildJobsForFileMock).toHaveBeenCalledTimes(1);
		const args = buildJobsForFileMock.mock.calls[0] ?? [];
		expect(args[2]).toBe(false);
	});
});
