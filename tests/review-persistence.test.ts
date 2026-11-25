import { describe, expect, it } from "vitest";
import { makeReviewPlugin } from "./helpers/review-plugin";
import { persistenceMethods } from "../src/plugin/persistence";
import { pollingMethods } from "../src/plugin/polling";

describe("review persistence and Sync", () => {
	it("retries a transient disk read failure without dropping the pending write", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		p.stored.set(p.indexFilePath, JSON.stringify(p.indexer.toJSON()));
		p.app.vault.adapter.read.mockRejectedValueOnce(new Error("temporary read error"));
		p.indexer.setFileReviewState("note.md", "hidden");
		await expect(p.persistIndex()).resolves.toBeUndefined();
		expect(JSON.parse(p.stored.get(p.indexFilePath)).files["note.md"].cdate.reviewState).toBe("hidden");
	});
	it("merges newer disk review state before writing and updates live records", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		const local = p.indexer.toJSON(), disk = structuredClone(local);
		disk.files["note.md"].cdate.reviewState = "reviewed"; disk.files["note.md"].cdate.reviewStateUpdatedAt = Date.now() + 100;
		p.stored.set(p.indexFilePath, JSON.stringify(disk));
		await p.writeIndexToDisk(local);
		expect(p.indexer.getFileReviewState("note.md")).toBe("reviewed");
		expect(JSON.parse(p.stored.get(p.indexFilePath)).dates["2026-01-01"][0].reviewState).toBe("reviewed");
	});
	it("retries when Sync changes the disk between read and write", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		const snapshot = p.indexer.toJSON(), remote = structuredClone(snapshot);
		remote.files["note.md"].cdate.reviewState = "hidden"; remote.files["note.md"].cdate.reviewStateUpdatedAt = Date.now() + 100;
		p.stored.set(p.indexFilePath, JSON.stringify(snapshot));
		let reads = 0;
		p.app.vault.adapter.read.mockImplementation(async (path: string) => {
			if (++reads === 2) p.stored.set(path, JSON.stringify(remote));
			return p.stored.get(path);
		});
		await p.writeIndexToDisk(snapshot);
		expect(reads).toBeGreaterThanOrEqual(4); expect(p.indexer.getFileReviewState("note.md")).toBe("hidden");
		expect(JSON.parse(p.stored.get(p.indexFilePath)).files["note.md"].cdate.reviewState).toBe("hidden");
	});
	it("preserves a local Draft tombstone against a stale queued write", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		p.indexer.setFileReviewState("note.md", "reviewed"); const old = p.indexer.toJSON();
		const writing = p.writeIndexToDisk(old);
		p.indexer.setFileReviewState("note.md", "draft");
		await writing;
		const disk = JSON.parse(p.stored.get(p.indexFilePath));
		expect(disk.files["note.md"].cdate.reviewState).toBe("draft");
		expect(disk.files["note.md"].cdate.reviewStateUpdatedAt).toBeGreaterThan(old.files["note.md"].cdate.reviewStateUpdatedAt);
	});
	it("does not replace live mutations with a polling read started earlier", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods, pollingMethods);
		let release!: (value: any) => void; const old = p.indexer.toJSON();
		p.loadIndexFromDisk = () => new Promise(resolve => { release = resolve; });
		const reading = p.reloadIndexFromDisk();
		p.indexer.setFileReviewState("note.md", "hidden"); release(old); await reading;
		expect(p.indexer.getFileReviewState("note.md")).toBe("hidden");
	});
	it("does not resurrect noindex files from a polling read started earlier", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods, pollingMethods);
		let release!: (value: any) => void; const old = p.indexer.toJSON();
		p.loadIndexFromDisk = () => new Promise(resolve => { release = resolve; });
		const reading = p.reloadIndexFromDisk();
		p.contents["note.md"] = "---\nnoindex: true\n---\nBody";
		await p.indexer.processFile(p.files[0], { reason: "modify" });
		release(old); await reading;
		expect(p.indexer.isFileKnown("note.md")).toBe(false);
	});
	it("retries a pending write after noindex removes a file", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		const old = p.indexer.toJSON(); p.stored.set(p.indexFilePath, JSON.stringify(old));
		p.app.vault.adapter.read.mockImplementationOnce(async (path: string) => {
			p.contents["note.md"] = "---\nnoindex: true\n---\nBody";
			await p.indexer.processFile(p.files[0], { reason: "modify" });
			return p.stored.get(path);
		});
		await p.writeIndexToDisk(old);
		expect(JSON.parse(p.stored.get(p.indexFilePath)).files["note.md"]).toBeUndefined();
	});
	it("persists local edits made while an adapter write is in flight", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		const old = p.indexer.toJSON();
		p.app.vault.adapter.write.mockImplementationOnce(async (path: string, value: string) => {
			p.indexer.setFileReviewState("note.md", "hidden");
			p.stored.set(path, value);
		});
		await p.writeIndexToDisk(old);
		expect(p.app.vault.adapter.write).toHaveBeenCalledTimes(2);
		expect(JSON.parse(p.stored.get(p.indexFilePath)).files["note.md"].cdate.reviewState).toBe("hidden");
	});
	it("reconciles a Sync replacement observed after the adapter write", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods);
		const old = p.indexer.toJSON(), remote = structuredClone(old);
		remote.files["note.md"].cdate.reviewState = "hidden"; remote.files["note.md"].cdate.reviewStateUpdatedAt = Date.now() + 100;
		p.app.vault.adapter.write.mockImplementationOnce(async (path: string) => { p.stored.set(path, JSON.stringify(remote)); });
		await p.writeIndexToDisk(old);
		expect(p.indexer.getFileReviewState("note.md")).toBe("hidden");
		expect(JSON.parse(p.stored.get(p.indexFilePath)).dates["2026-01-01"][0].reviewState).toBe("hidden");
	});
	it("reload reconciles current-schema review states without touching old sidecars", async () => {
		const p = await makeReviewPlugin(); Object.assign(p, persistenceMethods, pollingMethods);
		const old = p.indexer.toJSON(); p.stored.set(p.indexFilePath, JSON.stringify(old));
		p.stored.set("config/epochgram-index.json", "old-sidecar");
		p.indexer.setFileReviewState("note.md", "reviewed"); await p.reloadIndexFromDisk();
		expect(p.indexer.getFileReviewState("note.md")).toBe("reviewed");
		expect(p.stored.get("config/epochgram-index.json")).toBe("old-sidecar");
		expect(p.app.vault.adapter.read.mock.calls.every(([path]: [string]) => path === p.indexFilePath)).toBe(true);
	});
});
