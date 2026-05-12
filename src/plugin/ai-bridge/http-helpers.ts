function normalizeHeaderValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && typeof value[0] === "string") return value[0]!;
	return "";
}

function getOriginHeader(req: any): string {
	try {
		return normalizeHeaderValue(req?.headers?.origin ?? req?.headers?.Origin).trim();
	} catch {
		return "";
	}
}

function isAllowedBridgeOrigin(origin: string): boolean {
	const raw = String(origin ?? "").trim();
	if (!raw) return false;
	if (raw === "app://obsidian.md") return true;
	try {
		const u = new URL(raw);
		if (u.protocol === "app:" && u.hostname.toLowerCase() === "obsidian.md") return true;
		if (u.protocol !== "http:" && u.protocol !== "https:") return false;
		const host = u.hostname.toLowerCase();
		return host === "127.0.0.1" || host === "localhost" || host === "::1";
	} catch {
		return false;
	}
}

export function applyBridgeCorsHeaders(req: any, res: any): void {
	const origin = getOriginHeader(req);
	if (origin && isAllowedBridgeOrigin(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
	}
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	res.setHeader("Access-Control-Max-Age", "86400");
}

export function safeJson(req: any, res: any, status: number, payload: any): void {
	const body = JSON.stringify(payload);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	try {
		applyBridgeCorsHeaders(req, res);
	} catch {
		// ignore
	}
	res.end(body);
}

export async function readBody(req: any): Promise<string> {
	return await new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk: any) => {
			data += chunk;
			if (data.length > 2_000_000) {
				reject(new Error("Body too large"));
			}
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

export function getQueryToken(req: any): string {
	try {
		const u = new URL(req.url ?? "/", "http://127.0.0.1");
		return u.searchParams.get("token") ?? "";
	} catch {
		return "";
	}
}

export function sendHtml(res: any, html: string): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(html);
}
