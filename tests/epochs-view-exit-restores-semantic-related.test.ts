import { describe, expect, test, vi } from "vitest";

import { setEpochsView } from "../src/ui/epoch-canvas/epochs-view";

describe("epochs view exit restores semantic related", () => {
	test("preserves semanticRelatedPaths/scored across epochs view toggle", () => {
		const draw = vi.fn();
		const clearHover = vi.fn();
		const cancelFocusClear = vi.fn();

		const semanticRelatedScored = [{ path: "b.md", score: 0.9 }];
		const semanticRelatedPaths = new Set<string>(["b.md"]);

		const canvas: any = {
			plugin: { settings: { generateEpochs: true } },
			activeFilePath: "a.md",
			epochsView: false,
			semanticRelatedScored,
			semanticRelatedPaths,
			semanticRelatedRequestId: 0,
			cancelFocusClear,
			clearHover,
			draw
		};

		setEpochsView(canvas, true);
		expect(canvas.epochsView).toBe(true);
		expect(canvas.semanticRelatedScored).toBeNull();
		expect(canvas.semanticRelatedPaths).toBeNull();

		setEpochsView(canvas, false);
		expect(canvas.epochsView).toBe(false);
		expect(canvas.semanticRelatedScored).toEqual(semanticRelatedScored);
		expect(canvas.semanticRelatedPaths instanceof Set).toBe(true);
		expect(canvas.semanticRelatedPaths.has("b.md")).toBe(true);
	});
});
