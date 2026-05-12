import { describe, expect, it, vi } from "vitest";

vi.mock("../src/plugin/ai-summaries/bridge-server", () => {
	return {
		ensureAiBridgeServerRunning: vi.fn(async () => {}),
		maybeNudgeBridgeNotReady: vi.fn(() => {})
	};
});

vi.mock("../src/plugin/ai-summaries/file-jobs", () => {
	return {
		buildJobsForFile: vi.fn(async (_plugin: any, filePath: string) => {
			// Simulate work so the loop can be canceled mid-flight.
			await new Promise((r) => setTimeout(r, 5));
			return {
				jobs: [
					{
						id: `job-${filePath}`,
						filePath,
						kind: "summary",
						date: "",
						blockStart: 0,
						blockEnd: 0,
						source: "content",
						input: "x",
						inputHash: "h",
						createdAt: Date.now()
					}
				]
			};
		}),
		getIndexedPathsNewestFirst: vi.fn((_plugin: any) => ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"]),
		sortJobsNewestFirst: vi.fn((jobs: any[]) => jobs)
	};
});

vi.mock("../src/plugin/ai-summaries/indexer", () => {
	return {
		getIndexerInternals: vi.fn((_plugin: any) => ({ files: {} })),
		resolveTargetEntries: vi.fn(() => [])
	};
});

vi.mock("../src/plugin/notice-utils", () => {
	return {
		isUserEditingMarkdown: vi.fn(() => true)
	};
});

import { generateMissingAiSummariesForAllRecords } from "../src/plugin/ai-summaries/methods-summaries";
import { withTrustedPro } from "./helpers/trusted-pro";

describe("Generate missing AI summaries can be canceled", () => {
	it("stops enqueueing when cancel key changes", async () => {
		const enqueue = vi.fn((_jobs: any[]) => {
			const count = enqueue.mock.calls.length;
			if (count === 3) {
				plugin.__epochAiEnqueueCancelKey = (plugin.__epochAiEnqueueCancelKey || 0) + 1;
			}
		});

		const plugin: any = {
			__epochAiEnqueueCancelKey: 0,
			settings: {},
			app: {},
			hasProAccess: () => true,
			openAiBridgeWindow: vi.fn(async () => {}),
			aiBridge: {
				enqueue,
				getStatus: () => ({ clientConnected: true })
			}
		};
		withTrustedPro(plugin);

		await generateMissingAiSummariesForAllRecords.call(plugin);
		expect(enqueue.mock.calls.length).toBe(3);
	});
});
