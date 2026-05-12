import { describe, expect, it } from "vitest";

import { getEntriesForDate } from "../src/ui/entry-helpers";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";

function makeCanvasBase(index: any, overrides: Partial<any> = {}): any {
	return {
		index,
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: false,
		searchQuery: "",
		plugin: {
			timelineSearchIndex: new TimelineSearchIndex(),
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => ({ path: p, extension: "md" })
				},
				metadataCache: {
					getFileCache: () => ({ frontmatter: {}, tags: [] })
				}
			}
		},
		...overrides
	};
}

describe("timeline search haystack includes tags, aliases, and dates", () => {
	it("matches by entry date", () => {
		const dateKey = "2026-02-18";
		const index: any = {
			[dateKey]: [
				{ date: dateKey, file: "note.md", source: "cdate", summary: "", blockStart: 0, blockEnd: 0 }
			]
		};
		const canvas = makeCanvasBase(index, { searchQuery: "2026-02-18" });
		const entries = getEntriesForDate(canvas as any, new Date(2026, 1, 18));
		expect(entries.map((e: any) => e.file)).toEqual(["note.md"]);
	});

	it("matches by Obsidian tag (via MiniSearch meta)", () => {
		const dateKey = "2026-02-18";
		const index: any = {
			[dateKey]: [
				{ date: dateKey, file: "note.md", source: "cdate", summary: "", blockStart: 0, blockEnd: 0 }
			]
		};
		const canvas = makeCanvasBase(index, { searchQuery: "#project" });
		canvas.plugin.timelineSearchIndex.upsert({
			id: "note.md",
			kind: "file",
			path: "note.md",
			basename: "note",
			directory: "",
			meta: "#project",
			content: ""
		});
		const entries = getEntriesForDate(canvas as any, new Date(2026, 1, 18));
		expect(entries.map((e: any) => e.file)).toEqual(["note.md"]);
	});

	it("matches by alias (via MiniSearch meta)", () => {
		const dateKey = "2026-02-18";
		const index: any = {
			[dateKey]: [
				{ date: dateKey, file: "note.md", source: "cdate", summary: "", blockStart: 0, blockEnd: 0 }
			]
		};
		const canvas = makeCanvasBase(index, { searchQuery: "my alias" });
		canvas.plugin.timelineSearchIndex.upsert({
			id: "note.md",
			kind: "file",
			path: "note.md",
			basename: "note",
			directory: "",
			meta: "My Alias",
			content: ""
		});
		const entries = getEntriesForDate(canvas as any, new Date(2026, 1, 18));
		expect(entries.map((e: any) => e.file)).toEqual(["note.md"]);
	});

	it("matches by full file text content (MiniSearch)", () => {
		const dateKey = "2026-02-18";
		const index: any = {
			[dateKey]: [
				{ date: dateKey, file: "note.md", source: "content", summary: "", blockStart: 0, blockEnd: 0 }
			]
		};
		const canvas = makeCanvasBase(index, { searchQuery: "needle" });
		canvas.plugin.timelineSearchIndex.upsert({
			id: "note.md",
			kind: "file",
			path: "note.md",
			basename: "note",
			directory: "",
			meta: "",
			content: "this is the needle inside the file"
		});
		const entries = getEntriesForDate(canvas as any, new Date(2026, 1, 18));
		expect(entries.map((e: any) => e.file)).toEqual(["note.md"]);
	});
});
