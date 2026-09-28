import { describe, expect, it, vi } from "vitest";
import { triggerMissingFileRebuild } from "../src/ui/epoch-canvas-actions";

describe("missing-file rebuild", () => {
	it("performs at most one automatic rebuild per canvas", async () => {
		const refreshIndexSmartWithProgress = vi.fn(async () => {});
		const refreshIndex = vi.fn();
		const canvas: any = {
			missingFileRebuildPending: false,
			missingFileRebuildAttempted: false,
			plugin: { refreshIndexSmartWithProgress },
			refreshIndex
		};

		await triggerMissingFileRebuild(canvas);
		await triggerMissingFileRebuild(canvas);

		expect(refreshIndexSmartWithProgress).toHaveBeenCalledTimes(1);
		expect(refreshIndexSmartWithProgress).toHaveBeenCalledWith({ suppressNotices: true });
		expect(refreshIndex).toHaveBeenCalledTimes(1);
	});
});
