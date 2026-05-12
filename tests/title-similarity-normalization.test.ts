import { describe, expect, it } from "vitest";
import { normalizeTitleForSimilarity } from "../src/utils";

describe("normalizeTitleForSimilarity", () => {
	it("removes ISO-style yyyy-mm-dd dates", () => {
		expect(normalizeTitleForSimilarity("2025-12-31 Meeting Notes")).toBe("meeting notes");
		expect(normalizeTitleForSimilarity("Meeting Notes 2025-12-31")).toBe("meeting notes");
	});

	it("removes dd-mm-yyyy style dates", () => {
		expect(normalizeTitleForSimilarity("31-12-2025 Meeting Notes")).toBe("meeting notes");
	});

	it("removes compact yyyymmdd dates", () => {
		expect(normalizeTitleForSimilarity("20251231 Meeting Notes")).toBe("meeting notes");
	});

	it("keeps non-date numbers", () => {
		expect(normalizeTitleForSimilarity("Project 2025 Roadmap")).toBe("project 2025 roadmap");
	});
});
