import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { TFile } from "obsidian";

vi.mock("../src/plugin/ai-summaries/related", () => {
	return {
		getRelatedScoredForFile: vi.fn(async () => []),
		buildRelatedSummariesAllDates: vi.fn(() => "R".repeat(5000))
	};
});

describe("AI summaries related-context gating", () => {
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

	it("suppresses related for URL-only notes even with frontmatter", async () => {
		const ctime = Date.UTC(2025, 0, 5);
		const file = makeFile("folder/logo.md", ctime);
		contents[file.path] = "---\ntitle: Epoch - Logo\ntags: [epoch]\n---\nhttps://pin.it/abc123\n";

		await indexer.processFile(file, { reason: "modify" });
		const built = await (await import("../src/plugin/ai-summaries/file-jobs")).buildJobsForFile(pluginStub, file.path, true);
		expect(built.jobs.length).toBeGreaterThan(0);
		for (const j of built.jobs) {
			expect(String((j as any).related ?? "")).toBe("");
		}
	});

	it("keeps related for substantive notes but caps length", async () => {
		const ctime = Date.UTC(2025, 0, 6);
		const file = makeFile("folder/spec.md", ctime);
		contents[file.path] = "We should integrate a payment provider for the Pro version.\nAlso consider max zoom improvements and rollout steps.";

		await indexer.processFile(file, { reason: "modify" });
		const built = await (await import("../src/plugin/ai-summaries/file-jobs")).buildJobsForFile(pluginStub, file.path, true);
		expect(built.jobs.length).toBeGreaterThan(0);
		const anyRelated = built.jobs.some(j => String((j as any).related ?? "").length > 0);
		expect(anyRelated).toBe(true);
		for (const j of built.jobs) {
			const r = String((j as any).related ?? "");
			if (r) expect(r.length).toBeLessThanOrEqual(1500);
		}
	});

	it("sanity: indexer still extracts dates", async () => {
		const ctime = Date.UTC(2025, 0, 7);
		const file = makeFile("folder/log.txt", ctime);
		contents[file.path] = "2025-01-04 did something\nmore text";

		await indexer.processFile(file, { reason: "modify" });
		const dateKey = normalizeDateFromTimestamp(ctime);
		const fileData = (indexer as any).files[file.path];
		expect(fileData?.cdate?.date).toBe(dateKey);
	});
});
