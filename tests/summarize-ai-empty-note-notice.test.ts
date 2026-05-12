import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import * as obsidian from "obsidian";
import { TFile } from "obsidian";
import { enqueueAiSummaryForEntry } from "../src/plugin/ai-summaries/methods-summaries";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("Summarize AI on empty note", () => {
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
		withTrustedPro(pluginStub);
		indexer = new Indexer(pluginStub);
		pluginStub.indexer = indexer;
	});

	const makeFile = (path: string, ctime: number): TFile => {
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
	};

	it("shows a notice and does not enqueue jobs", async () => {
		const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation((() => {
			return {} as any;
		}) as any);
		const ctime = Date.UTC(2026, 0, 24);
		const file = makeFile("folder/empty.md", ctime);
		contents[file.path] = "\n\n\t\t\n";

		await indexer.processFile(file, { reason: "modify" });
		const entry = (indexer as any).files[file.path]?.cdate;
		expect(entry).toBeTruthy();

		await enqueueAiSummaryForEntry.call(pluginStub, entry, { force: true, showNotice: true });

		expect(noticeSpy.mock.calls.some((c) => c[0] === "Note is empty")).toBe(true);
	});

	it("treats frontmatter-only date notes as empty", async () => {
		const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation((() => {
			return {} as any;
		}) as any);
		const ctime = Date.UTC(2026, 0, 25);
		const file = makeFile("folder/only-date.md", ctime);
		contents[file.path] = "---\ndate: 2026-01-01\n---\n";

		await indexer.processFile(file, { reason: "modify" });
		const entry = (indexer as any).files[file.path]?.cdate;
		expect(entry).toBeTruthy();

		await enqueueAiSummaryForEntry.call(pluginStub, entry, { force: true, showNotice: true });

		expect(noticeSpy.mock.calls.some((c) => c[0] === "Note is empty")).toBe(true);
	});
});
