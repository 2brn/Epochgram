import { describe, expect, it, vi } from "vitest";

import type { AiSummaryJob } from "../src/plugin/ai-bridge";
import type EpochPlugin from "../src/main";
import { withTrustedPro } from "./helpers/trusted-pro";

vi.mock("obsidian", () => ({
	Notice: class Notice {
		constructor(_message: string, _timeout?: number) {}
	},
	Platform: { isDesktop: true },
}));

type EnqueueThrottledJobsArgs = [
	plugin: EpochPlugin,
	filePath: string,
	jobs: AiSummaryJob[],
	options: { showNotice?: boolean; allowWhenSummarizeAIDisabled?: boolean } | undefined
];
type BuildJobsForFileArgs = [plugin: EpochPlugin, filePath: string, force: boolean];

const enqueueThrottledJobsMock = vi.fn<EnqueueThrottledJobsArgs, Promise<void>>(async () => undefined);
const buildJobsForFileMock = vi.fn<BuildJobsForFileArgs, Promise<{ jobs: AiSummaryJob[]; reason?: string }>>(async () => ({ jobs: [], reason: "" }));

vi.mock("../src/plugin/ai-summaries/enqueue-throttle", () => ({
	enqueueThrottledJobs: (...args: EnqueueThrottledJobsArgs) => enqueueThrottledJobsMock(...args),
	isAutoSummarizeEnqueue: () => false,
	shouldApplyEnqueueCooldown: () => false,
}));

vi.mock("../src/plugin/ai-summaries/file-jobs", () => ({
	buildJobsForFile: (...args: BuildJobsForFileArgs) => buildJobsForFileMock(...args),
	getIndexedPathsNewestFirst: () => [],
	sortJobsNewestFirst: (jobs: any[]) => jobs,
}));

import { enqueueAiSummaryForEntry } from "../src/plugin/ai-summaries/methods-summaries";

describe("Summarize AI from filename date-range record", () => {
	it("enqueues the content-group job for the clicked range-day entry", async () => {
		enqueueThrottledJobsMock.mockClear();
		buildJobsForFileMock.mockClear();

		buildJobsForFileMock.mockResolvedValue({
			jobs: [
				{
					id: "j_anchor",
					filePath: "Daily/range.md",
					kind: "namedDate",
					date: "2026-01-01",
					blockStart: 0,
					blockEnd: 10,
					source: "namedate",
					groupType: "anchor",
					groupDate: "2026-01-01",
					input: "x",
					context: "",
					inputHash: "h_anchor",
					createdAt: 0,
					targets: [
						{ kind: "namedDate", date: "2026-01-01", blockStart: 0, blockEnd: 10, source: "namedate" },
						{ kind: "content", date: "2026-01-02", blockStart: 0, blockEnd: 10, source: "namedate" },
					],
				},
			],
			reason: "",
		});

		const pluginStub: any = {
			hasProAccess: () => true,
			settings: { summarizeAI: true },
		};
		withTrustedPro(pluginStub);

		const entry: any = {
			file: "Daily/range.md",
			source: "namedate",
			date: "2026-01-02",
			blockStart: 0,
			blockEnd: 10,
		};

		await enqueueAiSummaryForEntry.call(pluginStub, entry, { force: true, showNotice: true });

		expect(enqueueThrottledJobsMock).toHaveBeenCalledTimes(1);
		const jobsArg = enqueueThrottledJobsMock.mock.calls[0]![2];
		expect(jobsArg.map((j) => j.id)).toEqual(["j_anchor"]);
	});
});
