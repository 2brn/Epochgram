import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

const noticeCalls: string[] = [];

vi.mock("obsidian", () => ({
	Notice: vi.fn().mockImplementation((message: string) => {
		noticeCalls.push(String(message ?? ""));
	}),
	Platform: { isDesktopApp: true },
}));

vi.mock("../src/plugin/notice-utils", () => ({
	isUserEditingMarkdown: vi.fn(() => true),
}));

vi.mock("../src/plugin/ai-summaries/bridge-server", () => ({
	ensureAiBridgeServerRunning: vi.fn(async () => undefined),
	maybeNudgeBridgeNotReady: vi.fn(() => undefined),
}));

const enqueueCalls: any[] = [];

vi.mock("../src/plugin/ai-summaries/indexer", () => ({
	getIndexerInternals: () => ({
		files: {
			"a.md": {
				cdate: {
					date: "2026-02-12",
					aiSummary: "",
					aiSummaryInputHash: "",
				},
			},
		},
	}),
	resolveTargetEntries: () => [],
}));

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	getIndexedPathsNewestFirst: () => ["a.md"],
	buildJobsForFile: vi.fn(async () => ({
		jobs: [
			{
				id: "j1",
				filePath: "a.md",
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
	})),
	sortJobsNewestFirst: (jobs: any[]) => jobs,
}));

import { generateMissingAiSummariesForAllRecords, enqueueAiSummariesForFile } from "../src/plugin/ai-summaries/methods-summaries";

describe("explicit AI summary actions always show notices", () => {
	it("generateMissingAiSummariesForAllRecords shows a notice even when editing", async () => {
		noticeCalls.length = 0;
		enqueueCalls.length = 0;

		const plugin: any = {
			settings: { summarizeAI: false },
			hasProAccess: () => true,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				enqueue: (jobs: any[]) => enqueueCalls.push(...jobs),
				getStatus: () => ({ clientConnected: true }),
			},
		};
		withTrustedPro(plugin);

		await generateMissingAiSummariesForAllRecords.call(plugin);

		expect(noticeCalls.some((m) => m.startsWith("AI summaries:"))).toBe(true);
	});

	it("enqueueAiSummariesForFile(showNotice) shows a notice even when editing", async () => {
		noticeCalls.length = 0;
		enqueueCalls.length = 0;

		const plugin: any = {
			settings: { summarizeAI: false },
			hasProAccess: () => true,
			openAiBridgeWindow: async () => undefined,
			app: {},
			aiBridge: {
				enqueue: (jobs: any[]) => enqueueCalls.push(...jobs),
				getStatus: () => ({ clientConnected: true }),
			},
		};
		withTrustedPro(plugin);

		await enqueueAiSummariesForFile.call(plugin, "a.md", { showNotice: true });

		expect(noticeCalls.some((m) => m.startsWith("AI summaries:") && m.includes("queued") && /\d+/.test(m))).toBe(true);
	});
});
