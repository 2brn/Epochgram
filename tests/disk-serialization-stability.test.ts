import { describe, expect, it } from "vitest";
import { normalizeSerializedEpochIndexForDisk as normalize } from "../src/indexer/disk-serialization";
import { createEmptyFileIndex } from "../src/indexer/file-index-factory";
import type { DateEntry, SerializedEpochIndex } from "../src/indexer/types";
const entry: DateEntry = { file: "a.md", date: "2025-01-01", blockStart: 0, blockEnd: 0, source: "namedate", summary: "Summary", namedDateRange: true };
describe("disk serialization", () => {
	it("does not carry retired fields or source types into current index data", () => {
		const obsolete: any = { ...entry, source: "tracked", trackedHash: "old" };
		const retained: any = { ...entry, topics: ["old"], embedding: [1, 2] };
		const result = normalize({ files: { "a.md": { ...createEmptyFileIndex(), cdate: obsolete, namedDate: obsolete, dateProp: obsolete, contentDates: [obsolete, retained], trackedDates: { old: obsolete } } }, dates: { [entry.date]: [obsolete, retained] }, epochs: {} } as any);
		expect(result.files["a.md"].cdate).toBeNull(); expect(result.files["a.md"].namedDate).toBeNull(); expect(result.files["a.md"].dateProp).toBeNull();
		expect(result.files["a.md"].contentDates).toHaveLength(1); expect(result.dates[entry.date]).toHaveLength(1);
		for (const key of ["tracked", "topics", "embedding", "epochs"]) expect(JSON.stringify(result)).not.toContain(key);
	});
	it("sorts files and dates deterministically", () => {
		const result = normalize({ files: { "b.md": createEmptyFileIndex(), "a.md": createEmptyFileIndex() }, dates: { "2025-02-01": [{ ...entry, date: "2025-02-01" }], "2025-01-01": [entry] } });
		expect(Object.keys(result.files)).toEqual(["a.md", "b.md"]);
		expect(Object.keys(result.dates)).toEqual(["2025-01-01", "2025-02-01"]);
		expect(JSON.stringify(normalize(result))).toBe(JSON.stringify(result));
	});
	it("stabilizes field order independently of insertion order", () => {
		const data = { ...createEmptyFileIndex(), indexedMtimeMs: 123, indexedSize: 456, contentHash: "abc", markColor: 2 };
		const reversed = Object.fromEntries(Object.entries(data).reverse());
		expect(JSON.stringify(normalize({ files: { "a.md": data }, dates: {} }))).toBe(JSON.stringify(normalize({ files: { "a.md": reversed }, dates: {} } as SerializedEpochIndex)));
	});
	it("preserves filename range flags and descriptions, while regenerating recurring occurrences", () => {
		const result = normalize({ files: { "a.md": { ...createEmptyFileIndex(), contentDates: [entry] } }, dates: { [entry.date]: [entry, { ...entry, recurring: true }] } });
		expect(result.files["a.md"].contentDates[0]).toMatchObject(entry);
		expect(result.dates[entry.date]).toHaveLength(1);
		expect(result.dates[entry.date][0]).toMatchObject(entry);
	});
});
