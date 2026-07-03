import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Platform, TFile } from "obsidian";
import { withTrustedPro } from "./helpers/trusted-pro";

const progressTexts: string[] = [];

vi.mock("../src/plugin/progress", () => {
	return {
		announceEpochDesktopTaskAfter: vi.fn(),
		cancelEpochDesktopTaskAnnouncement: vi.fn(),
		clearEpochProgress: vi.fn(),
		consumeCancelRequested: vi.fn(() => false),
		setEpochProgress: vi.fn((_plugin: any, _kind: any, text: string) => {
			progressTexts.push(String(text));
		})
	};
});

vi.mock("../src/plugin/notice-utils", () => {
	return {
		isUserEditingMarkdown: vi.fn(() => false)
	};
});

vi.mock("../src/plugin/similarity/config", () => {
	return {
		isSimilarityEnabled: vi.fn(() => true),
		isTopicSimilarityEnabled: vi.fn(() => true)
	};
});

vi.mock("../src/plugin/similarity/notice", () => {
	return {
		shouldAllowSimilarityProgressNotice: vi.fn(() => true),
		shouldShowTermSimilarityUpdateNotice: vi.fn(() => true)
	};
});

vi.mock("../src/plugin/similarity/worker-factory", () => {
	return {
		getSimilarityWorker: vi.fn(() => ({}))
	};
});

vi.mock("../src/plugin/similarity/topic", () => {
	return {
		getEmbeddingTermForPath: vi.fn(() => ""),
		getTermVocabulary: vi.fn(() => ({ terms: ["foo"], sig: "v1" }))
	};
});

vi.mock("../src/plugin/similarity/text", () => {
	return {
		buildZeroShotCandidateText: vi.fn(async () => "# Title\n\nBody")
	};
});

vi.mock("../src/plugin/similarity-term-store", () => {
	return {
		ensureTermStoreFileExists: vi.fn(async () => {}),
		readTermStore: vi.fn(async () => ({ model: "zeroshot", files: {} })),
		writeTermStore: vi.fn(async () => {})
	};
});

let injected = false;
vi.mock("../src/plugin/similarity/worker-zeroshot", () => {
	return {
		loadZeroShotModelViaWorker: vi.fn(async () => true),
		zeroShotScoreLabelsViaWorker: vi.fn(async (plugin: any) => {
			if (!injected) {
				injected = true;
				if (!(plugin.termSimilarityPendingFiles instanceof Set)) {
					plugin.termSimilarityPendingFiles = new Set<string>();
				}
				plugin.termSimilarityPendingFiles.add("b.md");
			}
			return { labels: ["foo"], scores: [0.9] };
		})
	};
});

vi.mock("../src/utils", async (importOriginal) => {
	const actual = await importOriginal<any>();
	return {
		...actual,
		computeAiSummaryInputHash: vi.fn(() => "h")
	};
});

import { processPendingTermSimilarityQueue } from "../src/plugin/similarity/topic-queue";

describe("topics progress batching", () => {
	beforeEach(() => {
		progressTexts.length = 0;
		injected = false;
		Platform.isDesktop = true;
		Platform.isMobile = false;
		vi.useFakeTimers();
		(globalThis as any).window = globalThis as any;
	});

	afterEach(async () => {
		try {
			await vi.runOnlyPendingTimersAsync();
		} catch {
			// ignore
		}
		vi.useRealTimers();
	});

	it("shows live totals when new work is enqueued mid-run", async () => {
		const fileA: any = new TFile("a.md", { extension: "md", stat: { ctime: 0, mtime: 1, size: 0 } });
		const fileB: any = new TFile("b.md", { extension: "md", stat: { ctime: 0, mtime: 2, size: 0 } });
		const filesByPath = new Map<string, any>([
			["a.md", fileA],
			["b.md", fileB]
		]);

		const plugin: any = {
			hasProAccess: () => true,
			shouldIndexFile: () => true,
			app: {
				vault: {
					getAbstractFileByPath: (p: string) => filesByPath.get(p) ?? null
				}
			},
			indexer: {
				getFileIndexData: () => null
			}
		};
		withTrustedPro(plugin);

		plugin.termSimilarityPendingFiles = new Set<string>(["a.md"]);

		await processPendingTermSimilarityQueue(plugin);
		if (plugin.termSimilarityQueueTimer) {
			clearTimeout(plugin.termSimilarityQueueTimer);
			plugin.termSimilarityQueueTimer = null;
		}

		await processPendingTermSimilarityQueue(plugin);
		if (plugin.termSimilarityQueueTimer) {
			clearTimeout(plugin.termSimilarityQueueTimer);
			plugin.termSimilarityQueueTimer = null;
		}

		const topicsProgress = progressTexts.filter((t) => t.startsWith("Topics…"));
		expect(topicsProgress).toEqual(["Topics… 1/1", "Topics… 2/2"]);
	});
});
