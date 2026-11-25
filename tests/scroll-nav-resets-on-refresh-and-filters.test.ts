import { describe, expect, test, vi } from "vitest";

vi.mock("../src/ui/epoch-canvas/related", () => ({ refreshRelatedForActiveFile: vi.fn() }));

import { refreshIndex } from "../src/ui/epoch-canvas/index-refresh";
import { setShowAttachments, setShowContentDates } from "../src/ui/epoch-canvas/filters";

describe("scroll-nav resets on index refresh and view changes", () => {
	test("refreshIndex clears scroll-nav target + anchor", () => {
		const draw = vi.fn();
		const canvas: any = {
			plugin: { indexer: { index: { "2026-03-10": [{ file: "a.md" }] } } },
			index: {},
			activeFilePath: "a.md",
			scrollNavFile: "a.md",
			scrollNavIndex: 7,
			scrollNavAnchorEntry: { file: "a.md" },
			scrollNavAnchorDayIndex: 5,
			pendingScrollNavHighlight: { dayIndex: 1, entry: { file: "a.md" }, date: new Date(), attempts: 0, startedAt: 0 },
			__scrollNavLastModeKey: "entry",
			draw
		};

		refreshIndex(canvas);

		expect(canvas.scrollNavIndex).toBe(-1);
		expect(canvas.scrollNavFile).toBe(null);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(canvas.scrollNavAnchorDayIndex).toBe(null);
		expect(canvas.pendingScrollNavHighlight).toBe(null);
		expect(canvas.__scrollNavLastModeKey).toBe(null);
		expect(draw).toHaveBeenCalledTimes(1);
	});

	test("changing filters clears scroll-nav target + anchor", () => {
		const draw = vi.fn();
		const clearHover = vi.fn();
		const classListToggle = vi.fn();
		const canvas: any = {
			showContentDates: true,
			root: { classList: { toggle: classListToggle } },
			scrollNavFile: "a.md",
			scrollNavIndex: 7,
			scrollNavAnchorEntry: { file: "a.md" },
			scrollNavAnchorDayIndex: 5,
			pendingScrollNavHighlight: { dayIndex: 1, entry: { file: "a.md" }, date: new Date(), attempts: 0, startedAt: 0 },
			__scrollNavLastModeKey: "entry",
			clearHover,
			draw
		};

		setShowContentDates(canvas, false);

		expect(canvas.showContentDates).toBe(false);
		expect(canvas.scrollNavIndex).toBe(-1);
		expect(canvas.scrollNavFile).toBe(null);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(canvas.scrollNavAnchorDayIndex).toBe(null);
		expect(canvas.pendingScrollNavHighlight).toBe(null);
		expect(canvas.__scrollNavLastModeKey).toBe(null);
		expect(clearHover).toHaveBeenCalledTimes(1);
		expect(draw).toHaveBeenCalledTimes(1);
	});

	test("enabling attachments forces related refresh", () => {
		const draw = vi.fn();
		const clearHover = vi.fn();
		const classListToggle = vi.fn();
		const refreshRelatedForActiveFile = vi.fn();
		const canvas: any = {
			showAttachments: false,
			root: { classList: { toggle: classListToggle } },
			scrollNavFile: "a.md",
			scrollNavIndex: 7,
			scrollNavAnchorEntry: { file: "a.md" },
			scrollNavAnchorDayIndex: 5,
			pendingScrollNavHighlight: { dayIndex: 1, entry: { file: "a.md" }, date: new Date(), attempts: 0, startedAt: 0 },
			__scrollNavLastModeKey: "entry",
			refreshRelatedForActiveFile,
			clearHover,
			draw
		};

		setShowAttachments(canvas, true);

		expect(canvas.showAttachments).toBe(true);
		expect(canvas.scrollNavIndex).toBe(-1);
		expect(canvas.scrollNavFile).toBe(null);
		expect(canvas.scrollNavAnchorEntry).toBe(null);
		expect(canvas.scrollNavAnchorDayIndex).toBe(null);
		expect(canvas.pendingScrollNavHighlight).toBe(null);
		expect(canvas.__scrollNavLastModeKey).toBe(null);
		expect(refreshRelatedForActiveFile).toHaveBeenCalledTimes(1);
		expect(refreshRelatedForActiveFile).toHaveBeenCalledWith(true);
		expect(clearHover).toHaveBeenCalledTimes(1);
		expect(draw).toHaveBeenCalledTimes(1);
	});
});
