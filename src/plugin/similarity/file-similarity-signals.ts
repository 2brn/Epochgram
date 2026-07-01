import { TFile } from "obsidian";

export type SimilaritySignalName = "links" | "tags" | "titles" | "semantics" | "topics";

export const SIGNAL_LINKS = 1 << 0;
export const SIGNAL_TAGS = 1 << 1;
export const SIGNAL_TITLE = 1 << 2;
export const SIGNAL_SEMANTICS = 1 << 3;
export const SIGNAL_TOPICS = 1 << 4;
export const SIGNAL_ALL = SIGNAL_LINKS | SIGNAL_TAGS | SIGNAL_TITLE | SIGNAL_SEMANTICS | SIGNAL_TOPICS;

type FrontmatterLike = {
	similar?: unknown;
	nosimilar?: unknown;
};

type SimilaritySignalPluginLike = {
	app?: {
		vault?: {
			getAbstractFileByPath?: (path: string) => TFile | null | undefined;
		};
		metadataCache?: {
			getFileCache?: (file: TFile | null | undefined) => { frontmatter?: unknown } | null | undefined;
		};
	};
};

function hasOwn(obj: unknown, key: string): boolean {
	return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeSignalName(raw: unknown): SimilaritySignalName | "" {
	const s = (typeof raw === "string")
		? raw
		: (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint")
			? String(raw)
			: "";
	const normalized = s.trim().toLowerCase();
	if (!normalized) return "";
	if (normalized === "links") return "links";
	if (normalized === "tags") return "tags";
	if (normalized === "titles") return "titles";
	if (normalized === "semantics") return "semantics";
	if (normalized === "topics") return "topics";
	return "";
}

export function signalNameToMask(name: SimilaritySignalName): number {
	if (name === "links") return SIGNAL_LINKS;
	if (name === "tags") return SIGNAL_TAGS;
	if (name === "titles") return SIGNAL_TITLE;
	if (name === "semantics") return SIGNAL_SEMANTICS;
	return SIGNAL_TOPICS;
}

function maskFromSimilarList(values: unknown[]): number {
	let mask = 0;
	for (const v of values) {
		const norm = normalizeSignalName(v);
		if (!norm) continue;
		mask |= signalNameToMask(norm);
	}
	return mask;
}

function extractYamlFrontmatterBlock(rawText: string): string {
	try {
		const input = String(rawText ?? "");
		if (!input) return "";
		const normalized = input.replace(/^\uFEFF/, "");
		if (!/^---\r?\n/.test(normalized)) return "";
		const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/m.exec(normalized);
		return m ? String(m[1] ?? "") : "";
	} catch {
		return "";
	}
}

function parseYamlInlineList(raw: string): string[] {
	const s = String(raw ?? "").trim();
	if (!s) return [];
	if (s === "[]") return [];
	const m = /^\[(.*)\]$/.exec(s);
	if (!m) return [];
	const inner = String(m[1] ?? "").trim();
	if (!inner) return [];
	return inner
		.split(",")
		.map((x) => String(x ?? "").trim())
		.map((x) => x.replace(/^['"]|['"]$/g, "").trim())
		.filter(Boolean);
}

function parseYamlBlockList(lines: string[], startIndex: number): { values: string[]; endIndex: number } {
	const values: string[] = [];
	let i = startIndex;
	for (; i < lines.length; i++) {
		const line = String(lines[i] ?? "");
		if (!/^\s*-\s+/.test(line)) break;
		const v = line.replace(/^\s*-\s+/, "").trim();
		const cleaned = v.replace(/^['"]|['"]$/g, "").trim();
		if (cleaned) values.push(cleaned);
	}
	return { values, endIndex: i };
}

function resolveMaskFromFrontmatterObject(frontmatter: unknown): { mask: number; explicit: boolean } {
	try {
		if (hasOwn(frontmatter, "nosimilar")) return { mask: 0, explicit: true };
		if (!hasOwn(frontmatter, "similar")) return { mask: SIGNAL_ALL, explicit: false };

		const value = (frontmatter as FrontmatterLike).similar;
		if (Array.isArray(value)) return { mask: maskFromSimilarList(value), explicit: true };
		if (typeof value === "string") {
			const inline = parseYamlInlineList(value);
			if (inline.length > 0 || String(value).trim() === "[]" || String(value).trim() === "") {
				return { mask: maskFromSimilarList(inline), explicit: true };
			}
			return { mask: maskFromSimilarList([value]), explicit: true };
		}
		if (value == null) return { mask: 0, explicit: true };
		return { mask: 0, explicit: true };
	} catch {
		return { mask: SIGNAL_ALL, explicit: false };
	}
}

function resolveMaskFromRawText(rawText: string): { mask: number; explicit: boolean } {
	try {
		const block = extractYamlFrontmatterBlock(rawText);
		if (!block) return { mask: SIGNAL_ALL, explicit: false };
		const lines = block.split(/\r?\n/g);

		for (let i = 0; i < lines.length; i++) {
			const line = String(lines[i] ?? "");
			const nosim = /^\s*nosimilar\s*:/i.exec(line);
			if (nosim) return { mask: 0, explicit: true };
		}

		for (let i = 0; i < lines.length; i++) {
			const line = String(lines[i] ?? "");
			const m = /^\s*similar\s*:\s*(.*)$/i.exec(line);
			if (!m) continue;
			const rest = String(m[1] ?? "").trim();
			if (!rest) {
				const parsed = parseYamlBlockList(lines, i + 1);
				return { mask: maskFromSimilarList(parsed.values), explicit: true };
			}
			if (/^\[/.test(rest)) {
				const inline = parseYamlInlineList(rest);
				return { mask: maskFromSimilarList(inline), explicit: true };
			}
			return { mask: maskFromSimilarList([rest]), explicit: true };
		}

		return { mask: SIGNAL_ALL, explicit: false };
	} catch {
		return { mask: SIGNAL_ALL, explicit: false };
	}
}

export function getFileSimilaritySignalMask(plugin: unknown, fileOrPath: TFile | string, rawText?: string): number {
	try {
		const pluginLike = plugin as SimilaritySignalPluginLike;
		const file =
			typeof fileOrPath === "string" ? pluginLike.app?.vault?.getAbstractFileByPath?.(fileOrPath) : fileOrPath;
		const cache = pluginLike.app?.metadataCache?.getFileCache?.(file);
		const fm = cache?.frontmatter ?? null;
		const resolved = resolveMaskFromFrontmatterObject(fm);
		if (resolved.explicit) return resolved.mask;
	} catch {
		// ignore
	}

	if (rawText) {
		const resolved = resolveMaskFromRawText(rawText);
		if (resolved.explicit) return resolved.mask;
	}

	return SIGNAL_ALL;
}

export function canMatchBySignalMask(maskA: number, maskB: number, requiredSignalMask: number): boolean {
	return ((maskA & maskB) & requiredSignalMask) !== 0;
}
