import { describe, expect, it } from "vitest";

import { AiBridgeServer } from "../src/plugin/ai-bridge/server";
import { requestCancelEpochTask } from "../src/plugin/progress";

describe("AI progress cancel", () => {
	it("clears AI bridge queue", async () => {
		const pluginStub: any = {
			settings: {},
			saveSettings: async () => {},
			// No status bar element in tests; progress.ts should no-op on UI.
		};
		const server = new AiBridgeServer(pluginStub, () => {});
		pluginStub.aiBridge = server;

		server.enqueue([
			{
				id: "j1",
				filePath: "foo.md",
				kind: "content",
				date: "2026-02-22",
				blockStart: 0,
				blockEnd: 1,
				source: "content",
				input: "hello",
				context: "",
				inputHash: "h1",
				createdAt: Date.now()
			},
			{
				id: "j2",
				filePath: "bar.md",
				kind: "epoch",
				date: "2026-02-22",
				blockStart: 0,
				blockEnd: 1,
				source: "content",
				input: "world",
				context: "",
				inputHash: "h2",
				createdAt: Date.now(),
				epochBucket: "day",
				epochStart: "2026-02-22",
				epochEnd: "2026-02-22"
			}
		] as any);

		expect(server.getStatus().queued).toBe(2);
		expect(server.getStatus().inProgress).toBe(0);

		requestCancelEpochTask(pluginStub, "ai" as any);

		expect(server.getStatus().queued).toBe(0);
		expect(server.getStatus().inProgress).toBe(0);
		expect(Number(pluginStub.__epochAiEnqueueCancelKey ?? 0)).toBeGreaterThan(0);
	});

	it("clears planned AI work even without aiBridge", async () => {
		let throttleFired = false;
		const throttleTimer = setTimeout(() => {
			throttleFired = true;
		}, 120);

		const epochTimer = setInterval(() => {
			// noop
		}, 50);

		const pluginStub: any = {
			settings: {},
			saveSettings: async () => {},
			epochRegenAfterAiTimer: epochTimer,
			epochRegenAfterAiMode: "force",
			epochRegenAfterAiAll: true,
			epochRegenAfterAiDateKeys: new Set(["2026-02-22"]),
			epochRegenAfterAiBuckets: new Set(["week"]),
			epochRegenAfterAiBucketsQueue: ["2days", "week"],
			epochRegenAfterAiShowQueuedNotice: true,
			aiSummaryPendingFiles: new Set(["foo.md"]),
			aiSummaryQueueRunning: true,
			aiSummaryEnqueueThrottleByFile: new Map([
				[
					"foo.md",
					{
						lastQueuedAt: Date.now(),
						timerId: throttleTimer,
						pendingJobs: [{ id: "j1", filePath: "foo.md", kind: "summary", input: "x" }]
					}
				]
			]),
			aiBridgeChunkGroups: new Map([["g1", { createdAt: Date.now() }]]),
			aiBridgeReduceFallbackByJobId: new Map([["r1", "fallback"]])
		};

		requestCancelEpochTask(pluginStub, "ai" as any);

		expect(Number(pluginStub.__epochAiEnqueueCancelKey ?? 0)).toBe(1);
		expect(pluginStub.aiSummaryPendingFiles instanceof Set).toBe(true);
		expect(pluginStub.aiSummaryPendingFiles.size).toBe(0);
		expect(pluginStub.aiSummaryQueueRunning).toBe(false);

		expect(pluginStub.epochRegenAfterAiTimer).toBe(null);
		expect(pluginStub.epochRegenAfterAiMode).toBe(null);
		expect(pluginStub.epochRegenAfterAiAll).toBe(false);
		expect(pluginStub.epochRegenAfterAiDateKeys).toBe(null);
		expect(pluginStub.epochRegenAfterAiBuckets).toBe(null);
		expect(pluginStub.epochRegenAfterAiBucketsQueue).toBe(null);
		expect(pluginStub.epochRegenAfterAiShowQueuedNotice).toBe(false);

		expect(pluginStub.aiSummaryEnqueueThrottleByFile?.size ?? 0).toBe(0);
		expect(pluginStub.aiBridgeChunkGroups?.size ?? 0).toBe(0);
		expect(pluginStub.aiBridgeReduceFallbackByJobId?.size ?? 0).toBe(0);

		await new Promise((resolve) => setTimeout(resolve, 180));
		expect(throttleFired).toBe(false);
	});
});
