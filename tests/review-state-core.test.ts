import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReviewPlugin } from "./helpers/review-plugin";
import { Indexer } from "../src/indexer/indexer";
import { normalizeReviewState } from "../src/indexer/review-state";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 0, 2)); });
afterEach(() => vi.useRealTimers());
describe("review state core", () => {
	it("defaults to Draft and updates all ordinary records on the selected day only", async () => {
		const p = await makeReviewPlugin({ "note.md": "Meeting 2026-01-01\nMeeting 2026-01-05" });
		expect(p.indexer.getFileReviewState("note.md")).toBe("draft");
		const target = p.indexer.index["2026-01-01"][0];
		expect(p.indexer.setEntryReviewState(target, "reviewed")).toBe(true);
		expect(p.indexer.index["2026-01-01"].every((e: any) => e.reviewState === "reviewed")).toBe(true);
		expect(normalizeReviewState(p.indexer.index["2026-01-05"][0].reviewState)).toBe("draft");
	});
	it("keeps explicit Draft tombstones newer even within one millisecond", async () => {
		const p = await makeReviewPlugin();
		p.indexer.setFileReviewState("note.md", "reviewed");
		const reviewed = p.indexer.getFileIndexData("note.md").cdate.reviewStateUpdatedAt;
		p.indexer.setFileReviewState("note.md", "draft");
		const draft = p.indexer.getFileIndexData("note.md").cdate;
		expect(normalizeReviewState(draft.reviewState)).toBe("draft"); expect(draft.reviewStateUpdatedAt).toBeGreaterThan(reviewed);
		expect(p.app.vault.modify).not.toHaveBeenCalled(); expect(p.app.vault.adapter.write).not.toHaveBeenCalled();
	});
	it("keeps each recurring occurrence independent through serialization and rebuilding", async () => {
		const p = await makeReviewPlugin({ "note.md": "---\nrepeat: every day from 2026-01-01 count 3\n---\nBody" });
		const occurrence = (date: string) => p.indexer.index[date].find((e: any) => e.recurring);
		p.indexer.setEntryReviewState(occurrence("2026-01-01"), "reviewed");
		p.indexer.setEntryReviewState(occurrence("2026-01-02"), "hidden");
		expect(p.indexer.getFileReviewState("note.md")).toBe("draft");
		const disk = JSON.parse(JSON.stringify(p.indexer.toJSON()));
		await p.indexer.load(disk); await p.indexer.rebuildAll(p.files);
		expect(occurrence("2026-01-01").reviewState).toBe("reviewed"); expect(occurrence("2026-01-02").reviewState).toBe("hidden");
		expect(normalizeReviewState(occurrence("2026-01-03").reviewState)).toBe("draft");
		p.indexer.setEntryReviewState(occurrence("2026-01-01"), "draft");
		expect(p.indexer.toJSON().files["note.md"].recurringReviewStates["2026-01-01"].state).toBe("draft");
	});
	it("resets Reviewed anchors and their pinned-today clones after a body edit", async () => {
		const p = await makeReviewPlugin({ "note.md": "---\npin: today\n---\nBody" });
		p.settings.anchorMdate = false;
		p.indexer.setFileReviewState("note.md", "reviewed");
		p.contents["note.md"] += "\nChanged";
		await p.indexer.processFile(p.files[0], { reason: "modify" });
		expect(p.indexer.getFileReviewState("note.md")).toBe("draft");
		expect(p.indexer.index["2026-01-02"][0].pinned).toBe(true);
		expect(normalizeReviewState(p.indexer.index["2026-01-02"][0].reviewState)).toBe("draft");
	});
	it("preserves Hidden on edits and Reviewed on YAML-only, no-op, and CRLF changes", async () => {
		const p = await makeReviewPlugin({ "note.md": "---\ntags: [one]\n---\nBody\nSecond" });
		p.indexer.setFileReviewState("note.md", "reviewed");
		for (const body of ["---\ntags: [two]\n---\nBody\nSecond", "---\r\ntags: [two]\r\n---\r\nBody\r\nSecond"]) {
			p.contents["note.md"] = body; await p.indexer.processFile(p.files[0], { reason: "modify" });
			expect(p.indexer.getFileReviewState("note.md")).toBe("reviewed");
		}
		p.indexer.setFileReviewState("note.md", "hidden"); p.contents["note.md"] = "Changed body";
		await p.indexer.processFile(p.files[0], { reason: "modify" }); expect(p.indexer.getFileReviewState("note.md")).toBe("hidden");
	});
	it.each(["---", "...", "...  "])("preserves Reviewed on YAML-only changes with %s closing delimiters", async closing => {
		const p = await makeReviewPlugin({ "note.md": `---\ntags: [one]\n${closing}\nBody` });
		p.indexer.setFileReviewState("note.md", "reviewed");
		p.contents["note.md"] = `---\ntags: [two]\n${closing}\nBody`;
		await p.indexer.processFile(p.files[0], { reason: "modify" });
		expect(p.indexer.getFileReviewState("note.md")).toBe("reviewed");
		p.contents["note.md"] += " changed";
		await p.indexer.processFile(p.files[0], { reason: "modify" });
		expect(p.indexer.getFileReviewState("note.md")).toBe("draft");
	});
	it.each([["Body", "\uFEFFBody"], ["Café", "Cafe\u0301"], ["One\nTwo", "One\u2028Two"]])("ignores encoding-only edits to review state (%j)", async (before, after) => {
		const p = await makeReviewPlugin({ "note.md": before });
		p.indexer.setFileReviewState("note.md", "reviewed");
		p.contents["note.md"] = after;
		await p.indexer.processFile(p.files[0], { reason: "modify" });
		expect(p.indexer.getFileReviewState("note.md")).toBe("reviewed");
	});
	it("preserves binary Sync touches but resets Reviewed on size changes", async () => {
		const p = await makeReviewPlugin({ "image.png": "" }); p.indexer.setFileReviewState("image.png", "reviewed");
		await p.indexer.processFile(p.files[0], { reason: "modify" }); expect(p.indexer.getFileReviewState("image.png")).toBe("reviewed");
		p.files[0].stat.size++; await p.indexer.processFile(p.files[0], { reason: "modify" });
		expect(p.indexer.getFileReviewState("image.png")).toBe("draft"); expect(p.app.vault.read).not.toHaveBeenCalled();
	});
	it("carries state reloaded while content is being read", async () => {
		const p = await makeReviewPlugin(); let release!: (text: string) => void;
		p.app.vault.read.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
		const work = p.indexer.processFile(p.files[0], { reason: "modify" });
		const synced = new Indexer(p); await synced.load(p.indexer.toJSON()); synced.setFileReviewState("note.md", "reviewed");
		await p.indexer.load(synced.toJSON()); release("Body"); await work;
		expect(p.indexer.getFileReviewState("note.md")).toBe("reviewed");
	});
	it("reset reviews returns both reviewed and hidden records to Draft", async () => {
		const p = await makeReviewPlugin({ "note.md": "Meeting 2026-01-05" });
		p.indexer.setFileReviewState("note.md", "reviewed"); p.indexer.setEntryReviewState(p.indexer.index["2026-01-05"][0], "hidden");
		expect(p.indexer.clearFileReviewOverrides("note.md")).toBe(true);
		expect(p.indexer.getFileReviewState("note.md")).toBe("draft"); expect(normalizeReviewState(p.indexer.index["2026-01-05"][0].reviewState)).toBe("draft");
		expect(p.indexer.clearFileReviewOverrides("note.md")).toBe(false);
	});
});
