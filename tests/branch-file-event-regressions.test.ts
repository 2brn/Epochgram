import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFolder } from "obsidian";
import { makeReviewPlugin } from "./helpers/review-plugin";
import { fileEventMethods } from "../src/plugin/file-events";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup(initial = { "note.md": "Body" }) {
	const p = await makeReviewPlugin(initial), events = new Map<string, (...args: any[]) => void>(), cleanups: Array<() => void> = [];
	for (const name of ["vault", "workspace", "metadataCache"]) {
		p.app[name].on = (event: string, fn: (...args: any[]) => void) => { events.set(`${name}:${event}`, fn); return {}; };
		p.app[name].offref = vi.fn();
	}
	Object.assign(p, { vaultEventRefs: [], workspaceEventRefs: [], metadataEventRefs: [], registerEvent: vi.fn(), register: (fn: () => void) => cleanups.push(fn), getManagedFileType: () => null });
	fileEventMethods.registerFileEvents.call(p);
	return { p, events, cleanups };
}
describe("branch file event regression coverage", () => {
	it("indexes previously excluded descendants renamed into an included folder", async () => {
		const { p, events } = await setup({ "excluded/note.md": "Body" });
		p.indexer.removeFile("excluded/note.md");
		p.files[0].path = "included/note.md"; p.contents["included/note.md"] = "Moved body";
		p.shouldIndexFile = (file: any) => !file.path.startsWith("excluded/");
		events.get("vault:rename")!(new TFolder("included"), "excluded");
		await vi.advanceTimersByTimeAsync(901);
		expect(p.indexer.isFileKnown("included/note.md")).toBe(true);
		expect(p.persist).toHaveBeenCalledOnce();
	});
	it("preserves review decisions when renaming already-indexed descendants", async () => {
		const { p, events } = await setup({ "old/note.md": "Body" });
		p.indexer.setFileReviewState("old/note.md", "hidden");
		p.files[0].path = "new/note.md"; p.contents["new/note.md"] = "Body";
		events.get("vault:rename")!(new TFolder("new"), "old"); await vi.advanceTimersByTimeAsync(901);
		expect(p.indexer.isFileKnown("old/note.md")).toBe(false);
		expect(p.indexer.getFileReviewState("new/note.md")).toBe("hidden");
	});
	it("retries a transient file read failure instead of dropping the event", async () => {
		const { p, events } = await setup(); vi.spyOn(console, "error").mockImplementation(() => {});
		p.app.vault.read.mockRejectedValueOnce(new Error("temporary read failure"));
		p.contents["note.md"] = "Recovered edit"; events.get("metadataCache:changed")!(p.files[0]);
		await vi.advanceTimersByTimeAsync(901); expect(p.persist).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(901);
		expect(p.indexer.getFileIndexData("note.md").cdate.summary).toContain("Recovered edit"); expect(p.persist).toHaveBeenCalledOnce();
	});
	it("retries persistence when a processed event's first write fails", async () => {
		const { p, events } = await setup(); vi.spyOn(console, "error").mockImplementation(() => {});
		p.persist.mockRejectedValueOnce(new Error("temporary write failure"));
		p.contents["note.md"] = "Changed body";
		events.get("metadataCache:changed")!(p.files[0]);
		await vi.advanceTimersByTimeAsync(901);
		expect(p.persist).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1801);
		expect(p.persist).toHaveBeenCalledTimes(2);
		expect(p.indexer.getFileIndexData("note.md").cdate.summary).toContain("Changed body");
	});
	it("persists an in-flight edit even when unload happens before its read resolves", async () => {
		const { p, events, cleanups } = await setup();
		let release!: (text: string) => void;
		p.app.vault.read.mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; }));
		events.get("metadataCache:changed")!(p.files[0]);
		await vi.advanceTimersByTimeAsync(901);
		cleanups.forEach(fn => fn()); release("Last edit");
		for (let i = 0; i < 20; i++) await Promise.resolve();
		expect(p.persist).toHaveBeenCalledOnce();
		expect(p.indexer.getFileIndexData("note.md").cdate.summary).toContain("Last edit");
	});
	it("does not reparse or persist a known file simply because it is reopened", async () => {
		const { p } = await setup();
		p.app.vault.read.mockClear();
		await p.maybeIndexOpenedFile(p.files[0]);
		expect(p.app.vault.read).not.toHaveBeenCalled(); expect(p.persist).not.toHaveBeenCalled();
	});
});
