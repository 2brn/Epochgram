import { beforeEach, describe, expect, it, vi } from "vitest";

import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";
import { buildJobsForFile } from "../src/plugin/ai-summaries/file-jobs";

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

describe("AI summary input chunking", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: true,
				summaryWordsCount: 8,
				summarizeAI: true,
				parseDatesInFrontmatter: true,
				aiBridgeOptions: {
					settingsYaml: [
						"records:",
						"  maxInputChars: 12000",
						"reduce:",
						"  maxChunkChars: 1200",
						"  maxDepth: 3"
					].join("\n")
				}
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

	function expectChunked(jobs: any[]): void {
		expect(jobs.length).toBeGreaterThan(1);
		const groupId = String(jobs[0]?.groupId ?? "");
		expect(groupId).not.toBe("");
		for (let i = 0; i < jobs.length; i++) {
			const job = jobs[i]!;
			expect(String(job.groupId ?? "")).toBe(groupId);
			expect(job.reduce).toBe(true);
			expect(job.reduceDepth).toBe(0);
			expect(job.chunkCount).toBe(jobs.length);
			expect(job.chunkIndex).toBe(i);
		}
	}

	it("chunks oversized anchor jobs into grouped reduce jobs", async () => {
		const ctime = Date.UTC(2025, 0, 2);
		const file = makeFile("folder/anchor-long.md", ctime);
		contents[file.path] = [
			"---",
			"date: 2025-01-02",
			"---",
			("Paragraph " + "x".repeat(900)).repeat(4)
		].join("\n\n");

		await indexer.processFile(file, { reason: "modify" });

		const built = await buildJobsForFile(pluginStub, file.path, false);
		const anchorJobs = built.jobs.filter((job: any) => job.groupType === "anchor");
		expectChunked(anchorJobs);
	});

	it("chunks oversized content jobs into grouped reduce jobs", async () => {
		const ctime = Date.UTC(2025, 0, 3);
		const file = makeFile("folder/content-long.md", ctime);
		contents[file.path] = [
			"2025-01-03 " + "alpha ".repeat(350),
			"2025-01-03 " + "beta ".repeat(350)
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		const built = await buildJobsForFile(pluginStub, file.path, false);
		const contentJobs = built.jobs.filter((job: any) => job.groupType === "content" && job.kind === "content");
		expectChunked(contentJobs);
	});
});