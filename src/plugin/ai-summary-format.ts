import { sanitizeSummaryText } from "../utils";

export function formatAiSummaryOutput(rawSummary: string): string {
	const cleaned = sanitizeSummaryText(String(rawSummary || ""))
		.replace(/^\*\s+/gm, "")
		.trim();
	if (!cleaned) return "";

	const out = cleaned
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/\s+$/g, ""))
		.map((line) => {
			const s = String(line ?? "").trim();
			if (s.endsWith(".") && !s.endsWith("...")) return s.slice(0, -1);
			return s;
		})
		.join("\n")
		.trim();

	return out;
}
