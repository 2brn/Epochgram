import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import https from "node:https";
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

describe("AI bridge nextJob resume", () => {
	let server: AiBridgeServer | null = null;

	afterEach(async () => {
		if (server) {
			await server.stop();
			server = null;
		}
	});

	it("returns an in-progress job when pending is empty", async () => {
		const pluginStub: any = { settings: {}, saveSettings: async () => {} };
		server = new AiBridgeServer(pluginStub, () => {});
		await server.start();

		const url = new URL(server.getUrl());
		const token = url.searchParams.get("token");
		expect(typeof token).toBe("string");
		expect(token && token.length > 0).toBe(true);

		const job: any = { id: "j1", kind: "summary", filePath: "A.md", input: "hello world" };
		(server as any).inProgress.set(job.id, job);
		(server as any).inProgressTokens = 10;

		const nextJobUrl = new URL("/api/nextJob", url.origin);
		nextJobUrl.searchParams.set("token", token!);
		const res = await requestJson<any>(nextJobUrl.toString());
		expect(res.ok).toBe(true);
		const body: any = await res.json();
		expect(body && body.id).toBe("j1");
		expect((server as any).inProgress.size).toBe(1);
	});
});
