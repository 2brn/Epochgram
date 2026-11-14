import { describe, it, expect } from "vitest";
import { renderAiContextTemplate } from "../src/plugin/ai-context-templates";
import { buildEpochContext, buildPerCallContext } from "../src/plugin/ai-summaries/contexts";

describe("AI context templates", () => {
	it("renders {{related}} when provided", () => {
		const out = renderAiContextTemplate("File: {{filePath}}\nRelated context:\n{{related}}", {
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

	it("does not append related text unless the YAML template requests it", () => {
		const related = "An unrelated note should not inflate the fallback";
		expect(buildEpochContext("day", "2026-01-04", "2026-01-04", related)).not.toContain(related);
		expect(buildPerCallContext("note.md", { date: "2026-01-04" } as any, related)).not.toContain(related);
	});

	it("does not special-case legacy placeholders at render time", () => {
		const out = renderAiContextTemplate("{{context}} :: {{jobContext}} :: {{filePath}}", {
			filePath: "note.md"
		});
		expect(out).toBe("{{context}} :: {{jobContext}} :: note.md");
	});
});
