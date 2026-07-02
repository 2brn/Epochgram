import { describe, expect, it, vi } from "vitest";

vi.mock("utils", () => ({
	canonicalizeTopicTerm: (value: string) => String(value || ""),
	isNoTopicSentinel: () => false,
	normalizeIsoDatePrefix: (value: string) => String(value || ""),
	parseTopicTerm: (value: string) => ({ operator: null, term: String(value || "") })
}));

vi.mock("../src/ui/epoch-canvas-utils", () => ({
	getEpochRangeFromEntry: () => null
}));

vi.mock("../src/plugin/pro-feature-state", () => ({
	getEffectiveZeroShotMinScore: () => 0,
	isSummarizeAIEffective: () => false
}));

vi.mock("../src/plugin/similarity/config", () => ({
	isTopicSimilarityEnabled: () => false
}));

import { matchesSearch } from "../src/ui/entry-helpers/search";

describe("$current search token", () => {
	it("limits matches to the active file when one is open", () => {
		const canvas: any = {
			searchQuery: "alpha $current",
			activeFilePath: "notes/a.md",
			plugin: {}
		};

		expect(matchesSearch(canvas, { file: "notes/a.md", summary: "alpha" } as any)).toBe(true);
		expect(matchesSearch(canvas, { file: "notes/b.md", summary: "alpha" } as any)).toBe(false);
	});

	it("falls back to normal matching when no active file is open", () => {
		const canvas: any = {
			searchQuery: "alpha $current",
			plugin: {}
		};

		expect(matchesSearch(canvas, { file: "notes/b.md", summary: "alpha" } as any)).toBe(true);
	});
});