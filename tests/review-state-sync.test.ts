import { describe, expect, it } from "vitest";
import { mergeReviewStatesForSync } from "../src/indexer/review-state-sync";
import type { ReviewState, SerializedEpochIndex } from "../src/indexer/types";
import { normalizeReviewState } from "../src/indexer/review-state";
function snapshot(state: ReviewState, time: number, bodyHash = "body"): SerializedEpochIndex {
	const entry = { date: "2026-01-01", file: "note.md", source: "cdate" as const, blockStart: 0, blockEnd: 0, summary: "Body", reviewState: state, reviewStateUpdatedAt: time };
	return { files: { "note.md": { cdate: { ...entry }, namedDate: null, dateProp: null, contentDates: [], bodyHash, contentHash: "full", indexedSize: 4 } }, dates: { "2026-01-01": [{ ...entry }] } };
}
describe("current review schema Sync reconciliation", () => {
	it.each(["draft", "reviewed", "hidden"] as const)("preserves newest %s against stale copies", state => {
		const local = snapshot(state, 20), stale = snapshot("reviewed", 10);
		mergeReviewStatesForSync(stale, local); mergeReviewStatesForSync(local, stale);
		expect(normalizeReviewState(local.files["note.md"].cdate!.reviewState)).toBe(state);
		expect(normalizeReviewState(stale.dates["2026-01-01"][0].reviewState)).toBe(state);
		expect(stale.dates["2026-01-01"][0].reviewStateUpdatedAt).toBe(20);
	});
	it("rejects incompatible bodies and hashless text snapshots", () => {
		const local = snapshot("draft", 5, "new"), stale = snapshot("reviewed", 20, "old");
		mergeReviewStatesForSync(local, stale); expect(normalizeReviewState(local.files["note.md"].cdate!.reviewState)).toBe("draft");
		for (const data of [local.files["note.md"], stale.files["note.md"]]) { delete data.bodyHash; delete data.contentHash; }
		mergeReviewStatesForSync(local, stale); expect(normalizeReviewState(local.files["note.md"].cdate!.reviewState)).toBe("draft");
	});
	it("matches identical bodies despite different frontmatter fingerprints", () => {
		const local = snapshot("draft", 1), remote = snapshot("reviewed", 2); remote.files["note.md"].contentHash = "different YAML";
		mergeReviewStatesForSync(local, remote); expect(local.files["note.md"].cdate!.reviewState).toBe("reviewed");
	});
	it("merges independent occurrences and keeps per-date Draft tombstones", () => {
		const local = snapshot("draft", 0), remote = snapshot("draft", 0);
		local.files["note.md"].recurringReviewStates = { "2026-01-01": { state: "reviewed", updatedAt: 10 }, "2026-01-02": { state: "draft", updatedAt: 30 } };
		remote.files["note.md"].recurringReviewStates = { "2026-01-02": { state: "reviewed", updatedAt: 20 }, "2026-01-03": { state: "hidden", updatedAt: 15 } };
		mergeReviewStatesForSync(local, remote); mergeReviewStatesForSync(remote, local);
		expect(local.files["note.md"].recurringReviewStates).toEqual(remote.files["note.md"].recurringReviewStates);
		expect(local.files["note.md"].recurringReviewStates["2026-01-02"].state).toBe("draft");
		expect(Object.keys(local.files["note.md"].recurringReviewStates)).toHaveLength(3);
	});
	it("resolves timestamp ties deterministically", () => {
		const a = snapshot("hidden", 10), b = snapshot("reviewed", 10);
		mergeReviewStatesForSync(a, b); mergeReviewStatesForSync(b, a);
		expect(a.files["note.md"].cdate!.reviewState).toBe("hidden"); expect(b.files["note.md"].cdate!.reviewState).toBe("hidden");
	});
});
