import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";

describe("Indexer noindex frontmatter", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8
			},
			hasProAccess: () => true,
			app: {
				vault: {
					read: vi.fn(async (target: TFile) => contents[target.path] ?? ""),
					getAbstractFileByPath: vi.fn()
				},
				workspace: {
					getActiveViewOfType: vi.fn()
				}
			}
		};
		indexer = new Indexer(pluginStub);
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

	it("does not index a file that has noindex frontmatter", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("Daily/2026-01-01.md", ctime);
		contents[file.path] = ["---", "noindex:", "---", "Some text 2026-01-01"].join("\n");

		await indexer.processFile(file, { reason: "modify" });

		expect((indexer as any).files[file.path]).toBeUndefined();
		expect(indexer.index["2026-01-01"]).toBeUndefined();
	});

	it("removes an already-indexed file when noindex is added", async () => {
		const ctime = Date.UTC(2026, 0, 1);
		const file = makeFile("Daily/2026-01-01.md", ctime);
		contents[file.path] = "Initial content";

		await indexer.processFile(file, { reason: "modify" });
		expect((indexer as any).files[file.path]).toBeTruthy();
		expect(indexer.index["2026-01-01"]?.some((e: any) => e?.file === file.path)).toBe(true);

		contents[file.path] = ["---", "noindex: true", "---", "Later content"].join("\n");
		await indexer.processFile(file, { reason: "modify" });

		expect((indexer as any).files[file.path]).toBeUndefined();
		expect(indexer.index["2026-01-01"]).toBeUndefined();
	});
});
