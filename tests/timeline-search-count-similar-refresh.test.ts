import { describe, expect, it } from "vitest";

import { computeTimelineSearchResultCountAllDates } from "../src/ui/epoch-view/search-count";

describe("timeline search count cache", () => {
	it("recomputes !similar count when active file changes", () => {
		const cache = { key: null as string | null, value: null as number | null };
		const canvas: any = {
			index: {
				"2026-01-04": [
					{ date: "2026-01-04", file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "B.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" },
					{ date: "2026-01-04", file: "C.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			},
			searchQuery: "!similar",
			showAttachments: true,
			showTrackedChanges: true,
			showHidden: false,
			showDraftOnly: false,
			showContentDates: true,
			showPropDates: false,
			epochsView: false,
			activeFilePath: "A.md",
			semanticRelatedPaths: new Set(["A.md", "B.md"]),
			semanticRelatedTermPaths: new Set<string>(),
			semanticRelatedRequestId: 1
		};

		const countBefore = computeTimelineSearchResultCountAllDates(canvas, "!similar", cache);
		expect(countBefore).toBe(2);

		canvas.activeFilePath = "C.md";
		canvas.semanticRelatedPaths = new Set(["C.md"]);
		canvas.semanticRelatedRequestId = 2;

		const countAfter = computeTimelineSearchResultCountAllDates(canvas, "!similar", cache);
		expect(countAfter).toBe(1);
	});
});
