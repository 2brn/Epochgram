import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReviewPlugin } from "./helpers/review-plugin";
import { runReset } from "../src/plugin/maintenance-reset";
import { persistenceMethods } from "../src/plugin/persistence";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 2)); });
afterEach(() => vi.useRealTimers());
describe("review operations", () => {
	it("Review all never unhides records", async () => {
		const p = await makeReviewPlugin({ "a.md": "Meeting 2026-01-05", "b.md": "Body" });
		p.indexer.setEntryReviewState(p.indexer.index["2026-01-05"][0], "hidden"); p.indexer.setFileReviewState("b.md", "hidden");
		await p.reviewAllDraftFiles();
		expect(p.indexer.getFileReviewState("a.md")).toBe("reviewed"); expect(p.indexer.getFileReviewState("b.md")).toBe("hidden");
		expect(p.indexer.index["2026-01-05"][0].reviewState).toBe("hidden");
		expect(p.persistIndex).toHaveBeenCalledOnce(); expect(p.app.vault.modify).not.toHaveBeenCalled();
	});
	it("can cancel a staged bulk review without losing live edits or writing partial state", async () => {
		const notes = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`${i}.md`, "Body"]));
		const p = await makeReviewPlugin(notes);
		const job = p.reviewAllDraftFiles();
		for (let i = 0; i < 12; i++) await Promise.resolve();
		p.contents["0.md"] = "Concurrent edit"; await p.indexer.processFile(p.files[0], { reason: "modify" });
		p.__epochCancelRequestedAt = { review: Date.now() };
		await vi.advanceTimersByTimeAsync(1); await job;
		expect(p.indexer.getFileIndexData("0.md").cdate.summary).toContain("Concurrent edit");
		for (const file of p.files) expect(p.indexer.getFileReviewState(file.path)).toBe("draft");
		expect(p.persistIndex).not.toHaveBeenCalled(); expect(p.indexLoadPromise).toBeNull(); expect(p.indexReady).toBe(true);
	});
	it("does not review content changed during staging", async () => {
		const p = await makeReviewPlugin(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`${i}.md`, "Body"])));
		const job = p.reviewAllDraftFiles();
		for (let i = 0; i < 12; i++) await Promise.resolve();
		p.contents["0.md"] = "New body"; await p.indexer.processFile(p.files[0], { reason: "modify" });
		await vi.runAllTimersAsync(); await job;
		expect(p.indexer.getFileReviewState("0.md")).toBe("draft"); expect(p.indexer.getFileReviewState("1.md")).toBe("reviewed");
	});
	it("Reviews reset persists Draft for hidden and reviewed recurring occurrences despite stale Sync state", async () => {
		const p = await makeReviewPlugin({ "note.md": "---\nrepeat: every day from 2026-01-01 count 3\n---\nBody" });
		Object.assign(p, persistenceMethods);
		const occurrence = (date: string) => p.indexer.index[date].find((e: any) => e.recurring);
		p.indexer.setFileReviewState("note.md", "hidden");
		p.indexer.setEntryReviewState(occurrence("2026-01-02"), "reviewed");
		const stale = p.indexer.toJSON();
		await p.persistIndex();
		await runReset(p, { settings: false, search: false, dataFiles: false, reviews: true });
		await p.indexer.load(JSON.parse(p.stored.get(p.indexFilePath)));
		p.indexer.mergeReviewStates(stale);
		expect(p.indexer.getFileReviewState("note.md")).toBe("draft");
		for (const date of ["2026-01-01", "2026-01-02", "2026-01-03"]) {
			expect(occurrence(date).reviewState ?? "draft").toBe("draft");
			const mutation = p.indexer.getFileIndexData("note.md").recurringReviewStates[date];
			expect(mutation.state).toBe("draft");
			expect(mutation.updatedAt).toBeGreaterThan(stale.files["note.md"].recurringReviewStates[date].updatedAt);
		}
		expect(p.app.vault.modify).not.toHaveBeenCalled();
	});
	it("rebuild/reset data preserves review metadata; explicit Reviews reset also unhides", async () => {
		const p = await makeReviewPlugin({ "a.md": "Body", "b.md": "Body" }); Object.assign(p, persistenceMethods);
		p.indexer.setFileReviewState("a.md", "reviewed"); p.indexer.setFileReviewState("b.md", "hidden");
		await runReset(p, { settings: false, search: false, dataFiles: true });
		expect(p.indexer.getFileReviewState("a.md")).toBe("reviewed"); expect(p.indexer.getFileReviewState("b.md")).toBe("hidden");
		await runReset(p, { settings: false, search: false, dataFiles: false, reviews: true });
		expect(p.indexer.getFileReviewState("a.md")).toBe("draft"); expect(p.indexer.getFileReviewState("b.md")).toBe("draft");
		expect([...p.stored.keys()].every(path => path.startsWith("config/plugins/epochgram/"))).toBe(true);
		expect(p.app.vault.modify).not.toHaveBeenCalled(); expect(p.app.vault.create).not.toHaveBeenCalled();
	});
});
