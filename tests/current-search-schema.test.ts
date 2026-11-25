import { describe, expect, it } from "vitest";
import { TimelineSearchIndex } from "../src/search/timeline-search-index";
const doc = { id: "note.md", kind: "file" as const, path: "note.md", basename: "note", directory: "", content: "Current body", meta: "ext:md" };
const query = { includeText: "body", excludeTokens: [], exactPhrases: [], excludedPhrases: [] };
function snapshot(): any { const index = new TimelineSearchIndex(); index.upsert(doc); return structuredClone(index.serialize()); }
describe("current search schema only", () => {
	it("round-trips empty and populated caches", () => {
		for (const source of [new TimelineSearchIndex().serialize(), snapshot()]) {
			const index = new TimelineSearchIndex(); expect(index.loadSerialized(source)).toBe(true);
			// MiniSearch rebuilds its term tree on load; term order is not a schema guarantee.
			const canonical = (value: any) => ({ ...value, index: value.index.slice().sort(([a]: [string], [b]: [string]) => a.localeCompare(b)) });
			expect(canonical(index.serialize())).toEqual(canonical(source));
			expect(index.searchFileIds(query)).toEqual((source as any).documentCount ? new Set(["note.md"]) : new Set());
		}
	});
	it.each(["stored field", "stored id", "kind", "field ids", "term field", "version", "top level"])("rejects a cache with a retired %s instead of migrating it", part => {
		const payload = snapshot();
		if (part === "stored field") payload.storedFields[0].topics = ["old"];
		if (part === "stored id") payload.storedFields[0].id = "other.md";
		if (part === "kind") payload.storedFields[0].kind = "epoch";
		if (part === "field ids") payload.fieldIds.topics = 5;
		if (part === "term field") payload.index[0][1][5] = { 0: 1 };
		if (part === "version") payload.serializationVersion = 1;
		if (part === "top level") payload.embeddings = {};
		const index = new TimelineSearchIndex(); expect(index.loadSerialized(payload)).toBe(false);
		expect(JSON.stringify(index.serialize())).not.toContain("topics");
	});
	it("projects new documents to current fields and preserves normal removal", () => {
		const index = new TimelineSearchIndex();
		index.upsert({ ...doc, topics: ["old"], aiSummary: "old" } as any);
		expect(JSON.stringify(index.serialize())).not.toContain("topics"); expect(JSON.stringify(index.serialize())).not.toContain("aiSummary");
		expect(index.searchFileIds(query)).toEqual(new Set(["note.md"]));
		expect(index.upsert({ ...doc, kind: "epoch" } as any)).toBe(false);
		expect(index.removeById("note.md")).toBe(true); expect(index.searchFileIds(query).size).toBe(0);
	});
});
