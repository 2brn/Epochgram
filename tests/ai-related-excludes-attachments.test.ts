import { describe, expect, it } from "vitest";
import { getRelatedScoredForFile } from "../src/plugin/ai-summaries/related";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("AI related excludes attachments", () => {
	it("filters semantic related to likely-text file paths", async () => {
		const plugin: any = {
			hasProAccess: () => true,
			getSemanticRelatedScoredForFile: async () => ([
				{ path: "a.png", score: 0.99 },
				{ path: "b.md", score: 0.9 },
				{ path: "c.pdf", score: 0.8 },
				{ path: "d.txt", score: 0.7 },
				{ path: "e", score: 0.6 },
				{ path: "f.canvas", score: 0.5 }
			])
		};
		withTrustedPro(plugin);

		const scored = await getRelatedScoredForFile(plugin, "seed.md");
		expect(scored).toEqual([
			{ path: "b.md", score: 0.9 },
			{ path: "d.txt", score: 0.7 },
			{ path: "f.canvas", score: 0.5 }
		]);
	});
});
