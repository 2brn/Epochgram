import { describe, expect, test } from "vitest";
import { formatDate } from "../src/utils";
import { getEntriesForDate } from "../src/ui/entry-helpers";
import { withTrustedPro } from "./helpers/trusted-pro";

function makeCanvas(args: {
	index: any;
	searchQuery: string;
	term?: string;
	score?: number;
	min?: number;
}): any {
	return {
		index: args.index,
		showAttachments: true,
		showTrackedChanges: true,
		showHidden: true,
		showDraftOnly: false,
		showContentDates: true,
		epochsView: false,
		searchQuery: args.searchQuery,
		plugin: {
			hasProAccess: () => true,
			settings: { similarityZeroShotMinScore: args.min ?? 0.5 },
			termSimilarityLoaded: true,
			termSimilarityIndex: {
				files: {
					"a.md": { term: args.term ?? "project alpha", score: args.score ?? 0.9 }
				}
			},
			indexer: {
				getFileEmbeddingTerm: () => ""
			}
		}
	};
}

describe("entry helpers search includes inferred topic", () => {
	test("matches inferred topic when explicit topic is empty", () => {
		const date = new Date(2020, 0, 1);
		const key = formatDate(date);
		const entry = {
			date: key,
			file: "a.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "content",
			hidden: false
		};
		const canvas = makeCanvas({ index: { [key]: [entry] }, searchQuery: "alpha", term: "Project Alpha", score: 0.9, min: 0.5 });
		withTrustedPro(canvas.plugin);
		const got = getEntriesForDate(canvas, date);
		expect(got.length).toBe(1);
		expect(got[0]?.file).toBe("a.md");
	});

	test("does not match inferred topic below threshold", () => {
		const date = new Date(2020, 0, 1);
		const key = formatDate(date);
		const entry = {
			date: key,
			file: "a.md",
			blockStart: 0,
			blockEnd: 0,
			summary: "",
			source: "content",
			hidden: false
		};
		const canvas = makeCanvas({ index: { [key]: [entry] }, searchQuery: "alpha", term: "Project Alpha", score: 0.4, min: 0.5 });
		withTrustedPro(canvas.plugin);
		const got = getEntriesForDate(canvas, date);
		expect(got.length).toBe(0);
	});
});
