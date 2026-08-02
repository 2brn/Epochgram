import type { TFile } from "obsidian";

export interface FrontmatterSuppressionFlags {
	notracked: boolean;
	noparsed: boolean;
	noindex: boolean;
}

function hasOwn(obj: unknown, key: string): boolean {
	return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

type PluginLikeForFrontmatterFlags = {
	app?: {
		vault?: {
			getAbstractFileByPath?: (path: string) => unknown;
		};
		metadataCache?: {
			getFileCache?: (file: unknown) => { frontmatter?: Record<string, unknown> } | null;
		};
	};
};

function scanYamlFrontmatterHasKey(raw: string, key: string): boolean {
	try {
		const input = String(raw ?? "");
		if (!input) return false;
		const normalized = input.replace(/^\uFEFF/, "");
		if (!/^---\r?\n/.test(normalized)) return false;
		const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/m.exec(normalized);
		if (!m) return false;
		const body = String(m[1] ?? "");
		const re = new RegExp(`^\\s*${String(key).replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}\\s*:`, "i");
		for (const line of body.split(/\r?\n/g)) {
			if (re.test(String(line ?? ""))) return true;
		}
		return false;
	} catch {
		return false;
	}
}

export function resolveFrontmatterSuppressionFlags(
	plugin: unknown,
	fileOrPath: TFile | string,
	rawText?: string
): FrontmatterSuppressionFlags {
	const out: FrontmatterSuppressionFlags = { notracked: false, noparsed: false, noindex: false };
	try {
		const pluginState = plugin as PluginLikeForFrontmatterFlags;
		const file =
			typeof fileOrPath === "string"
				? pluginState?.app?.vault?.getAbstractFileByPath?.(fileOrPath)
				: fileOrPath;
		const cache = pluginState?.app?.metadataCache?.getFileCache?.(file);
		const fm = cache?.frontmatter ?? null;
		out.notracked = hasOwn(fm, "notracked");
		out.noparsed = hasOwn(fm, "noparsed") || hasOwn(fm, "nodates");
		out.noindex = hasOwn(fm, "noindex");
	} catch {
		// ignore
	}

	if (!out.notracked && rawText) out.notracked = scanYamlFrontmatterHasKey(rawText, "notracked");
	if (!out.noparsed && rawText) {
		out.noparsed = scanYamlFrontmatterHasKey(rawText, "noparsed") || scanYamlFrontmatterHasKey(rawText, "nodates");
	}
	if (!out.noindex && rawText) out.noindex = scanYamlFrontmatterHasKey(rawText, "noindex");

	return out;
}
