import { describe, expect, it, vi } from "vitest";
import { Indexer } from "../src/indexer/indexer";
import { TFile } from "obsidian";
describe("Frontmatter description applies", () => {
	it.each([
		["note.md", "", "Met on 2026-03-05 for lunch", "2026-03-05", "content"],
		["note.md", "date: 2026-03-14\n", "", "2026-03-14", "dateprop"],
		["note.md", "date: 2026-03-14\n", "Body", "2026-03-14", "dateprop"],
		["note.md", "due: 2026-03-05\n", "Body", "2026-03-05", "content"],
		["note.md", "repeat: every day from 2026-03-01 count 2\n", "Body", "2026-03-02", "content"],
		["2026-03-10 2026-03-11.md", "", "Body", "2026-03-11", "namedate"]
	])("overrides extracted summary for %s %s %s", async (name, properties, body, date, source) => {
		const content = `---\ndescription: Desc wins\n${properties}---\n${body}`;
		const file = new (TFile as any)(`folder/${name}`, { basename: name.replace(/\.md$/, ""), extension: "md", stat: { ctime: Date.UTC(2026, 2, 1), mtime: Date.UTC(2026, 2, 1), size: content.length } });
		const plugin: any = { settings: { summaryWordsCount: 8, parseDatesInFrontmatter: true }, app: { vault: { read: vi.fn(async () => content), getAbstractFileByPath: () => file }, metadataCache: { getFileCache: () => ({ frontmatter: { description: "Desc wins" }, tags: [] }) }, workspace: { getActiveViewOfType: vi.fn() } } };
		const indexer = new Indexer(plugin);
		await indexer.processFile(file, { reason: "modify" });
		expect(indexer.index[date]?.find(entry => entry.file === file.path && entry.source === source)?.summary).toBe("Desc wins");
	});
});
