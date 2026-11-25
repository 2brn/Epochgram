import { describe, expect, it } from "vitest";

import { matchesSearch } from "../src/ui/entry-helpers/search";

describe("current-file search tokens", () => {
	it.each(["$current", "$same", "!same"])("%s limits matches to the active file when one is open", (token) => {
		const canvas: any = {
			searchQuery: `alpha ${token}`,
			activeFilePath: "notes/a.md",
			plugin: {}
		};

		expect(matchesSearch(canvas, { file: "notes/a.md", summary: "alpha" } as any)).toBe(true);
		expect(matchesSearch(canvas, { file: "notes/b.md", summary: "alpha" } as any)).toBe(false);
	});

	it.each(["$current", "$same", "!same"])("%s falls back to normal matching when no active file is open", (token) => {
		const canvas: any = {
			searchQuery: `alpha ${token}`,
			plugin: {}
		};

		expect(matchesSearch(canvas, { file: "notes/b.md", summary: "alpha" } as any)).toBe(true);
	});
});