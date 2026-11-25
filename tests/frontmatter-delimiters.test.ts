import { describe, expect, it } from "vitest";
import { readYamlPropertyFromText } from "../src/plugin/note-frontmatter";
import { resolveFrontmatterSuppressionFlags } from "../src/indexer/frontmatter-flags";
import { extractFrontmatterDescription } from "../src/indexer/summarizer";
import { makeReviewPlugin } from "./helpers/review-plugin";

describe.each(["---", "...", "...  "])("consistent frontmatter closing delimiter %s", closing => {
	it("reads pin, mark, manual summary, and suppression flags without metadata-cache help", () => {
		const raw = `---\npin: dock\nmark: '#c14d58'\ndescription: Manual summary\nnodates: true\nnoindex: true\n${closing}\nBody`;
		expect(readYamlPropertyFromText(raw, "pin")).toBe("dock");
		expect(readYamlPropertyFromText(raw, "mark")).toBe("#c14d58");
		expect(readYamlPropertyFromText(raw, "description")).toBe("Manual summary");
		expect(extractFrontmatterDescription(raw, "description")).toBe("Manual summary");
		expect(resolveFrontmatterSuppressionFlags({}, "note.md", raw)).toEqual({ noparsed: true, noindex: true });
	});
	it("does not end frontmatter at an indented delimiter in a block scalar", () => {
		const raw = `---\ndescription: |\n  Intro\n  ---\n  After\n  ...\n  End\npin: dock\n${closing}\nBody`;
		expect(extractFrontmatterDescription(raw, "description")).toBe("Intro\n---\nAfter\n...\nEnd");
		expect(readYamlPropertyFromText(raw, "pin")).toBe("dock");
	});
	it("indexes properties consistently and noindex removes the record", async () => {
		const p = await makeReviewPlugin({ "note.md": `---\npin: dock\nmark: '#c14d58'\ndescription: Manual summary\n${closing}\nBody` });
		const data = p.indexer.getFileIndexData("note.md");
		expect(data.pinnedFile).toBe("dock");
		expect(data.markColorHex).toBe("#c14d58");
		expect(data.cdate.summary).toBe("Manual summary");
		p.contents["note.md"] = `---\nnoindex: true\n${closing}\nBody`;
		await p.indexer.processFile(p.files[0], { reason: "modify" });
		expect(p.indexer.isFileKnown("note.md")).toBe(false);
	});
});
