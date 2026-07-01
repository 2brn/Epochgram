import { describe, expect, it, vi } from "vitest";
import { Platform, TFile } from "obsidian";
import { withTrustedPro } from "./helpers/trusted-pro";

// Create a fake TFile class that can be used for instanceof checks
class FakeTFile {
	path: string;
	stat: any;
	extension?: string;
	constructor(path: string, stat: any = {}) {
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

import { runSimilarityStartupMaintenance } from "../src/plugin/similarity/startup-maintenance";

describe("similarity: startup maintenance after Pro activation", () => {
	it("does not consume the guard while Free, and enqueues vectors after Pro becomes active", async () => {
		vi.useFakeTimers();
		Platform.isDesktopApp = true;
		Platform.isMobileApp = false;
		const queued: string[] = [];
		const mdFiles = [new FakeTFile("a.md"), new FakeTFile("b.md")];

		const plugin: any = {
			proActive: false,
			hasProAccess() {
				return this.proActive === true;
			},
			settings: {
				similarityThreshold: 0.79,
				similarityZeroShotMinScore: 0
			},
			app: {
				vault: {
					getFiles() {
						return mdFiles as any;
					}
				}
			},
			shouldIndexFile() {
				return true;
			},
			queueVectorUpdate(path: string) {
				queued.push(path);
			}
		};
		withTrustedPro(plugin, "0.4.3-test", { preserveHasProAccess: true });

		{
			const p = runSimilarityStartupMaintenance(plugin);
			await vi.runAllTimersAsync();
			await p;
			await vi.runAllTimersAsync();
		}
		expect(plugin.__epochDidSimilarityStartupMaintenance).toBeUndefined();
		expect(queued.length).toBe(0);

		plugin.proActive = true;
		{
			const p = runSimilarityStartupMaintenance(plugin);
			await vi.runAllTimersAsync();
			await p;
			await vi.runAllTimersAsync();
		}
		expect(plugin.__epochDidSimilarityStartupMaintenance).toBe(true);
		expect(queued).toEqual(["a.md", "b.md"]);

		queued.length = 0;
		await runSimilarityStartupMaintenance(plugin);
		expect(queued.length).toBe(0);

		// Reset-like behavior: clearing the guard should allow re-running maintenance.
		delete (plugin as any).__epochDidSimilarityStartupMaintenance;
		{
			const p = runSimilarityStartupMaintenance(plugin);
			await vi.runAllTimersAsync();
			await p;
			await vi.runAllTimersAsync();
		}
		expect(queued).toEqual(["a.md", "b.md"]);
		vi.useRealTimers();
	});
});
