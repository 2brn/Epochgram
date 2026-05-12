import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";
import { buildJobsForFile } from "../src/plugin/ai-summaries/file-jobs";
import { resolveTargetEntries } from "../src/plugin/ai-summaries/indexer";

function makeFile(path: string, ctime: number): TFile {
	const name = path.split("/").pop() ?? path;
	const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
	const basename = extension ? name.slice(0, -(extension.length + 1)) : name;
	const Ctor = TFile as unknown as new (path: string, options?: Partial<TFile>) => TFile;
	return new Ctor(path, {
		basename,
		extension,
		stat: {
			ctime,
			mtime: ctime,
			size: 0
		}
	});
}

describe("AI jobs treat dateprop as anchor", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: true,
				parseDatesInFrontmatter: true
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					adapter: {
						read: vi.fn(async (path: string) => contents[path] ?? "")
					},
					getAbstractFileByPath: vi.fn()
				},
				metadataCache: {
					getFileCache: vi.fn(() => ({ frontmatter: {}, tags: [] }))
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
		pluginStub.indexer = indexer;
	});

	it("buildJobsForFile emits dateProp anchor jobs that target data.dateProp", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/note.md", ctime);
		contents[file.path] = [
			"---",
			"date: 2025-01-02",
			"---",
			"Body text"
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const data = (indexer as any).files[file.path];
		expect(data?.dateProp?.source).toBe("dateprop");
		expect(data?.dateProp?.date).toBe("2025-01-02");

		const built = await buildJobsForFile(pluginStub, file.path, false);
		const job = built.jobs.find((j: any) => j && j.kind === "dateProp");
		expect(job).toBeTruthy();
		if (!job) throw new Error("Expected dateProp job");
		expect(job.groupType).toBe("anchor");
		expect(job.groupDate).toBe("2025-01-02");

		const targets = resolveTargetEntries(data, job as any);
		expect(targets.length).toBeGreaterThan(0);
		expect(targets.some((e: any) => e?.source === "dateprop" && e?.date === "2025-01-02")).toBe(true);
	});

	it("buildJobsForFile skips AI jobs when YAML description exists", async () => {
		const ctime = Date.UTC(2025, 0, 1);
		const file = makeFile("folder/note-with-description.md", ctime);
		contents[file.path] = [
			"---",
			"date: 2025-01-02",
			"description: manual summary",
			"---",
			"Body text"
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const built = await buildJobsForFile(pluginStub, file.path, false);
		expect(built.jobs.length).toBe(0);
		expect(String(built.reason ?? "")).toBe("YAML description exists");
	});
});
