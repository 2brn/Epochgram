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
	buildEpochJobsForDateKeys: vi.fn(async () => [
		{
			id: "e1",
			filePath: "epoch://day/2026-02-12-2026-02-12",
			kind: "epoch",
			date: "2026-02-12",
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			input: "x",
			context: "",
			inputHash: "hh",
			createdAt: 1,
			epochBucket: "day",
			epochStart: "2026-02-12",
			epochEnd: "2026-02-12",
		},
	]),
}));

import { enqueueEpochsForDateKeys } from "../src/plugin/ai-summaries/methods-epochs";

describe("enqueueEpochsForDateKeys fast mode notice", () => {
	it("shows a queued notice when internal per-note summaries are queued", async () => {
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
					"2026-02-12": [{ source: "content", file: "note.md", date: "2026-02-12", summary: "x" }],
				},
			},
			hasProAccess: () => true,
			ensureIndexLoaded: async () => undefined,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				enqueue: vi.fn(),
				getStatus: () => ({ clientConnected: false, queued: 0, inProgress: 0 }),
			},
		};
		withTrustedPro(plugin);

		await enqueueEpochsForDateKeys.call(plugin, ["2026-02-12"], { force: true, showNotice: true, buckets: ["day"] as any });

		expect(noticeCalls.some(m => m.includes("Epochs: queued"))).toBe(true);
	});
});
