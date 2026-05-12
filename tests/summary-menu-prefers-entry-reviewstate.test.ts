import { describe, expect, it, vi } from "vitest";

let capturedReviewState: any = null;

vi.mock("../src/ui/menus/menu-state", () => {
	return {
		getMenuState: () => {
			return {
				keepHoverAfterMenu: false,
				clearHover() {},
				hasProAccess: () => true,
				refreshIndex() {},
				plugin: {
					indexer: {
						getFileMarkColor: () => null,
						isFilePinned: () => false
					}
				}
			};
		}
	};
});

vi.mock("../src/ui/menus/summary-menu/epoch-menu", () => ({
	addEpochMenuIfApplicable: () => false
}));

vi.mock("../src/ui/menus/summary-menu/mark-submenu", () => ({
	addMarkSubmenu: () => {}
}));

vi.mock("../src/ui/menus/summary-menu/topic-menu", () => ({
	addEditTopic: () => {}
}));

vi.mock("../src/ui/epoch-canvas-helpers", () => ({
	getEntryTitle: () => ""
}));

vi.mock("../src/ui/menus/summary-menu/entry-actions", async (importOriginal) => {
	const actual: any = await importOriginal();
	return {
		...actual,
		addOpenFile: () => {},
		addSummarizeAi: () => {},
		addEditSummary: () => {},
		addFileRenameMove: () => {},
		addDelete: () => {},
		addPinToggle: () => {},
		addReviewSubmenu: (_menu: any, _state: any, _entry: any, reviewState: any) => {
			capturedReviewState = reviewState;
		}
	};
});

import { showSummaryMenu } from "../src/ui/menus/summary-menu";

describe("Summary menu review state selection", () => {
	it("prefers entry.reviewState when entry is Hidden", () => {
		capturedReviewState = null;

		const canvas: any = {};
		const entry: any = { file: "Folder\\note.md", reviewState: "hidden" };

		showSummaryMenu(canvas, entry, 10, 10);

		expect(capturedReviewState).toBe("hidden");
	});
});
