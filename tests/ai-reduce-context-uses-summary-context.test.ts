import { describe, expect, it } from "vitest";

import { buildIntermediateReduceContext, buildPerCallContext, buildReduceContext } from "../src/plugin/ai-summaries/contexts";
import { validateBridgeOptionsYaml } from "../src/plugin/ai-bridge/sanitize";

describe("AI reduce context", () => {
	it("uses the record YAML context for final reduce jobs", () => {
		const filePath = "Notes/A.md";
		const entry: any = { date: "2026-02-26" };
		const related = "Related";

		const perCall = buildPerCallContext(filePath, entry, related);
		const reduce = buildReduceContext(filePath, entry, 1, related);

		// Final ungrouped reductions return to the record output contract.
		expect(reduce).toBe(perCall);
		expect(reduce).toContain(filePath);
		expect(reduce).not.toContain(related);
	});

	it("uses the reduction YAML context for intermediate chunks", () => {
		const defaults = validateBridgeOptionsYaml("").resolved;
		expect(buildIntermediateReduceContext()).toBe(defaults.reduce?.context?.trim());
	});
});
