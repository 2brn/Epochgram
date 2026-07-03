import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Platform, TFile } from "obsidian";
import { withTrustedPro } from "./helpers/trusted-pro";

// Create a fake TFile class that can be used for instanceof checks
class FakeTFile {
	path: string;
	stat: any;
	extension?: string;
	constructor(path: string, stat: any) {
		this.path = path;
		this.stat = stat;
		const lastDot = path.lastIndexOf(".");
		this.extension = lastDot > -1 ? path.slice(lastDot + 1) : "";
	}
}
// Make instanceof work by setting the prototype
Object.setPrototypeOf(FakeTFile.prototype, TFile.prototype);

vi.mock("../src/plugin/similarity/store", () => {
	return {
		readStore: vi.fn(async () => ({ model: "m", dim: 1, files: {} }))
	};
});

vi.mock("../src/plugin/similarity-term-store", () => {
	return {
		readTermStore: vi.fn(async () => ({ model: "zeroshot", files: {} }))
	};
});

import { runSimilarityStartupMaintenance } from "../src/plugin/similarity/startup-maintenance";

describe("similarity: startup maintenance (small vault)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Platform.isDesktop = true;
		Platform.isMobile = false;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("enqueues work in repeated batches until completion (not capped at 500)", async () => {
		const queuedVectors: string[] = [];
		const queuedTopics: string[] = [];

		const mdFiles = Array.from({ length: 1201 }, (_, i) => new FakeTFile(`f${i}.md`, { mtime: i }));
		const files = [
			...mdFiles,
			new FakeTFile("notes/readme.txt", { mtime: -1 }),
			new FakeTFile("data/stuff.json", { mtime: -2 })
		];

		const plugin: any = {
			proActive: true,
			manifest: { id: "epochgram", version: "0.4.3-test" },
			hasProAccess() {
				return this.proActive === true;
			},
			ensureTermSimilarityStoreLoaded: vi.fn(async () => {}),
			settings: {
				similarityThreshold: 0.79,
				similarityZeroShotMinScore: 0.1
			},
			indexer: {
				getIndexedPaths() {
					return ["f0.md"]; // provides a minimal vocabulary source
				},
				getFileEmbeddingTerm() {
					return "foo";
				},
				getFileIndexData() {
					return { embeddingTerm: "" };
				}
			},
			app: {
				vault: {
					getFiles() {
						return files as any;
					}
				}
			},
			shouldIndexFile() {
				return true;
			},
			queueVectorUpdate(path: string) {
				queuedVectors.push(path);
			},
			queueTermSimilarityUpdate(path: string) {
				queuedTopics.push(path);
			}
		};
		withTrustedPro(plugin);

		const p = runSimilarityStartupMaintenance(plugin);
		await vi.runAllTimersAsync();
		await p;
		await vi.runAllTimersAsync();

		expect(plugin.__epochDidSimilarityStartupMaintenance).toBe(true);
		expect(queuedVectors.length).toBe(files.length);
		expect(queuedTopics.length).toBe(mdFiles.length);
		expect(queuedTopics).not.toContain("notes/readme.txt");
		expect(queuedTopics).not.toContain("data/stuff.json");
		// Newest-first: files are sorted by mtime descending before enqueue/scanning.
		expect(queuedVectors[0]).toBe("f1200.md");
		expect(queuedVectors[queuedVectors.length - 1]).toBe("data/stuff.json");
		expect(queuedTopics[0]).toBe("f1200.md");
		expect(queuedTopics[queuedTopics.length - 1]).toBe("f0.md");
		expect(plugin.__epochHugeSimilarityBackfillFiles).toBeNull();
	});
});
