import { describe, expect, it } from "vitest";

import { getEpochsViewMarkedChildVisibilityByDateKey } from "../src/ui/entry-helpers";
import { getEpochsViewChildVisibilityByDateKey } from "../src/ui/entry-helpers/epochs-view";
import { buildEpochRows } from "../src/ui/summary-rendering/epochs/rows";

function mockCtx(): CanvasRenderingContext2D {
	return {
		font: "12px system-ui",
		save: () => {},
		restore: () => {},
		measureText: (value: string) =>
			({
				width: value.length,
				actualBoundingBoxAscent: 10,
				actualBoundingBoxDescent: 2
			} as any)
	} as any;
}

function makeCanvas(overrides: any = {}) {
	const base = {
		index: {},
		__indexVersion: 1,
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: true,
		searchQuery: "",
		plugin: {}
	};
	return Object.assign(base, overrides);
}

describe("Epoch coloring respects active filters", () => {
	it("recomputes epochs-view child visibility when the index changes", () => {
		const dateKey = "2026-02-03";
		const epochPath = `epoch://day/${dateKey}-${dateKey}`;
		const canvas = makeCanvas({
			index: {
				[dateKey]: [
					{ date: dateKey, file: epochPath, blockStart: 0, blockEnd: 0, summary: "Epoch", source: "epoch" }
				]
			}
		});

		const vis1 = getEpochsViewChildVisibilityByDateKey(canvas as any);
		expect(vis1.get(dateKey)).toBe(false);

		(canvas as any).index = {
			[dateKey]: [
				{ date: dateKey, file: epochPath, blockStart: 0, blockEnd: 0, summary: "Epoch", source: "epoch" },
				{ date: dateKey, file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "dateprop" }
			]
		};
		(canvas as any).__indexVersion++;
		const vis2 = getEpochsViewChildVisibilityByDateKey(canvas as any);
		expect(vis2.get(dateKey)).toBe(true);
	});

	it("recomputes epochs-view marked-child visibility when the index changes", () => {
		const dateKey = "2026-02-03";
		const canvas = makeCanvas({
			index: {
				[dateKey]: [
					{ date: dateKey, file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const vis1 = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis1.get(dateKey)).toBe(false);

		(canvas as any).index = {
			[dateKey]: [
				{ date: dateKey, file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content", markColor: 1 }
			]
		};
		(canvas as any).__indexVersion++;
		const vis2 = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis2.get(dateKey)).toBe(true);
	});

	it("does not consider marked tracked changes when tracked changes are hidden", () => {
		const dateKey = "2026-02-03";
		const canvas = makeCanvas({
			showTrackedChanges: false,
			index: {
				[dateKey]: [
					{ date: dateKey, file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "tracked", markColor: 1 }
				]
			}
		});

		const vis = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis.get(dateKey)).toBe(false);

		(canvas as any).showTrackedChanges = true;
		const vis2 = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis2.get(dateKey)).toBe(true);
	});

	it("does not consider synthetic pinned-today clones as visible marked children", () => {
		const todayKey = "2026-02-26";
		const canvas = makeCanvas({
			index: {
				[todayKey]: [
					{
						date: todayKey,
						originalDate: "2026-02-01",
						pinned: true,
						file: "A.md",
						blockStart: 0,
						blockEnd: 0,
						summary: "Pinned today clone",
						source: "content",
						markColor: 1
					}
				]
			}
		});

		const vis = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis.get(todayKey)).toBe(false);
	});

	it("recomputes marked-child visibility when inherited marks change", () => {
		const dateKey = "2026-02-03";
		const plugin: any = {
			__epochInheritedMarkIndexByPath: new Map<string, number>(),
			__epochInheritedMarkComputedAt: 0
		};
		const canvas = makeCanvas({
			plugin,
			index: {
				[dateKey]: [
					{ date: dateKey, file: "A.md", blockStart: 0, blockEnd: 0, summary: "", source: "content" }
				]
			}
		});

		const vis1 = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis1.get(dateKey)).toBe(false);

		plugin.__epochInheritedMarkIndexByPath = new Map<string, number>([["A.md", 1]]);
		plugin.__epochInheritedMarkComputedAt = 1;
		const vis2 = getEpochsViewMarkedChildVisibilityByDateKey(canvas as any);
		expect(vis2.get(dateKey)).toBe(true);
	});

	it("suppresses epoch inherited mark color when no marked children are visible", () => {
		const ctx = mockCtx();
		const dateKey = "2026-02-03";
		const epochPath = `epoch://day/${dateKey}-${dateKey}`;
		const inherited = new Map<string, number>([[epochPath, 1]]);
		const markColors = ["#ff0000"];

		const entry: any = {
			date: dateKey,
			file: epochPath,
			blockStart: 0,
			blockEnd: 0,
			summary: "Epoch",
			source: "epoch",
			epochBucket: "day",
			epochStart: dateKey,
			epochEnd: dateKey
		};

		const noneMarkedVisible = new Map<string, boolean>([[dateKey, false]]);
		const anyMarkedVisible = new Map<string, boolean>([[dateKey, true]]);

		const baseArgs: any = {
			ctx,
			entries: [entry],
			dayIndex: 0,
			xStart: 0,
			rightWidth: 1000,
			rowHeight: 16,
			hoverAnim: 0,
			hoverGap: 0,
			animSummary: null,
			outgoingSummaries: null,
			activeFilePath: null,
			showHidden: true,
			fontSmall: "12px system-ui",
			fontSmallHover: "12px system-ui",
			colTextBase: "#111111",
			colTextHover: "#111111",
			colHighlight: "#222222",
			colRelated: "#333333",
			markColors,
			inheritedMarkIndexByPath: inherited,
			disableDropCaps: true
		};

		const r1 = buildEpochRows({
			...baseArgs,
			epochsViewMarkedChildVisibleByDateKey: noneMarkedVisible
		});
		expect(r1.rows.length).toBe(1);
		expect(r1.rows[0]!.color).toBe("#111111");

		const r2 = buildEpochRows({
			...baseArgs,
			epochsViewMarkedChildVisibleByDateKey: anyMarkedVisible
		});
		expect(r2.rows.length).toBe(1);
		expect(r2.rows[0]!.color).toBe("#ff0000");
	});
});
