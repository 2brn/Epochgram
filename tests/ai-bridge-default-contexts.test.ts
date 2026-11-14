import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import * as YAML from "yaml";
import defaultBridgeSettingsYaml from "epochgram-bridge-default-settings-yaml";
import type { AiSummaryJob } from "../src/plugin/ai-bridge";
import { validateBridgeOptionsYaml, type BridgeResolvedSettings } from "../src/plugin/ai-bridge/sanitize";
import { AI_BRIDGE_SCRIPT_PART1_CHUNK_A } from "../src/plugin/ai-bridge-page/script-part-ui-state";
import { AI_BRIDGE_SCRIPT_PART2 } from "../src/plugin/ai-bridge-page/script-part-detect";
import { buildEpochContext, buildEpochReduceContext, buildIntermediateReduceContext, buildPerCallContext } from "../src/plugin/ai-summaries/contexts";
import { getDefaultBridgeSettings } from "../src/plugin/ai-summaries/bridge-settings";
import type { FileDateEntry } from "../src/indexer/types";

const defaults = validateBridgeOptionsYaml("").resolved;
const entry: FileDateEntry = {
	file: "note.md", date: "2026-01-04", source: "content", blockStart: 0, blockEnd: 0, summary: ""
};

function bridgeSandbox(job: Partial<AiSummaryJob>, globals: Record<string, unknown> = {}): vm.Context {
	const sandbox = vm.createContext({
		optionsState: { resolved: defaults },
		resetDefaultsBtn: null,
		downloadBtn: null,
		job,
		...globals
	});
	vm.runInContext(`${AI_BRIDGE_SCRIPT_PART1_CHUNK_A}\n${AI_BRIDGE_SCRIPT_PART2}`, sandbox);
	return sandbox;
}

function contextForJob(job: Partial<AiSummaryJob>, resolved: BridgeResolvedSettings | null = defaults): string {
	return vm.runInContext(`
		const settings = buildBridgeSettingsForJob(job);
		const rendered = renderContextTemplate(settings.jobSpecificContext, job, settings);
		rendered.trim() ? rendered : (job.context || "");
	`, bridgeSandbox(job, { optionsState: { resolved } })) as string;
}

