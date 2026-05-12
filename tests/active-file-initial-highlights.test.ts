import { describe, expect, it, vi } from "vitest";

vi.mock("../src/ui/epoch-canvas/semantic", () => {
	return {
		refreshSemanticRelatedForActiveFile: vi.fn()
	};
});

import { refreshSemanticRelatedForActiveFile } from "../src/ui/epoch-canvas/semantic";
import { setActiveFile } from "../src/ui/epoch-canvas/active-file";
import { Platform } from "obsidian";

describe("setActiveFile initial semantic refresh", () => {
	it("refreshes semantic highlights when path is unchanged", () => {
		const canvas: any = {
			activeFilePath: "A.md",
			root: { matches: () => false },
			suppressNextFocusScroll: null,
			suppressNextFocusHover: null,
			forceNextFocusHover: null,
			focusFile: () => false
		};

		setActiveFile(canvas, "A.md", null, { suppressFocus: true });

		expect(refreshSemanticRelatedForActiveFile).toHaveBeenCalledTimes(1);
		expect(refreshSemanticRelatedForActiveFile).toHaveBeenCalledWith(canvas, false);
	});

	it("preserves pending focus when path is unchanged", () => {
		const canvas: any = {
			activeFilePath: "A.md",
			pendingActiveFileFocus: { path: "A.md", line: 12 },
			root: { matches: () => false },
			suppressNextFocusScroll: null,
			suppressNextFocusHover: null,
			forceNextFocusHover: null,
			focusFile: () => false
		};

		setActiveFile(canvas, "A.md", 12, { suppressFocus: true });

		expect(canvas.pendingActiveFileFocus).toEqual({ path: "A.md", line: 12 });
	});

	it("uses immediate snap on mobile when opening a different file", () => {
		const originalMobile = Platform.isMobileApp;
		const snapInitialPosition = vi.fn();
		const focusFile = vi.fn(() => true);
		try {
			Platform.isMobileApp = true;
			const canvas: any = {
				activeFilePath: "A.md",
				pendingActiveFileFocus: { path: "A.md", line: 1 },
				root: { matches: () => false },
				suppressNextFocusScroll: null,
				suppressNextFocusHover: null,
				forceNextFocusHover: null,
				snapInitialPosition,
				focusFile
			};

			setActiveFile(canvas, "B.md", 7, { suppressFocus: false });

			expect(snapInitialPosition).toHaveBeenCalledTimes(1);
			expect(snapInitialPosition).toHaveBeenCalledWith("B.md", 7, { draw: true });
			expect(focusFile).not.toHaveBeenCalled();
			expect(canvas.pendingActiveFileFocus).toBeNull();
		} finally {
			Platform.isMobileApp = originalMobile;
		}
	});
});
