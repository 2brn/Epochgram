import { describe, expect, it, vi } from "vitest";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string, _timeout?: number) {}
	},
	Platform: { isDesktop: true },
}));

const enqueueThrottledJobs = vi.fn(async () => undefined);
const buildJobsForFile = vi.fn(async () => ({ jobs: [], reason: "" }));

vi.mock("../src/plugin/ai-summaries/enqueue-throttle", () => ({
	enqueueThrottledJobs: (...args: any[]) => enqueueThrottledJobs(...args),
	isAutoSummarizeEnqueue: () => false,
	shouldApplyEnqueueCooldown: () => false,
}));

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	buildJobsForFile: (...args: any[]) => buildJobsForFile(...args),
	getIndexedPathsNewestFirst: () => [],
	sortJobsNewestFirst: (jobs: any[]) => jobs,
}));

import { enqueueAiSummaryForEntry } from "../src/plugin/ai-summaries/methods-summaries";

describe("Summarize AI on pinned-today entry", () => {
	it("enqueues jobs for originalDate (not today)", async () => {
		enqueueThrottledJobs.mockClear();
		buildJobsForFile.mockClear();

		buildJobsForFile.mockResolvedValue({
			jobs: [
				{ id: "j1", filePath: "Daily/note.md", kind: "summary", groupType: "anchor", groupDate: "2026-01-17", input: "x" },
				{ id: "j2", filePath: "Daily/note.md", kind: "summary", groupType: "anchor", groupDate: "2026-02-22", input: "y" },
			],
			reason: "",
		});

		const pluginStub: any = {
			hasProAccess: () => true,
			settings: { summarizeAI: true },
		};
		withTrustedPro(pluginStub);

		const entry: any = {
			file: "Daily/note.md",
			source: "cdate",
			date: "2026-02-22",
			originalDate: "2026-01-17",
			pinned: true,
		};

		await enqueueAiSummaryForEntry.call(pluginStub, entry, { force: true, showNotice: true });

		expect(enqueueThrottledJobs).toHaveBeenCalledTimes(1);
		const jobsArg = enqueueThrottledJobs.mock.calls[0]?.[2] as any[];
		expect(Array.isArray(jobsArg)).toBe(true);
		expect(jobsArg.map((j) => j.id)).toEqual(["j1"]);
	});
});
