import { describe, it, expect } from "vitest";
import { DEFAULT_EPOCH_CONTEXT_TEMPLATE, DEFAULT_SUMMARY_CONTEXT_TEMPLATE, renderAiContextTemplate } from "../src/plugin/ai-context-templates";
import { buildPerCallContext } from "../src/plugin/ai-summaries/contexts";

describe("AI context templates", () => {
	it("renders {{related}} when provided", () => {
		const out = renderAiContextTemplate(DEFAULT_SUMMARY_CONTEXT_TEMPLATE, {
			filePath: "note.md",
			date: "2026-01-04",
			related: "- Other note: some summary"
		});
		expect(out.includes("Other note")).toBe(true);
		expect(out.includes("{{related}}")).toBe(false);
		expect(out.includes("note.md")).toBe(true);
		expect(out.includes("Related context:")).toBe(true);
	});

	it("buildPerCallContext does not leak literal {{related}}", () => {
		const entry: any = { date: "2026-01-04" };
		const out = buildPerCallContext("note.md", entry);
		expect(out.includes("{{related}}")).toBe(false);
	});

	it("default epoch context includes Related context", () => {
		expect(DEFAULT_EPOCH_CONTEXT_TEMPLATE.includes("Related context:"))
			.toBe(true);
	});
});
