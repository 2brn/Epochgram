import { describe, expect, test, vi } from "vitest";

import { indexingMethods } from "../src/plugin/indexing";

describe("inherited marks", () => {
	test("schedules inherited mark recompute after index load", async () => {
		const scheduleInheritedMarkRecompute = vi.fn();
		const plugin: any = {
			indexReady: true,
			indexLoadPromise: null,
			hasProAccess: () => true,
			scheduleInheritedMarkRecompute,
			__epochInheritedMarkIndexByPath: null,
			__epochInheritedMarkComputedAt: 0
		};

		await indexingMethods.ensureIndexLoaded.call(plugin);
		expect(scheduleInheritedMarkRecompute).toHaveBeenCalledTimes(1);
		expect(scheduleInheritedMarkRecompute).toHaveBeenCalledWith("startup");

		await indexingMethods.ensureIndexLoaded.call(plugin);
		expect(scheduleInheritedMarkRecompute).toHaveBeenCalledTimes(1);
	});
});
