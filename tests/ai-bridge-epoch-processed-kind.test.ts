import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import https from "node:https";
import type { AiSummaryJob } from "../src/plugin/ai-bridge";
import { AiBridgeServer } from "../src/plugin/ai-bridge/server";

type HttpJsonResponse<T> = {
	ok: boolean;
	status: number;
	json: () => Promise<T>;
};

async function requestJson<T>(
	url: string,
	init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<HttpJsonResponse<T>> {
	const u = new URL(url);
	const lib = u.protocol === "https:" ? https : http;

	return await new Promise((resolve, reject) => {
		const req = lib.request(
			{
				protocol: u.protocol,
				hostname: u.hostname,
				port: u.port,
				path: `${u.pathname}${u.search}`,
				method: init?.method ?? "GET",
				headers: init?.headers
			},
			res => {
				const status = res.statusCode ?? 0;
				let data = "";
				res.setEncoding("utf8");
				res.on("data", chunk => (data += String(chunk ?? "")));
				res.on("end", () => {
					resolve({
						ok: status >= 200 && status < 300,
						status,
						json: async () => (data ? (JSON.parse(data) as T) : ({} as T))
					});
				});
			}
		);
		req.on("error", reject);
		if (init?.body != null) req.end(init.body);
		else req.end();
	});
}

describe("AI bridge epochProcessed counts only epoch jobs", () => {
	let server: AiBridgeServer | null = null;

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
	});

	it("does not include non-epoch jobs in epochProcessed", async () => {
		const pluginStub: any = { settings: {}, saveSettings: async () => {} };
		server = new AiBridgeServer(pluginStub, () => {});
		await server.start();

		const url = new URL(server.getUrl());
		const token = url.searchParams.get("token");
		expect(typeof token).toBe("string");
		expect(token && token.length > 0).toBe(true);

		const summaryJob: AiSummaryJob = {
			id: "s1",
			filePath: "A.md",
			kind: "content",
			date: "2026-01-01",
			blockStart: 0,
			blockEnd: 0,
			source: "content",
			input: "hello",
			context: "",
			inputHash: "h1",
			createdAt: Date.now()
		};
		const epochJob: AiSummaryJob = {
			id: "e1",
			filePath: "epoch://day/2026-01-01-2026-01-01",
			kind: "epoch",
			date: "2026-01-01",
			blockStart: 0,
			blockEnd: 0,
			source: "epoch",
			input: "world",
			context: "",
			inputHash: "h2",
			createdAt: Date.now(),
			epochBucket: "day",
			epochStart: "2026-01-01",
			epochEnd: "2026-01-01"
		};

		server.enqueue([summaryJob, epochJob]);

		const nextJobUrl = new URL("/api/nextJob", url.origin);
		nextJobUrl.searchParams.set("token", token!);
		const submitUrl = new URL("/api/submitResult", url.origin);
		submitUrl.searchParams.set("token", token!);

		const j1 = await (await requestJson<any>(nextJobUrl.toString())).json();
		const r1 = await requestJson<any>(submitUrl.toString(), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: j1.id, summary: "ok" })
		});
		expect(r1.ok).toBe(true);
		await r1.json();
		const j2 = await (await requestJson<any>(nextJobUrl.toString())).json();
		const r2 = await requestJson<any>(submitUrl.toString(), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: j2.id, summary: "ok" })
		});
		expect(r2.ok).toBe(true);
		await r2.json();

		const status = server.getStatus() as any;
		expect(status.done).toBe(2);
		expect(status.errors).toBe(0);
		expect(status.epochProcessed).toBe(1);
		expect(status.epochTotal).toBe(1);
	});
});
