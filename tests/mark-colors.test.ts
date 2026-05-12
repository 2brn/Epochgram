import { describe, expect, it } from "vitest";
import type { MarkColorIndex } from "../src/ui/mark-colors";
import { getEpochMarkBaseColorIndexOrder, getUsedMarkColorIndexSet, markColorOrderPreferUnused, MAX_MARK_COLORS, pickDefaultMarkColorIndex, pickUniqueMarkColorIndex, pickUnusedMarkColorIndexOrNull } from "../src/ui/mark-colors";

describe("mark-colors helpers", () => {
	it("picks an unused mark color first", () => {
		const filesObj = {
			"a.md": { markColor: 1 },
			"b.md": { markColor: 2 },
			"c.md": { markColor: 1 }
		};
		const used = getUsedMarkColorIndexSet(filesObj, "x.md");
		expect(pickUniqueMarkColorIndex(used, null)).toBe(3);
		expect(pickUnusedMarkColorIndexOrNull(used, null)).toBe(3);
	});

	it("returns null when all colors are used", () => {
		const used = new Set<MarkColorIndex>();
		for (let c = 1; c <= MAX_MARK_COLORS; c++) used.add(c);
		expect(pickUnusedMarkColorIndexOrNull(used, null)).toBe(null);
	});

	it("orders colors with unused first", () => {
		const used = new Set<MarkColorIndex>([1, 4]);
		const order = markColorOrderPreferUnused(null, used);
		expect(order[0]).toBe(1);
		expect(order[1]).toBe(2);
		expect(order[2]).toBe(3);
		expect(order[order.length - 1]).toBe(MAX_MARK_COLORS);
	});

	it("prefers unused base group colors for default pick", () => {
		const base = getEpochMarkBaseColorIndexOrder();
		expect(base.length).toBeGreaterThan(0);
		const used = new Set<MarkColorIndex>([base[0]]);
		const picked = pickDefaultMarkColorIndex(used, null);
		expect(picked).toBe(base[1]);
	});
});
