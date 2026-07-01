type HeadersLike = Record<string, string | string[] | undefined>;

type RequestLike = {
	headers?: HeadersLike;
	url?: string;
	on(event: "data", listener: (chunk: unknown) => void): void;
	on(event: "end", listener: () => void): void;
	on(event: "error", listener: (error: Error) => void): void;
};

type ResponseLike = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function normalizeHeaderValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && typeof value[0] === "string") return value[0] ?? "";
	return "";
}

function chunkToText(chunk: unknown): string {
	if (typeof chunk === "string") return chunk;
	if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);
	if (chunk instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(chunk));
	return "";
}

function getOriginHeader(req: RequestLike): string {
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

export function applyBridgeCorsHeaders(req: RequestLike, res: ResponseLike): void {
	const origin = getOriginHeader(req);
	if (origin && isAllowedBridgeOrigin(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
	}
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	res.setHeader("Access-Control-Max-Age", "86400");
}

export function safeJson(req: RequestLike, res: ResponseLike, status: number, payload: unknown): void {
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

export async function readBody(req: RequestLike): Promise<string> {
	return await new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk: unknown) => {
			data += chunkToText(chunk);
			if (data.length > 2_000_000) {
				reject(new Error("Body too large"));
			}
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

export function getQueryToken(req: RequestLike): string {
	try {
		const u = new URL(req.url ?? "/", "http://127.0.0.1");
		return u.searchParams.get("token") ?? "";
	} catch {
		return "";
	}
}

export function sendHtml(res: ResponseLike, html: string): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(html);
}