describe("AI bridge default contexts", () => {
	it("validates the shipped YAML and keeps the native/input/output budgets unchanged", () => {
		const checked = validateBridgeOptionsYaml(defaultBridgeSettingsYaml);
		expect(checked.valid).toBe(true);
		expect(checked.errors).toEqual([]);
		expect(checked.resolved).toEqual(defaults);
		expect(defaults).toMatchObject({
			format: "plain-text",
			preference: "capability",
			expectedInputLanguages: ["en"],
			expectedContextLanguages: ["en"],
			outputLanguage: "en",
			backend: { mode: "native", maxRetries: 3 },
			maxRelatedChars: 300,
			reduce: { type: "tldr", length: "long", maxChunkChars: 3000, maxDepth: 3 },
			records: { type: "tldr", length: "short", maxInputChars: 3000, maxOutputWords: 30 },
			epochs: [
				{ period: "day-2weeks", type: "tldr", length: "short", maxFileChars: 300, maxOutputWords: 30 },
				{ period: "month-year", type: "tldr", length: "medium", maxFileChars: 300, maxOutputWords: 30 }
			]
		});
	});

	it("keeps every prompt within its previous character and UTF-8 byte budget", () => {
		// Pre-specificity defaults, trimmed. These are size guards, not estimates of
		// native model tokens; the native API retains its runtime quota checks.
		const budgets: Array<[string, string | undefined, number]> = [
			["shared", defaults.sharedContext, 113],
			["reduce", defaults.reduce?.context, 77],
			["records", defaults.records?.context, 136],
			["short epoch", defaults.epochs[0]?.context, 118],
			["long epoch", defaults.epochs[1]?.context, 120],
			["record fallback", buildPerCallContext("{{filePath}}", entry), 149],
			["epoch fallback", buildEpochContext("year", "2026-01-01", "2026-12-31"), 162]
		];
		for (const [name, raw, max] of budgets) {
			const text = String(raw ?? "").trim();
			expect(text.length, name).toBeGreaterThan(0);
			expect(text.length, name).toBeLessThanOrEqual(max);
			expect(Buffer.byteLength(text, "utf8"), name).toBeLessThanOrEqual(max);
		}
		// Do not add related text or additional template expansions to the defaults.
		expect(defaults.records?.context?.match(/\{\{\w+\}\}/g)).toEqual(["{{filePath}}"]);
		for (const context of [defaults.sharedContext, defaults.reduce?.context, ...defaults.epochs.map(e => e.context)]) {
			expect(context).not.toMatch(/\{\{/);
		}
	});

	it("preserves source names and status instead of encouraging category lists", () => {
		expect(defaults.sharedContext).toContain("Use only input facts");
		expect(defaults.sharedContext).toContain("exact names from text or paths, not categories");
		expect(defaults.reduce?.context).toContain("preserve names, facts and status");
		expect(defaults.records?.context).toContain("subject names, key facts, decisions and task status");
		for (const epoch of defaults.epochs) {
			expect(epoch.context).toMatch(/Name .*projects/);
			expect(epoch.context).toContain("status");
			expect(epoch.context).toContain("Output max 12 words");
			expect(epoch.context).not.toMatch(/nouns only|Broad period summary|Long-term themes/);
		}
		expect(buildPerCallContext("note.md", entry)).toBe(defaults.records!.context!.trim().replace("{{filePath}}", "note.md"));
		expect(buildIntermediateReduceContext()).toBe(defaults.reduce!.context!.trim());
	});

	it("keeps the documented YAML equal to the shipped defaults", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
		const section = readme.slice(readme.indexOf("## AI bridge (Pro, desktop-only)"));
		const yaml = section.match(/```yaml\r?\n([\s\S]*?)```/)?.[1];
		expect(yaml).toBeTruthy();
		expect(YAML.parse(yaml!)).toEqual(YAML.parse(defaultBridgeSettingsYaml));
	});

	it.each(["cdate", "dateProp", "namedDate", "content", "tracked"] as const)("renders named file paths for %s records", (kind) => {
		const filePath = "Projects/Orion.Fine/Plan.md";
		const context = contextForJob({ kind, filePath, related: "Unrelated material" });
		expect(context).toBe(defaults.records!.context!.trim().replace("{{filePath}}", filePath));
		expect(context).not.toContain("{{");
		expect(context).not.toContain("Unrelated material");
	});

	it.each(["day", "2days", "4days", "week", "2weeks", "month", "3months", "6months", "year"] as const)("selects the specific %s epoch context", (epochBucket) => {
		const rule = ["day", "2days", "4days", "week", "2weeks"].includes(epochBucket) ? 0 : 1;
		const expected = defaults.epochs[rule]!.context!.trim();
		expect(contextForJob({ kind: "epoch", epochBucket })).toBe(expected);
		expect(buildEpochContext(epochBucket, "2026-01-01", "2026-12-31")).toBe(expected);
		expect(buildEpochReduceContext(epochBucket, "2026-01-01", "2026-12-31")).toBe(expected);
	});

	it.each(["content", "epoch"] as const)("preserves names during intermediate %s reduction and applies the final context", (kind) => {
		const job: Partial<AiSummaryJob> = {
			kind,
			filePath: "Projects/Orion.Fine/Plan.md",
			epochBucket: "month",
			reduce: true,
			reduceDepth: 1
		};
		expect(contextForJob({ ...job, groupId: "chunks", chunkCount: 2 })).toBe(defaults.reduce!.context!.trim());
		// The final (ungrouped) reduction returns to the record/epoch output contract.
		const expected = kind === "epoch"
			? defaults.epochs[1]!.context!.trim()
			: defaults.records!.context!.trim().replace("{{filePath}}", job.filePath!);
		expect(contextForJob(job)).toBe(expected);
	});

	it("caches the validated YAML defaults instead of reparsing them per job", () => {
		expect(getDefaultBridgeSettings()).toEqual(defaults);
		expect(getDefaultBridgeSettings()).toBe(getDefaultBridgeSettings());
	});

	it.each(["day", "month"] as const)("uses the YAML-derived %s fallback for partial epoch rules", (epochBucket) => {
		// Epoch arrays replace defaults: day has no context, month has no rule.
		const checked = validateBridgeOptionsYaml("epochs:\n  - period: day\n    maxFileChars: 100");
		expect(checked.valid).toBe(true);
		const job: Partial<AiSummaryJob> = {
			kind: "epoch", epochBucket,
			context: buildEpochContext(epochBucket, "2026-01-01", "2026-01-31")
		};
		expect(contextForJob(job, checked.resolved)).toBe(contextForJob(job));
		expect(contextForJob(job, null)).toBe(job.context);
	});

	it("still prefers custom YAML contexts and expands related only when requested", () => {
		const checked = validateBridgeOptionsYaml([
			"records:\n  context: 'Custom {{fileName}}: {{related}}'",
			"reduce:\n  context: Custom reduction",
			"epochs:\n  - period: day-year\n    context: 'Custom epoch: {{related}}'"
		].join("\n"));
		expect(checked.valid).toBe(true);
		const job: Partial<AiSummaryJob> = {
			kind: "content", filePath: "Projects/Orion.Fine/Plan.md", related: "Supplied context",
			context: buildPerCallContext("Projects/Orion.Fine/Plan.md", entry)
		};
		expect(contextForJob(job, checked.resolved)).toBe("Custom Plan: Supplied context");
		expect(contextForJob({ ...job, kind: "epoch", epochBucket: "year" }, checked.resolved)).toBe("Custom epoch: Supplied context");
		expect(contextForJob({ ...job, reduce: true, groupId: "g", chunkCount: 2 }, checked.resolved)).toBe("Custom reduction");
	});

	it("keeps date redaction and does not append related text to record fallbacks", () => {
		const context = buildPerCallContext("Projects/Orion.Fine/2026-01-04.md", entry, "Unrelated material");
		expect(context).toContain("Projects/Orion.Fine/[date].md");
		expect(context).not.toContain("2026-01-04");
		expect(context).not.toContain("Unrelated material");
	});

	it("passes the compact shared and record contexts to the native Summarizer", async () => {
		// Synthetic data and a local API mock: no vault content, provider or model required.
		const summarize = vi.fn().mockResolvedValue("Orion.Fine calibration planned");
		const create = vi.fn().mockResolvedValue({ summarize });
		const api = { create };
		const job: Partial<AiSummaryJob> = {
			kind: "content",
			filePath: "Projects/Orion.Fine/Plan.md",
			input: "Orion.Fine calibration is planned."
		};
		const sandbox = bridgeSandbox(job, {
			window: { Summarizer: api },
			Summarizer: api,
			lastProgress: null,
			resetDownloadProgressState: () => undefined
		});
		await vm.runInContext(`(async () => {
			const settings = buildBridgeSettingsForJob(job);
			const summarizer = await createSummarizer(settings);
			const context = renderContextTemplate(settings.jobSpecificContext, job, settings);
			return await summarizeQuotaAware(summarizer, job.input, context, 0);
		})()`, sandbox);
		expect(create).toHaveBeenCalledOnce();
		expect(create).toHaveBeenCalledWith(expect.objectContaining({
			sharedContext: defaults.sharedContext.trim(),
			type: "tldr",
			length: "short"
		}));
		expect(summarize).toHaveBeenCalledOnce();
		expect(summarize).toHaveBeenCalledWith(job.input, { context: contextForJob(job) });
	});
});
