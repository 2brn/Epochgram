type AiBridgeServerState = {
	token: string;
	port?: number;
};

export function sanitizeBridgeServerState(input: any): AiBridgeServerState | null {
	if (!input || typeof input !== "object") return null;
	const token = typeof (input as any).token === "string" ? String((input as any).token) : "";
	if (!token || token.length < 16 || token.length > 128) return null;
	const portRaw = (input as any).port;
	const port = typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.floor(portRaw) : null;
	const cleanPort = port != null && port >= 1024 && port <= 65535 ? port : undefined;
	return { token, port: cleanPort };
}

export function sanitizeBridgeOptions(input: any): {
	summaryCtxTemplate: string;
	epochCtxTemplate: string;
	summaryOutputLanguage: "en" | "es" | "ja";
	summaryExpectedInputLanguages: Array<"en" | "es" | "ja">;
	summaryExpectedContextLanguages: Array<"en" | "es" | "ja">;
	summaryType: "tldr" | "teaser" | "key-points" | "headline";
	summaryLength: "short" | "medium" | "long";
	epochOutputLanguage: "en" | "es" | "ja";
	epochExpectedInputLanguages: Array<"en" | "es" | "ja">;
	epochExpectedContextLanguages: Array<"en" | "es" | "ja">;
	epochType: "tldr" | "teaser" | "key-points" | "headline";
	epochLength: "short" | "medium" | "long";
} {
	const normalizeLang = (code: any): "en" | "es" | "ja" => {
		const raw = typeof code === "string" ? code : "";
		if (!raw) return "en";
		const base = raw.toLowerCase().split(/[-_]/)[0] || "en";
		if (base === "en" || base === "es" || base === "ja") return base;
		return "en";
	};

	const normalizeLangList = (raw: any, fallback: Array<"en" | "es" | "ja">): Array<"en" | "es" | "ja"> => {
		const arr: any[] = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
		const out: Array<"en" | "es" | "ja"> = [];
		const seen = new Set<string>();
		for (const item of arr) {
			const n = normalizeLang(item);
			if (seen.has(n)) continue;
			seen.add(n);
			out.push(n);
		}
		if (out.length) return out;
		const fb = Array.isArray(fallback) && fallback.length ? fallback : ["en"];
		return normalizeLangList(fb, ["en"]);
	};

	const normalizeSummarizerType = (raw: any): "tldr" | "teaser" | "key-points" | "headline" => {
		const v = typeof raw === "string" ? raw : "";
		if (v === "tldr" || v === "teaser" || v === "key-points" || v === "headline") return v;
		return "headline";
	};

	const normalizeSummarizerLength = (raw: any): "short" | "medium" | "long" => {
		const v = typeof raw === "string" ? raw : "";
		if (v === "short" || v === "medium" || v === "long") return v;
		return "long";
	};

	const pickString = (obj: any, k: string, maxLen: number): string | undefined => {
		const v = obj?.[k];
		if (typeof v !== "string") return undefined;
		return v.slice(0, maxLen);
	};

	const root: any = input && typeof input === "object" ? input : {};
	return {
		summaryCtxTemplate: pickString(root, "summaryCtxTemplate", 8000) ?? "",
		epochCtxTemplate: pickString(root, "epochCtxTemplate", 8000) ?? "",
		summaryOutputLanguage: normalizeLang(pickString(root, "summaryOutputLanguage", 32) ?? "en"),
		summaryExpectedInputLanguages: normalizeLangList(root.summaryExpectedInputLanguages, ["en", "ja", "es"]),
		summaryExpectedContextLanguages: normalizeLangList(root.summaryExpectedContextLanguages, ["en"]),
		summaryType: normalizeSummarizerType(pickString(root, "summaryType", 32) ?? "headline"),
		summaryLength: normalizeSummarizerLength(pickString(root, "summaryLength", 32) ?? "long"),
		epochOutputLanguage: normalizeLang(pickString(root, "epochOutputLanguage", 32) ?? "en"),
		epochExpectedInputLanguages: normalizeLangList(root.epochExpectedInputLanguages, ["en", "ja", "es"]),
		epochExpectedContextLanguages: normalizeLangList(root.epochExpectedContextLanguages, ["en"]),
		epochType: normalizeSummarizerType(pickString(root, "epochType", 32) ?? "key-points"),
		epochLength: normalizeSummarizerLength(pickString(root, "epochLength", 32) ?? "short")
	};
}
