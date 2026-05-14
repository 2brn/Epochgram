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

describe("AI summary input sanitization", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: true
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
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
		pluginStub.indexer = indexer;
	});

	it("strips markdown and html before queue input", async () => {
		const ctime = Date.UTC(2026, 0, 2);
		const file = makeFile("notes/sanitize.md", ctime);
		contents[file.path] = [
			"---",
			"title: Sanitize",
			"---",
			"# Heading",
			"Some **bold** text and [a link](https://example.com/path?q=1).",
			"<b>inline html</b>",
			"```ts",
			"const x = 1;",
			"```"
		].join("\n");

		await indexer.processFile(file, { reason: "modify" });
		const built = await buildJobsForFile(pluginStub, file.path, true);
		expect(built.jobs.length).toBeGreaterThan(0);

		const combined = built.jobs.map((j: any) => String(j.input || "")).join("\n");
		expect(combined).toContain("Heading");
		expect(combined).toContain("inline html");
		expect(combined).not.toContain("**");
		expect(combined).not.toContain("[");
		expect(combined).not.toContain("<b>");
		expect(combined).not.toContain("```");
	});
});
