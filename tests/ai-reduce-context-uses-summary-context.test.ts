import { describe, expect, it } from "vitest";

import { buildPerCallContext, buildReduceContext } from "../src/plugin/ai-summaries/contexts";

describe("AI reduce context", () => {
	it("uses the same Summary context template for reduce jobs", () => {
		const filePath = "Notes/A.md";
		const entry: any = { date: "2026-02-26" };
		const related = "Related";

		const perCall = buildPerCallContext(filePath, entry, related);
		const reduce = buildReduceContext(filePath, entry, 1, related);

		// Reduce should no longer use a separate reduce template; it should match the
		// normal summary template output.
		expect(reduce).toBe(perCall);
		expect(reduce).toContain(filePath);
		expect(reduce).toContain("Related context:");
		expect(reduce).toContain(related);
	});
});
