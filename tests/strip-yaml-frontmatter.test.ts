import { describe, expect, it } from "vitest";
import { stripYamlFrontmatterBlock } from "../src/utils";

describe("frontmatter body extraction", () => {
	it.each([
		"---\ntags: [one]\n---\nBody",
		"---\ntags: [one]\n...\nBody",
		"\uFEFF---  \r\ntags: [one]\r\n...  \r\nBody",
		"---\n---\nBody"
	])("removes the complete leading YAML block: %j", text => {
		expect(stripYamlFrontmatterBlock(text)).toBe("Body");
	});
	it.each(["---\nkey: value\n---", "---\nkey: value\n...", "---\n---"])("handles YAML-only files: %j", text => {
		expect(stripYamlFrontmatterBlock(text)).toBe("");
	});
	it.each(["Body\n---\nkey: value\n---", "---\nkey: value\n---not-a-delimiter\nBody", "---\nkey: value\n...not-a-delimiter\nBody", "---\nUnclosed"])("leaves non-frontmatter content alone: %j", text => {
		expect(stripYamlFrontmatterBlock(text)).toBe(text);
	});
});
