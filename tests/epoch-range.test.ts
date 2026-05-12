import { describe, expect, test } from "vitest";
import type { DateEntry } from "../src/indexer/types";
import { getEpochRangeFromEntry } from "../src/ui/epoch-canvas-utils";

const makeEpochEntry = (overrides: Partial<DateEntry> = {}): DateEntry => ({
	date: overrides.date ?? "2025-01-01",
	file: overrides.file ?? "epoch://month/2025-01-01-2025-01-31",
	blockStart: overrides.blockStart ?? 0,
	blockEnd: overrides.blockEnd ?? 0,
	summary: overrides.summary ?? "epoch",
	source: overrides.source ?? "epoch",
	epochBucket: overrides.epochBucket,
	epochStart: overrides.epochStart,
	epochEnd: overrides.epochEnd
});

describe("epoch range parsing", () => {
	test("uses epochStart/epochEnd when present", () => {
		const entry = makeEpochEntry({
			file: "epoch://month/2025-01-01-2025-01-31",
			epochStart: "2025-02-01",
			epochEnd: "2025-02-28"
		});
		expect(getEpochRangeFromEntry(entry)).toEqual({ start: "2025-02-01", end: "2025-02-28" });
	});

	test("falls back to epoch:// file path", () => {
		const entry = makeEpochEntry({
			file: "epoch://week/2025-03-03-2025-03-09",
			epochStart: undefined,
			epochEnd: undefined
		});
		expect(getEpochRangeFromEntry(entry)).toEqual({ start: "2025-03-03", end: "2025-03-09" });
	});

	test("returns null when no range can be derived", () => {
		const entry = makeEpochEntry({ file: "note.md", epochStart: undefined, epochEnd: undefined });
		expect(getEpochRangeFromEntry(entry)).toBeNull();
	});
});
