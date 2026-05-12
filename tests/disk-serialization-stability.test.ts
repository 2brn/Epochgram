import { describe, expect, it } from "vitest";

import { normalizeSerializedEpochIndexForDisk } from "../src/indexer/disk-serialization";
import type { SerializedEpochIndex } from "../src/indexer/types";

function emptyFileData(overrides: Record<string, unknown> = {}): any {
	return {
		cdate: null,
		namedDate: null,
		dateProp: null,
		contentDates: [],
		trackedDates: {},
		trackedSnapshot: null,
		trackedSnapshotDate: null,
		trackedBaselineSnapshot: null,
		trackedBaselineDate: null,
		reviewState: "draft",
		markColor: undefined,
		pinnedFile: false,
		recur: null,
		...overrides
	};
}

describe("normalizeSerializedEpochIndexForDisk ordering", () => {
	it("sorts top-level files, trackedDates keys, and date keys deterministically", () => {
		const trackedB: any = {};
		trackedB["2025-02-01"] = [];
		trackedB["2025-01-01"] = [];

		const trackedA: any = {};
		trackedA["2025-03-01"] = [];
		trackedA["2025-01-01"] = [];

		const files: any = {};
		files["b.md"] = emptyFileData({ trackedDates: trackedB });
		files["a.md"] = emptyFileData({ trackedDates: trackedA });

		const dates: any = {};
		dates["2025-02-01"] = [{ file: "b.md", source: "content", date: "2025-02-01", blockStart: 1, blockEnd: 1, summary: "x" }];
		dates["2025-01-01"] = [{ file: "a.md", source: "content", date: "2025-01-01", blockStart: 1, blockEnd: 1, summary: "x" }];

		const serialized: SerializedEpochIndex = { files, dates } as any;
		const normalized = normalizeSerializedEpochIndexForDisk(serialized);

		expect(Object.keys(normalized.files)).toEqual(["a.md", "b.md"]);
		expect(Object.keys((normalized.files as any)["a.md"].trackedDates)).toEqual(["2025-01-01", "2025-03-01"]);
		expect(Object.keys((normalized.files as any)["b.md"].trackedDates)).toEqual(["2025-01-01", "2025-02-01"]);
		expect(Object.keys(normalized.dates)).toEqual(["2025-01-01", "2025-02-01"]);
	});

	it("is stable under repeated normalization + stringify", () => {
		const files: any = {};
		files["b.md"] = emptyFileData();
		files["a.md"] = emptyFileData();

		const dates: any = {};
		dates["2025-02-01"] = [{ file: "b.md", source: "content", date: "2025-02-01", blockStart: 1, blockEnd: 1, summary: "x" }];
		dates["2025-01-01"] = [{ file: "a.md", source: "content", date: "2025-01-01", blockStart: 1, blockEnd: 1, summary: "x" }];

		const serialized: SerializedEpochIndex = { files, dates } as any;
		const n1 = normalizeSerializedEpochIndexForDisk(serialized);
		const s1 = JSON.stringify(n1);
		const n2 = normalizeSerializedEpochIndexForDisk(n1 as any);
		const s2 = JSON.stringify(n2);

		expect(s2).toBe(s1);
	});

	it("stabilizes per-file record key order (independent of insertion order)", () => {
		const baseValues: Record<string, unknown> = {
			cdate: null,
			namedDate: null,
			dateProp: null,
			contentDates: [],
			trackedDates: {},
			trackedSnapshot: null,
			trackedSnapshotDate: null,
			trackedBaselineSnapshot: null,
			trackedBaselineDate: null,
			indexedMtimeMs: 123,
			indexedSize: 456,
			contentHash: "abc",
			embeddingTerm: "term",
			reviewState: "draft",
			markColor: 2,
			pinnedFile: false,
			recur: null,
			aaaExtra: "a",
			zzzExtra: "z"
		};

		const buildWithOrder = (keys: string[]): any => {
			const out: any = {};
			for (const k of keys) out[k] = (baseValues as any)[k];
			return out;
		};

		const order1 = Object.keys(baseValues);
		const order2 = Object.keys(baseValues).slice().reverse();

		const serialized1: SerializedEpochIndex = {
			files: { "a.md": buildWithOrder(order1) },
			dates: {}
		} as any;
		const serialized2: SerializedEpochIndex = {
			files: { "a.md": buildWithOrder(order2) },
			dates: {}
		} as any;

		const s1 = JSON.stringify(normalizeSerializedEpochIndexForDisk(serialized1));
		const s2 = JSON.stringify(normalizeSerializedEpochIndexForDisk(serialized2));
		expect(s2).toBe(s1);
	});
});
