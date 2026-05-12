import { describe, expect, it } from "vitest";
import { applyMarkColorWithContext } from "../src/plugin/mark-context";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("marking a note similar to the active note", () => {
	it("anchors on the active note", async () => {
		const calls: Array<{ path: string; idx: number | null }> = [];
		const indexer: any = {
			isFileKnown: () => true,
			getFileMarkColor: () => null,
			setFileMarkColor: (path: string, idx: number | null) => {
				calls.push({ path, idx });
				return true;
			},
			getFileEmbeddingTerm: (path: string) => (path === "Bang.md" ? "!" : "")
		};

		const plugin: any = {
			indexer,
			settings: { similarityThreshold: 0.2 },
			hasProAccess: () => true,
			app: {
				workspace: {
					getActiveFile: () => ({ path: "Active.md" })
				}
			},
			shouldIndexFile: () => true,
			getSemanticRelatedPathsForFile: async () => new Set(["Bang.md"]),
			recomputeInheritedMarksNow: async () => {},
			clearInheritedMarksCache: () => {},
			refreshEpochViews: () => {},
			persistIndex: async () => {}
		};
		withTrustedPro(plugin);

		const changed = await applyMarkColorWithContext(plugin, { entryPath: "Bang.md", nextColorIndex: 3 });
		expect(changed).toBe(true);
		expect(calls).toEqual([{ path: "Active.md", idx: 3 }]);
	});
});
