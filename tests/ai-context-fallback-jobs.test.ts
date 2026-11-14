import { describe, expect, it, vi } from "vitest";
import type { EpochPlugin } from "../src/main";
import type { AiSummaryJob } from "../src/plugin/ai-bridge";
import type { FileDateEntry } from "../src/indexer/types";
import { validateBridgeOptionsYaml } from "../src/plugin/ai-bridge/sanitize";
import { buildEpochJobs, buildEpochJobsForDateKeys } from "../src/plugin/ai-summaries/epochs";
import { handleBridgeResult } from "../src/plugin/ai-summaries/result-handler";

const defaults = validateBridgeOptionsYaml("").resolved;
const date = "2026-01-04";
const settings = {
	generateEpochs: true,
	aiBridgeOptions: { settingsYaml: "reduce:\n  maxChunkChars: 80" }
};

function record(file: string, summary: string): FileDateEntry {
	return { file, summary, date, source: "content", blockStart: 0, blockEnd: 0 };
}

describe("YAML-derived job context fallbacks", () => {
	it.each(["all", "touched"] as const)("uses reduction defaults for initial %s epoch chunks", async (mode) => {
		const entries = [record("Alpha.md", "A".repeat(60)), record("Beta.md", "B".repeat(60))];
		const plugin = {
			settings,
			indexer: { files: {}, index: { [date]: entries } }
		} as unknown as EpochPlugin;
		const jobs = mode === "all"
			? await buildEpochJobs(plugin, "force")
			: await buildEpochJobsForDateKeys(plugin, [date], "force", ["day"]);
		const dayJobs = jobs.filter(job => job.epochBucket === "day");
		expect(dayJobs.length).toBeGreaterThan(1);
		for (const job of dayJobs) {
			expect(job.reduce).toBe(true);
			expect(job.groupId).toBeTruthy();
			expect(job.context).toBe(defaults.reduce?.context?.trim());
		}
	});

	it.each(["content", "epoch"] as const)("switches %s fallback from intermediate to final YAML context", (kind) => {
		const file = kind === "epoch" ? `epoch://day/${date}-${date}` : "Alpha.md";
		const entry = record(file, "Original record");
		const enqueue = vi.fn<(jobs: AiSummaryJob[]) => void>();
		const plugin = {
			settings,
			indexer: { files: { [file]: { contentDates: [entry] } }, index: {} },
			aiBridge: { enqueue }
		} as unknown as EpochPlugin;
		const base: AiSummaryJob = {
			id: "chunk",
			filePath: file,
			kind,
			date,
			blockStart: 0,
			blockEnd: 0,
			source: kind,
			input: "source",
			inputHash: "hash",
			context: "",
			createdAt: 0,
			reduce: true,
			groupId: "initial",
			chunkCount: 2,
			epochBucket: "day",
			epochStart: date,
			epochEnd: date
		};
		handleBridgeResult(plugin, { ...base, id: "a", chunkIndex: 0 }, { summary: "A".repeat(60) });
		handleBridgeResult(plugin, { ...base, id: "b", chunkIndex: 1 }, { summary: "B".repeat(60) });
		expect(enqueue).toHaveBeenCalledOnce();
		const intermediate = enqueue.mock.calls[0]![0];
		expect(intermediate.length).toBeGreaterThan(1);
		for (const job of intermediate) {
			expect(job.groupId).toBeTruthy();
			expect(job.context).toBe(defaults.reduce?.context?.trim());
		}

		enqueue.mockClear();
		intermediate.forEach((job, i) => handleBridgeResult(plugin, job, { summary: `Result ${i}` }));
		expect(enqueue).toHaveBeenCalledOnce();
		const finalJobs = enqueue.mock.calls[0]![0];
		expect(finalJobs).toHaveLength(1);
		expect(finalJobs[0]?.groupId).toBeUndefined();
		expect(finalJobs[0]?.context).toBe(kind === "epoch"
			? defaults.epochs[0]?.context?.trim()
			: defaults.records?.context?.trim().replace("{{filePath}}", file));
	});
});
