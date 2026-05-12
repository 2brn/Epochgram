import { describe, expect, it } from "vitest";

import { getEntriesForDate } from "../src/ui/entry-helpers";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";

function makeCanvasBase(index: any, overrides: Partial<any> = {}): any {
	const plugin: any = {
		timelineSearchIndex: new TimelineSearchIndex(),
		__timelineSearchIndexVersion: 0,
		app: {
			vault: {
				getAbstractFileByPath: (p: string) => ({ path: p, extension: "md" })
			},
			metadataCache: {
				getFileCache: () => ({ frontmatter: {}, tags: [] })
			}
		}
	};

	return {
		index,
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: false,
		searchQuery: "",
		plugin,
		...overrides
	};
}

describe("timeline search rebuild/reset re-applies active query", () => {
	it("recomputes visible entries when search index version changes", () => {
		const dateKey = "2026-02-18";
		const index: any = {
			[dateKey]: [{ date: dateKey, file: "note.md", source: "content", summary: "", blockStart: 0, blockEnd: 0 }]
		};

		const canvas = makeCanvasBase(index, { searchQuery: "needle" });

		// Initial index does not match.
		canvas.plugin.timelineSearchIndex.upsert({
			id: "note.md",
			kind: "file",
			path: "note.md",
			basename: "note",
			directory: "",
			meta: "",
			content: "unrelated"
		});

		let entries = getEntriesForDate(canvas as any, new Date("2026-02-18T00:00:00Z"));
		expect(entries.map((e: any) => e.file)).toEqual([]);

		// Simulate rebuild/reset applying new index data.
		canvas.plugin.timelineSearchIndex.upsert({
			id: "note.md",
			kind: "file",
			path: "note.md",
			basename: "note",
			directory: "",
			meta: "",
			content: "this contains the needle now"
		});
		canvas.plugin.__timelineSearchIndexVersion++;

		entries = getEntriesForDate(canvas as any, new Date("2026-02-18T00:00:00Z"));
		expect(entries.map((e: any) => e.file)).toEqual(["note.md"]);
	});
});
