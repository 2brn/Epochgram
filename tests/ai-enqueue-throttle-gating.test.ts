import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string) {}
	},
	Platform: { isDesktop: true, isMobile: false },
}));

const ensureAiBridgeServerRunning = vi.fn(async () => undefined);

vi.mock("../src/plugin/ai-summaries/bridge-server", () => ({
	ensureAiBridgeServerRunning: (...args: any[]) => ensureAiBridgeServerRunning(...args),
}));

const isSummarizeAIEffective = vi.fn(() => false);

vi.mock("../src/plugin/pro-feature-state", () => ({
	isSummarizeAIEffective: (...args: any[]) => isSummarizeAIEffective(...args),
}));

import { enqueueThrottledJobs } from "../src/plugin/ai-summaries/enqueue-throttle";

describe("AI enqueue throttle gating", () => {
	beforeEach(() => {
		ensureAiBridgeServerRunning.mockClear();
		isSummarizeAIEffective.mockReset();
		isSummarizeAIEffective.mockReturnValue(false);
	});

	it("does not start bridge when summarizeAI is disabled for auto enqueue", async () => {
		const plugin: any = {};
		const jobs: any[] = [
			{
				id: "j1",
				filePath: "note.md",
				kind: "cdate",
				date: "2026-01-01",
				blockStart: 0,
				blockEnd: 1,
				source: "cdate",
				input: "x",
				context: "",
				inputHash: "h1",
				createdAt: Date.now(),
			},
		];

		await enqueueThrottledJobs(plugin, "note.md", jobs, {
			showNotice: false,
			allowWhenSummarizeAIDisabled: false,
		});

		expect(ensureAiBridgeServerRunning).not.toHaveBeenCalled();
	});

	it("allows bridge start when caller explicitly opts in", async () => {
		const plugin: any = {};
		const jobs: any[] = [
			{
				id: "j1",
				filePath: "note.md",
				kind: "cdate",
				date: "2026-01-01",
				blockStart: 0,
				blockEnd: 1,
				source: "cdate",
				input: "x",
				context: "",
				inputHash: "h1",
				createdAt: Date.now(),
			},
		];

		await enqueueThrottledJobs(plugin, "note.md", jobs, {
			showNotice: false,
			allowWhenSummarizeAIDisabled: true,
		});

		expect(ensureAiBridgeServerRunning).toHaveBeenCalledTimes(1);
	});
});
