import { describe, expect, it } from "vitest";
import * as http from "http";
import { AiBridgeServer } from "../src/plugin/ai-bridge/server";

async function request(
	url: URL,
	method: "GET" | "POST"
): Promise<{ status: number; body: string }> {
	return await new Promise((resolve, reject) => {
		const req = http.request(
			{
				method,
				hostname: url.hostname,
				port: Number(url.port || 80),
				path: url.pathname + url.search,
				headers: method === "POST" ? { "content-type": "application/json" } : undefined
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (body += String(chunk)));
				res.on("end", () => resolve({ status: res.statusCode || 0, body }));
			}
		);
		req.on("error", reject);
		if (method === "POST") req.write("{}");
		req.end();
	});
}

describe("AI bridge /api/bye disconnect", () => {
	it("marks client disconnected immediately after bye", async () => {
		const pluginStub: any = { settings: {}, saveSettings: async () => {} };
		const server = new AiBridgeServer(pluginStub, () => {});
		await server.start();

		try {
			const base = new URL(server.getUrl());
			const token = String(base.searchParams.get("token") || "");
			expect(token.length > 0).toBe(true);

			const statusUrl = new URL(base.toString());
			statusUrl.pathname = "/api/status";
			statusUrl.search = `?token=${encodeURIComponent(token)}`;
			const statusRes = await request(statusUrl, "GET");
			expect(statusRes.status).toBe(200);
			expect(!!(server.getStatus() as any)?.clientConnected).toBe(true);

			const byeUrl = new URL(base.toString());
			byeUrl.pathname = "/api/bye";
			byeUrl.search = `?token=${encodeURIComponent(token)}`;
			const byeRes = await request(byeUrl, "POST");
			expect(byeRes.status).toBe(200);
			expect(!!(server.getStatus() as any)?.clientConnected).toBe(false);
		} finally {
			await server.stop();
		}
	});
});
