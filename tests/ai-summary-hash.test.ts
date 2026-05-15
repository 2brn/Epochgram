import { beforeEach, describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { normalizeDateFromTimestamp } from "../src/indexer/extractor";
import { validateBridgeOptionsYaml } from "../src/plugin/ai-bridge/sanitize";
import { TFile } from "obsidian";
import { computeAiSummaryInputHash } from "../src/utils";

describe("AI summary hash consistency", () => {
	let indexer: Indexer;
	let pluginStub: any;
	let contents: Record<string, string>;

	beforeEach(() => {
		contents = {};
		const validated = validateBridgeOptionsYaml("");
		pluginStub = {
			settings: {
				trackChanges: false,
				summaryWordsCount: 8,
				summarizeAI: true,
				aiBridgeOptions: validated.stored
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
			},
			aiBridgeResolved: validated.resolved
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

	it("uses stored AI summary for long inputs above records.maxInputChars", async () => {
		const ctime = Date.UTC(2025, 0, 5);
		const file = makeFile("folder/long-note.md", ctime);
		const maxInputChars = pluginStub.aiBridgeResolved.records?.maxInputChars ?? 24000;

		// Make content longer than the configured hashing window.
		contents[file.path] = "# Heading\n" + "word ".repeat(60000);
		expect(contents[file.path].length).toBeGreaterThan(maxInputChars);

		await indexer.processFile(file, { reason: "modify" });

		const dateKey = normalizeDateFromTimestamp(ctime);
		const fileData = (indexer as any).files[file.path];
		expect(fileData?.cdate?.date).toBe(dateKey);

		const aiSummary = "AI SUMMARY SHOULD WIN";
		const fullText = contents[file.path];
		const joinLinesUpToChars = (ls: string[], maxChars: number): string => {
			if (!ls || ls.length === 0) return "";
			if (!(maxChars > 0)) return "";
			let out = "";
			for (let i = 0; i < ls.length; i++) {
				const next = (out ? "\n" : "") + String(ls[i] ?? "");
				if (out.length + next.length > maxChars) break;
				out += next;
			}
			return out;
		};
		const fullTextForHash = joinLinesUpToChars(fullText.split(/\r?\n/), maxInputChars);
		fileData.cdate.aiSummary = aiSummary;
		fileData.cdate.aiSummaryInputHash = computeAiSummaryInputHash(file.path, "anchor", fullTextForHash, maxInputChars);

		// Rebuild aggregated entries to pick up AI summary.
		(indexer as any).latestLines[file.path] = fullText.split(/\r?\n/);
		(indexer as any).updateAggregatedEntries(file.path);

		const aggregated = indexer.index[dateKey]?.find((e: any) => e.file === file.path);
		expect(aggregated?.summary).toBe(aiSummary);
	});
});
