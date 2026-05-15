import { describe, expect, it } from "vitest";

import { sanitizeBridgeOptions, validateBridgeOptionsYaml } from "../src/plugin/ai-bridge/sanitize";

describe("AI bridge sanitizeBridgeOptions", () => {
	it("returns default merged config when input is empty", () => {
		const o = sanitizeBridgeOptions(null);
		expect(typeof o.settingsYaml).toBe("string");
	});

	it("accepts numeric tuning fields", () => {
		const checked = validateBridgeOptionsYaml([
			"maxRelatedChars: 678",
			"maxOutputWords: 12",
			"records:",
			"  maxInputChars: 12345",
			"  maxOutputWords: 25",
			"reduce:",
			"  maxDepth: 7",
			"  maxChunkChars: 987",
			"  maxOutputWords: 18",
			"epochs:",
			"  - period: 3month-year",
			"    maxFileChars: 4321",
			"    maxOutputWords: 9"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.maxRelatedChars).toBe(678);
		expect(checked.resolved.maxOutputWords).toBe(12);
		expect(checked.resolved.records?.maxInputChars).toBe(12345);
		expect(checked.resolved.records?.maxOutputWords).toBe(25);
		expect(checked.resolved.reduce?.maxDepth).toBe(7);
		expect(checked.resolved.reduce?.maxChunkChars).toBe(987);
		expect(checked.resolved.reduce?.maxOutputWords).toBe(18);
		expect(checked.resolved.epochs[0]?.maxFileChars).toBe(4321);
		expect(checked.resolved.epochs[0]?.maxOutputWords).toBe(9);
	});

	it("rejects invalid numeric tuning fields", () => {
		const checked = validateBridgeOptionsYaml([
			"maxRelatedChars: nope",
			"maxOutputWords: bad",
			"records:",
			"  maxInputChars: 0",
			"  maxOutputWords: zero",
			"reduce:",
			"  maxDepth:",
			"  maxChunkChars: -2",
			"  maxOutputWords: -1",
			"epochs:",
			"  - period: 3month-year",
			"    maxFileChars: 0",
			"    maxOutputWords: nope"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("root.maxRelatedChars") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("root.maxOutputWords") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("records.maxInputChars") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("records.maxOutputWords") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("reduce.maxDepth cannot be empty"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("reduce.maxChunkChars") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("reduce.maxOutputWords") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("epochs[0].maxFileChars") && e.includes("positive integer"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("epochs[0].maxOutputWords") && e.includes("positive integer"))).toBe(true);
	});

	it("accepts empty maxOutputWords values as unset", () => {
		const checked = validateBridgeOptionsYaml([
			"maxOutputWords:",
			"records:",
			"  maxOutputWords:",
			"reduce:",
			"  maxOutputWords:",
			"epochs:",
			"  - period: day-month",
			"    maxOutputWords:"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.maxOutputWords).toBeUndefined();
		expect(checked.resolved.records?.maxOutputWords).toBeUndefined();
		expect(checked.resolved.reduce?.maxOutputWords).toBeUndefined();
		expect(checked.resolved.epochs[0]?.maxOutputWords).toBeUndefined();
	});

	it("merges valid user YAML with defaults", () => {
		const checked = validateBridgeOptionsYaml([
			"type: key-points",
			"outputLanguage: ja",
			"records:",
			"  context: |",
			"    record context",
			"epochs:",
			"  - period: day-month",
			"    context: |",
			"      epoch context"
		].join("\n"));
		expect(checked.resolved.type).toBe("key-points");
		expect(checked.resolved.outputLanguage).toBe("ja");
		expect(checked.resolved.records?.context).toContain("record context");
		expect(checked.resolved.epochs[0]?.period).toBe("day-month");
	});

	it("rejects overlapping epoch ranges", () => {
		const checked = validateBridgeOptionsYaml([
			"epochs:",
			"  - period: day-month",
			"    context: one",
			"  - period: week-year",
			"    context: two"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("overlaps"))).toBe(true);
	});

	it("normalizes period aliases", () => {
		const checked = validateBridgeOptionsYaml([
			"epochs:",
			"  - period: 6month-year",
			"    context: long period"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.epochs[0]?.period).toBe("6months-year");
	});

	it("auto-format output is generated for valid YAML", () => {
		const checked = validateBridgeOptionsYaml("type: teaser\noutputLanguage: es\n");
		expect(checked.valid).toBe(true);
		expect(checked.formattedUserYaml.length).toBeGreaterThan(0);
		expect(checked.formattedMergedYaml.length).toBeGreaterThan(0);
	});

	it("accepts only supported language codes", () => {
		const checked = validateBridgeOptionsYaml([
			"outputLanguage: ja",
			"expectedInputLanguages: [en, es]",
			"expectedContextLanguages: [ja]"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.outputLanguage).toBe("ja");
		expect(checked.resolved.expectedInputLanguages).toContain("es");
		expect(checked.resolved.expectedContextLanguages).toContain("ja");
	});

	it("rejects non-supported language codes", () => {
		const checked = validateBridgeOptionsYaml([
			"outputLanguage: ua",
			"expectedInputLanguages: [en-US, nope nope]"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("one of: en, ja, es"))).toBe(true);
	});

	it("rejects duplicate language tags", () => {
		const checked = validateBridgeOptionsYaml([
			"expectedInputLanguages: [en, en, es]",
			"expectedContextLanguages: [en-US, en-us]"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("expectedInputLanguages") && e.includes("duplicates"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("expectedContextLanguages") && e.includes("duplicates"))).toBe(true);
	});

	it("rejects bucket placeholder in epoch context", () => {
		const checked = validateBridgeOptionsYaml([
			"epochs:",
			"  - period: day-month",
			"    context: |",
			"      use {{bucket}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("epochs[0].context") && e.includes("{{bucket}}"))).toBe(true);
	});

	it("treats single-brace placeholders as plain text", () => {
		const checked = validateBridgeOptionsYaml([
			"records:",
			"  context: |",
			"    path {filePath}"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.records?.context).toContain("{filePath}");
	});

	it("rejects empty double-brace placeholders", () => {
		const checked = validateBridgeOptionsYaml([
			"epochs:",
			"  - period: day-month",
			"    context: |",
			"      value {{  }}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("epochs[0].context") && e.includes("empty placeholder"))).toBe(true);
	});

	it("shows supported placeholders for reduce context", () => {
		const checked = validateBridgeOptionsYaml([
			"reduce:",
			"  context: |",
			"    value {{some}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("reduce.context") && e.includes("placeholder must be one of") && e.includes("none"))).toBe(true);
	});

	it("rejects unknown placeholders in epoch context", () => {
		const checked = validateBridgeOptionsYaml([
			"epochs:",
			"  - period: day-month",
			"    context: |",
			"      use {{blabla}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("epochs[0].context") && e.includes("placeholder must be one of") && e.includes("{{related}}"))).toBe(true);
	});

	it("rejects unknown placeholders in records context", () => {
		const checked = validateBridgeOptionsYaml([
			"records:",
			"  context: |",
			"    use {{unknown}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("records.context") && e.includes("placeholder must be one of") && e.includes("{{filePath}}"))).toBe(true);
	});

	it("rejects legacy placeholders in records context", () => {
		const checked = validateBridgeOptionsYaml([
			"records:",
			"  context: |",
			"    use {{context}} and {{jobContext}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("records.context") && e.includes("placeholder must be one of") && e.includes("{{filePath}}"))).toBe(true);
	});

	it("rejects job-specific placeholders in wrong context", () => {
		const checked = validateBridgeOptionsYaml([
			"epochs:",
			"  - period: day-month",
			"    context: |",
			"      file: {{filePath}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("epochs[0].context") && e.includes("placeholder must be one of") && e.includes("{{related}}"))).toBe(true);
	});

	it("allows valid placeholders in records and epoch contexts", () => {
		const checked = validateBridgeOptionsYaml([
			"records:",
			"  context: |",
			"    file: {{filePath}}, related: {{related}}",
			"epochs:",
			"  - period: day-month",
			"    context: |",
			"      related: {{related}}"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.records?.context).toContain("{{filePath}}");
		expect(checked.resolved.epochs[0]?.context).toContain("{{related}}");
	});

	it("rejects reduceDepth placeholder in reduce context", () => {
		const checked = validateBridgeOptionsYaml([
			"reduce:",
			"  context: |",
			"    depth: {{reduceDepth}}"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("reduce.context") && e.includes("placeholder must be one of") && e.includes("none"))).toBe(true);
	});

	it("inherits root format and preference when epoch rule does not override", () => {
		const checked = validateBridgeOptionsYaml([
			"format: markdown",
			"preference: capability",
			"epochs:",
			"  - period: day-month",
			"    type: key-points",
			"    length: short"
		].join("\n"));
		expect(checked.valid).toBe(true);
		expect(checked.resolved.format).toBe("markdown");
		expect(checked.resolved.preference).toBe("capability");
		expect(checked.resolved.epochs[0]?.format).toBeUndefined();
		expect(checked.resolved.epochs[0]?.preference).toBeUndefined();
	});

	it("rejects explicitly empty fields like length:", () => {
		const checked = validateBridgeOptionsYaml([
			"length:",
			"epochs:",
			"  - period: day-month",
			"    type: key-points",
			"    length:"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("root.length cannot be empty"))).toBe(true);
		expect(checked.errors.some((e) => e.includes("epochs[0].length cannot be empty"))).toBe(true);
	});

	it("rejects explicitly empty root format field", () => {
		const checked = validateBridgeOptionsYaml([
			"format:",
			"preference: capability"
		].join("\n"));
		expect(checked.valid).toBe(false);
		expect(checked.errors.some((e) => e.includes("root.format cannot be empty"))).toBe(true);
	});
});
