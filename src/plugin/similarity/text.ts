import { MarkdownView, TFile } from "obsidian";
import type { EpochPlugin } from "../../main";
import { gatherFileEntries } from "../../indexer/entry-state";
import { SIMILARITY_CONTENT_MAX_CHARS, TOPIC_CANDIDATE_MAX_CHARS } from "./config";

export function getPreferredSimilarityText(plugin: EpochPlugin, filePath: string): string {
	try {
		const idxAny: any = (plugin as any)?.indexer as any;
		const data = idxAny.getFileIndexData(filePath);
		if (!data) return "";
		const entries = gatherFileEntries(data as any);
		if (!Array.isArray(entries) || entries.length === 0) return "";

		const pickBest = (getText: (e: any) => string): string => {
			let bestText = "";
			let bestKey = "";
			for (const e of entries) {
				if (!e) continue;
				const txt = getText(e);
				if (!txt) continue;
				const date = typeof (e as any)?.date === "string" ? String((e as any).date) : "";
				const bs = Number((e as any)?.blockStart ?? 0);
				const be = Number((e as any)?.blockEnd ?? 0);
				const key = `${date}|${String(Math.floor(bs)).padStart(8, "0")}|${String(Math.floor(be)).padStart(8, "0")}`;
				if (!bestKey || key > bestKey) {
					bestKey = key;
					bestText = txt;
				}
			}
			return bestText;
		};

		const ai = pickBest((e) => {
			const s = typeof (e as any)?.aiSummary === "string" ? String((e as any).aiSummary).trim() : "";
			return s;
		});
		if (ai) return ai;

		return "";
	} catch {
		return "";
	}
}

export function stripFrontmatter(text: string): string {
	try {
		return String(text || "").replace(/^---\n[\s\S]*?\n---\n?/m, "");
	} catch {
		return String(text || "");
	}
}

export function clampSimilarityContent(text: string, maxChars: number = SIMILARITY_CONTENT_MAX_CHARS): string {
	const body = String(text || "").trim();
	if (!body) return "";
	return body.length > maxChars ? body.slice(0, maxChars) : body;
}

export function chunkText(raw: string, maxChars: number): string[] {
	const text = String(raw || "").trim();
	if (!text) return [];
	const limit = Number.isFinite(maxChars) ? Math.max(200, Math.floor(maxChars)) : 3500;
	if (text.length <= limit) return [text];

	const paragraphs = text.split(/\n\s*\n/g);
	const chunks: string[] = [];
	let buf = "";
	for (const p of paragraphs) {
		const para = p.trim();
		if (!para) continue;
		if (!buf) {
			buf = para;
			continue;
		}
		if (buf.length + 2 + para.length <= limit) {
			buf += "\n\n" + para;
			continue;
		}
		chunks.push(buf);
		buf = para;
	}
	if (buf) chunks.push(buf);

	const finalChunks: string[] = [];
	for (const c of chunks) {
		if (c.length <= limit) {
			finalChunks.push(c);
			continue;
		}
		for (let i = 0; i < c.length; i += limit) {
			finalChunks.push(c.slice(i, i + limit));
		}
	}
	return finalChunks;
}

export async function buildZeroShotCandidateText(plugin: EpochPlugin, file: TFile): Promise<string> {
	let baseText = "";
	try {
		const view = plugin.app.workspace.getActiveViewOfType?.(MarkdownView);
		if (view?.file?.path === file.path) {
			const live = (view as any)?.editor?.getValue?.();
			if (typeof live === "string") {
				baseText = stripFrontmatter(live);
			}
		}
	} catch {
		baseText = "";
	}

	if (!baseText) {
		try {
			baseText = getPreferredSimilarityText(plugin, file.path);
		} catch {
			baseText = "";
		}
	}

	if (!baseText) {
		try {
			baseText = await plugin.app.vault.read(file);
			baseText = stripFrontmatter(baseText);
		} catch {
			baseText = "";
		}
	}

	const body = String(baseText || "");

	const pickHeadings = (text: string, maxCount: number): string[] => {
		const out: string[] = [];
		try {
			const lines = String(text || "").split(/\r?\n/);
			for (const line of lines) {
				if (out.length >= maxCount) break;
				const m = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
				if (!m) continue;
				const h = String(m[1] || "").trim();
				if (!h) continue;
				out.push(h);
			}
		} catch {
			// ignore
		}
		return out;
	};

	const pickHighlights = (text: string, maxCount: number): string[] => {
		const out: string[] = [];
		const seen = new Set<string>();
		try {
			const re = /==([\s\S]*?)==/g;
			let m: RegExpExecArray | null;
			while ((m = re.exec(String(text || "")))) {
				if (out.length >= maxCount) break;
				let s = String(m[1] || "");
				s = s.replace(/\s+/g, " ").trim();
				if (!s) continue;
				if (s.length > 140) s = s.slice(0, 140);
				if (seen.has(s)) continue;
				seen.add(s);
				out.push(s);
			}
		} catch {
			// ignore
		}
		return out;
	};

	const headings = pickHeadings(body, 12);
	const highlights = pickHighlights(body, 20);
	const structuredMain = [
		headings.length ? ("Headings:\n" + headings.map((h) => "- " + h).join("\n")) : "",
		highlights.length ? ("Highlights:\n" + highlights.map((h) => "- " + h).join("\n")) : ""
	].filter(Boolean).join("\n\n");

	let clipped = clampSimilarityContent(structuredMain, TOPIC_CANDIDATE_MAX_CHARS);
	if (!headings.length && !highlights.length) {
		// Fallback for plain notes: include a short body snippet so classification isn't empty.
		const fallbackBody = clampSimilarityContent(body, Math.min(SIMILARITY_CONTENT_MAX_CHARS, TOPIC_CANDIDATE_MAX_CHARS));
		clipped = clampSimilarityContent(fallbackBody, TOPIC_CANDIDATE_MAX_CHARS);
	}

	return clipped;
}
