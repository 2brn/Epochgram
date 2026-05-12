import { sanitizeSummaryText } from "../utils";

export function formatEpochSummaryForIndex(rawSummary: string): string {
	const summary = sanitizeSummaryText(String(rawSummary || ""))
		.replace(/^\*\s+/gm, "")
		.trim();
	if (!summary) return "";

	// Preserve line breaks (user-requested). Normalize CRLF to LF and trim trailing spaces per line.
	let out = summary
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map(line => line.replace(/\s+$/g, ""))
		.join("\n")
		.trim();

	// Remove generic leading meta phrases that models sometimes emit.
	// Keep this conservative: only strip when it appears as a prefix of the whole summary.
	out = out.replace(
		/^\s*(?:note\s+about|notes\s+about|entry\s+about|entries\s+about|this\s+note|this\s+entry|text\s+covers|noted|mentioned|observed)\b\s*[:\-\u2014,]*\s*/i,
		""
	);

	// Collapse excessive blank lines (keep at most one empty line in a row).
	out = out.replace(/\n{3,}/g, "\n\n");

	// Strip decorative punctuation at the very start/end of the summary.
	// Keep normal sentence-ending punctuation like '.', '!', '?'.
	const lines = out.split("\n");
	let first = -1;
	let last = -1;
	for (let i = 0; i < lines.length; i++) {
		if (String(lines[i] ?? "").trim()) {
			first = i;
			break;
		}
	}
	for (let i = lines.length - 1; i >= 0; i--) {
		if (String(lines[i] ?? "").trim()) {
			last = i;
			break;
		}
	}
	if (first >= 0 && last >= 0) {
		lines[first] = String(lines[first] ?? "")
			.replace(/^[\s\-–—•⸱*"'“”‘’([{[<:;,.]+\s*/g, "")
			.trimStart();
		lines[last] = String(lines[last] ?? "")
			.replace(/\s*[\s\-–—•⸱*"'“”‘’)\]}>:;,]+$/g, "")
			.trimEnd();
		out = lines.join("\n");
	}

	// Ensure the first alphabetic character is uppercase.
	out = out.replace(/^[^A-Za-z]*[a-z]/, (m) => m.toUpperCase());

	// epochs output conventions:
	// - Replace ';' with newlines (treat as a line separator), without creating blank/duplicate lines.
	// - Split sentences into their own lines.
	// - Remove trailing '.' on every line.
	// - For lines 2-3 (and beyond), replace ':' with ',' (line 1 keeps its ':' topic form).
	{
		const rawLines = out.split("\n");
		const expanded: string[] = [];
		const pushSentenceParts = (raw: string): void => {
			const s = String(raw ?? "").trim();
			if (!s) return;

			// Split sentences on '.', '!', '?' when followed by whitespace or end-of-line.
			// Keep this conservative: don't split on '.' when it's likely a decimal (next char is a digit).
			let start = 0;
			for (let i = 0; i < s.length; i++) {
				const ch = s[i] ?? "";
				if (ch !== "." && ch !== "!" && ch !== "?") continue;
				const next = s[i + 1];
				if (ch === "." && typeof next === "string" && /\d/.test(next)) continue;
				if (next != null && typeof next === "string" && !/\s/.test(next)) continue;
				const piece = s.slice(start, i).trim();
				if (piece) expanded.push(piece);
				start = i + 1;
			}
			const tail = s.slice(start).trim();
			if (tail) expanded.push(tail);
		};
		for (const line of rawLines) {
			const raw = String(line ?? "");
			if (!raw.trim()) {
				expanded.push("");
				continue;
			}
			const parts = raw.split(/\s*;\s*/g);
			if (parts.length <= 1) {
				pushSentenceParts(raw);
				continue;
			}
			for (const p of parts) {
				const t = String(p ?? "").trim();
				if (!t) continue;
				pushSentenceParts(t);
			}
		}

		const lines2 = expanded
			.map((line, i) => {
				let s = String(line ?? "").trim();
				if (i >= 1) s = s.replace(/:/g, ",");
				if (s.endsWith(".") && !s.endsWith("...")) s = s.slice(0, -1);
				return s;
			})
			.join("\n")
			.replace(/\n{2,}/g, "\n")
			.trim();
		out = lines2;
	}

	return out.trim();
}
