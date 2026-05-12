import { describe, expect, it, vi } from "vitest";

let capturedOptions: any = null;

vi.mock("../src/ui/modals/timeline-search-modal", () => {
	class TimelineSearchModal {
		constructor(_app: any, options: any) {
			capturedOptions = options;
		}
		open() {
			// no-op
		}
	}
	return { TimelineSearchModal };
});

import { EpochView } from "../src/ui/epoch-view";

describe("timeline search suggestions in Epochs view", () => {
	it("restricts suggestions to the current epoch bucket", () => {
		capturedOptions = null;

		const monthEntry: any = {
			date: "2026-01-01",
			file: "epoch://month/2026-01-01-2026-01-31",
			blockStart: 0,
			blockEnd: 0,
			summary: "foo month",
			source: "epoch",
			epochBucket: "month",
			epochStart: "2026-01-01",
			epochEnd: "2026-01-31"
		};
		const yearEntry: any = {
			date: "2026-01-01",
			file: "epoch://year/2026-01-01-2026-12-31",
			blockStart: 0,
			blockEnd: 0,
			summary: "foo year",
			source: "epoch",
			epochBucket: "year",
			epochStart: "2026-01-01",
			epochEnd: "2026-12-31"
		};

		const canvas: any = {
			index: {
				"2026-01-01": [monthEntry, yearEntry]
			},
			epochsView: true,
			epochsViewBucket: "month",
			__indexVersion: 1,
			suppressNextFocusScrollForPath: vi.fn(),
			clearHover: vi.fn(),
			draw: vi.fn()
		};

		const view: any = {
			app: {},
			plugin: {
				app: {
					workspace: {
						getActiveFile: () => null
					}
				}
			},
			canvas,
			searchQuery: "",
			searchModalOpen: false,
			updateSearchControl: vi.fn()
		};

		(EpochView as any).prototype.openSearchModal.call(view);

		expect(capturedOptions).toBeTruthy();
		const getTopMatches = capturedOptions.getTopMatches as (q: string, max: number) => any[];
		expect(typeof getTopMatches).toBe("function");

		const out = getTopMatches("foo", 10);
		expect(out.length).toBe(1);
		expect(out[0]?.entry?.epochBucket).toBe("month");
		expect(out[0]?.label).toBe("2026-01-01 - 2026-01-31 ⸱ foo month");
	});

	it("includes normal-view matches as well", () => {
		capturedOptions = null;

		const monthEntry: any = {
			date: "2026-01-01",
			file: "epoch://month/2026-01-01-2026-01-31",
			blockStart: 0,
			blockEnd: 0,
			summary: "foo month",
			source: "epoch",
			epochBucket: "month",
			epochStart: "2026-01-01",
			epochEnd: "2026-01-31"
		};
		const normalEntry: any = {
			date: "2026-01-01",
			file: "Note.md",
			blockStart: 10,
			blockEnd: 10,
			summary: "Note summary",
			source: "content"
		};

		const plugin: any = {
			settings: { showNoteNameInSummaryRows: false },
			app: {
				workspace: {
					getActiveFile: () => null
				}
			},
			timelineSearchIndex: {
				searchFileIdsRanked: vi.fn(() => ["Note.md"])
			}
		};

		const canvas: any = {
			index: {
				"2026-01-01": [monthEntry, normalEntry]
			},
			showAttachments: true,
			showTrackedChanges: true,
			showHidden: true,
			showDraftOnly: false,
			showContentDates: true,
			showPropDates: true,
			epochsView: true,
			epochsViewBucket: "month",
			__indexVersion: 1,
			plugin,
			suppressNextFocusScrollForPath: vi.fn(),
			clearHover: vi.fn(),
			draw: vi.fn()
		};

		const view: any = {
			app: {},
			plugin,
			canvas,
			searchQuery: "",
			searchModalOpen: false,
			updateSearchControl: vi.fn()
		};

		(EpochView as any).prototype.openSearchModal.call(view);

		expect(capturedOptions).toBeTruthy();
		const getTopMatches = capturedOptions.getTopMatches as (q: string, max: number) => any[];
		const out = getTopMatches("Note", 10);

		// Normal record match plus the current-bucket epoch entry.
		expect(out.some((m: any) => m?.entry?.file === "Note.md")).toBe(true);
		expect(out.some((m: any) => m?.entry?.file?.startsWith?.("epoch://"))).toBe(true);
	});
});
