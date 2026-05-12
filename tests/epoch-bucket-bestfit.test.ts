import { describe, expect, test } from "vitest";
import { BASE_SPACING, pickEpochBucketForViewport } from "../src/ui/epoch-canvas-constants";

describe("pickEpochBucketForViewport", () => {
	test("prefers most detailed bucket when it fits", () => {
		const scale = 1;
		const viewportHeight = BASE_SPACING * 10;
		expect(pickEpochBucketForViewport(scale, viewportHeight)).toBe("day");
	});

	test("chooses 2days when day-level would exceed the block cap", () => {
		const scale = 1;
		const viewportHeight = BASE_SPACING * 20;
		expect(pickEpochBucketForViewport(scale, viewportHeight)).toBe("2days");
	});

	test("chooses a coarser bucket when too many blocks would be visible", () => {
		const scale = 1;
		const viewportHeight = BASE_SPACING * 200;
		const bucket = pickEpochBucketForViewport(scale, viewportHeight);
		// At this viewport size, "day" would produce too many visible blocks.
		expect(bucket).not.toBe("day");
	});

	test("falls back safely for invalid inputs", () => {
		expect(pickEpochBucketForViewport(NaN, 1000)).toBeTruthy();
		expect(pickEpochBucketForViewport(1, NaN)).toBeTruthy();
	});
});
