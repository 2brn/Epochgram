import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
let options: any;
vi.mock("../src/ui/modals/timeline-search-modal", () => ({ TimelineSearchModal: class { constructor(_app: any, opts: any) { options = opts; } open() {} } }));
import { openSearchModal } from "../src/ui/epoch-view/search-modal";
function setup(ranked = false, draftsOnly = false, history = true) {
	const app: any = new App(); app.workspace = { getActiveFile: () => null, getLastOpenFiles: () => [] };
	const date = "2026-01-01";
	const entries = [
		{ file: "hidden.md", reviewState: "hidden", source: "cdate" },
		{ file: "reviewed.md", reviewState: "reviewed", source: "cdate" },
		{ file: "draft.md", source: "cdate" },
		{ file: "mixed.md", reviewState: "hidden", source: "cdate" },
		{ file: "mixed.md", source: "content" }
	].map(e => ({ ...e, date, summary: "Matching text", blockStart: 0, blockEnd: 0 }));
	const paths = ["hidden.md", "reviewed.md", "draft.md", "mixed.md"];
	const plugin: any = { app, settings: {}, __timelineSearchLastOpenedFiles: history ? paths : [], timelineSearchIndex: ranked ? { searchFileIdsRanked: () => paths, searchFileIds: () => new Set(paths) } : undefined };
	const canvas: any = { index: { [date]: entries }, showDraftsOnly: draftsOnly, plugin, searchQuery: "" };
	openSearchModal({ app, plugin, canvas, searchModalOpen: false, searchQuery: "", setSearchQueryInternal() {} });
}
beforeEach(() => { options = null; });
describe("review visibility in search suggestions", () => {
	it.each([true, false])("filters empty history/fallback results (history=%s)", history => {
		setup(false, false, history);
		const results = options.getTopMatches("", 20);
		expect(results.map((r: any) => r.entry.file)).toEqual(["reviewed.md", "draft.md", "mixed.md"]);
		expect(results.find((r: any) => r.entry.file === "mixed.md").entry.source).toBe("content");
	});
	it.each([true, false])("filters ranked/fallback text matches (ranked=%s)", ranked => {
		setup(ranked, true);
		expect(options.getTopMatches("Matching", 20).map((r: any) => r.entry.file)).toEqual(["draft.md", "mixed.md"]);
	});
	it.each(["$hidden", "!hidden"])("%s selects Hidden even with Drafts only", token => {
		setup(true, true);
		expect(options.getTopMatches(token, 20).map((r: any) => r.entry.file)).toEqual(["hidden.md", "mixed.md"]);
	});
});
