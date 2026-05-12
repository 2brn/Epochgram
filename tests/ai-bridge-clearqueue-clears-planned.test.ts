import { describe, expect, it } from "vitest";
import * as http from "http";
import { AiBridgeServer } from "../src/plugin/ai-bridge/server";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(url: URL): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				method: "POST",
				hostname: url.hostname,
				port: Number(url.port || 80),
				path: url.pathname + url.search,
				headers: { "content-type": "application/json" }
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (body += String(chunk)));
				res.on("end", () => resolve({ status: res.statusCode || 0, body }));
			}
		);
		req.on("error", reject);
		req.write("{}");
		req.end();
	});
}

describe("AI bridge clearQueue clears planned work", () => {
	it("clears deferred epoch-after-AI regen and throttled enqueues", async () => {
		const pluginStub: any = { settings: {}, saveSettings: async () => {} };
		const server = new AiBridgeServer(pluginStub, () => {});
		await server.start();

		try {
			const base = new URL(server.getUrl());
			const token = base.searchParams.get("token");
			expect(typeof token).toBe("string");
			expect(token && token.length > 0).toBe(true);
			expect(!!(server.getStatus() as any)?.clientConnected).toBe(false);

			// Simulate planned epoch regeneration scheduled to run once AI becomes idle.
			let epochTicks = 0;
			pluginStub.__epochAiEnqueueCancelKey = 0;
			pluginStub.epochRegenAfterAiTimer = setInterval(() => {
				epochTicks++;
			}, 50);
			pluginStub.epochRegenAfterAiMode = "force";
			pluginStub.epochRegenAfterAiAll = true;
			pluginStub.epochRegenAfterAiDateKeys = new Set(["2026-01-17"]);
			pluginStub.epochRegenAfterAiBuckets = new Set(["week"]);
			pluginStub.epochRegenAfterAiBucketsQueue = ["2days", "week"];
			pluginStub.epochRegenAfterAiShowQueuedNotice = true;

			// Simulate per-file throttled enqueue (future planned queue).
			let throttleFired = false;
			const throttleTimer = setTimeout(() => {
				throttleFired = true;
			}, 200);
			pluginStub.aiSummaryPendingFiles = new Set(["foo.md"]);
			pluginStub.aiSummaryQueueRunning = true;
			pluginStub.aiSummaryEnqueueThrottleByFile = new Map([
				[
					"foo.md",
					{
						lastQueuedAt: Date.now(),
						timerId: throttleTimer,
						pendingJobs: [{ id: "j1", filePath: "foo.md", kind: "summary", input: "x" }]
					}
				]
			]);

			// Simulate reduce/chunk aggregation state that could enqueue follow-up reduce jobs.
			pluginStub.aiBridgeChunkGroups = new Map([["g1", { createdAt: Date.now() }]]);
			pluginStub.aiBridgeReduceFallbackByJobId = new Map([["r1", "fallback"]]);

			const clearUrl = new URL(base.toString());
			clearUrl.pathname = "/api/clearQueue";
			clearUrl.search = `?token=${encodeURIComponent(String(token))}`;
			const resp = await post(clearUrl);
			expect(resp.status).toBe(200);
			expect(!!(server.getStatus() as any)?.clientConnected).toBe(false);

			const ticksAfterClear = epochTicks;
			await sleep(320);
			expect(epochTicks).toBe(ticksAfterClear);
			expect(throttleFired).toBe(false);
			expect(pluginStub.__epochAiEnqueueCancelKey).toBe(1);
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
		} finally {
			// Ensure nothing leaks if assertions fail.
			try {
				if (pluginStub.epochRegenAfterAiTimer) clearInterval(pluginStub.epochRegenAfterAiTimer);
			} catch {}
			await server.stop();
		}
	});
});
