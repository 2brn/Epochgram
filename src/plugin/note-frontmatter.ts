import * as YAML from "yaml";
import { TFile } from "obsidian";
import { readFrontmatterProperty } from "./frontmatter-keys";

type FrontmatterRecord = Record<string, unknown>;

type FrontmatterApiPluginLike = {
	__epochNoteFrontmatterWritePaths?: Set<string>;
	app?: {
		fileManager?: {
			processFrontMatter?: (file: TFile, handler: (frontmatter: FrontmatterRecord) => void) => Promise<void>;
		};
		metadataCache?: {
			getFileCache?: (file: TFile) => { frontmatter?: unknown } | null | undefined;
		};
		vault?: {
			read?: (file: TFile) => Promise<string>;
			modify?: (file: TFile, data: string) => Promise<void>;
		};
	};
};

function normalizeValue(value: unknown): string {
	return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function normalizeComparableValue(value: unknown): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	return normalizeValue(value);
}

function splitLinesPreserveNewlines(text: string): { lines: string[]; newline: string } {
	const s = String(text ?? "");
	const newline = s.includes("\r\n") ? "\r\n" : "\n";
	const lines = newline === "\r\n" ? s.split("\r\n") : s.split("\n");
	return { lines, newline };
}

function findFrontmatterBounds(lines: string[]): { start: number; end: number } | null {
	const first = String(lines[0] ?? "").replace(/^\uFEFF/, "").trim();
	if (first !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		const t = String(lines[i] ?? "").trim();
		if (t === "---" || t === "...") {
			return { start: 0, end: i };
		}
	}
	return null;
}

function buildPropertyLines(propertyKey: string, value: unknown): string[] {
	const normalized = normalizeComparableValue(value);
	if (!normalized) return [];
	const yamlValue = typeof value === "boolean" ? value : normalized;
	const rendered = YAML.stringify({ [propertyKey]: yamlValue }, {
		lineWidth: 0,
		sortMapEntries: false,
		aliasDuplicateObjects: false,
		simpleKeys: false
	}).trim();
	return rendered ? rendered.split(/\r?\n/) : [];
}

function buildBarePropertyLines(propertyKey: string): string[] {
	const key = String(propertyKey ?? "").trim();
	if (!key) return [];
	return [`${key}:`];
}

function escapeRegexLiteral(value: string): string {
	return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPropertyInFrontmatterText(rawText: string, key: string): boolean {
	try {
		const text = String(rawText ?? "");
		const match = text.match(/^[\uFEFF]?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
		if (!match) return false;
		const lineRegex = new RegExp(`^\\s*${escapeRegexLiteral(key)}\\s*:`, "i");
		return String(match[1] ?? "")
			.split(/\r?\n/)
			.some((line) => lineRegex.test(String(line ?? "")));
	} catch {
		return false;
	}
}

function findPropertyRange(lines: string[], end: number, propertyKey: string): { start: number; end: number } | null {
	const lineRegex = new RegExp(`^\\s*${escapeRegexLiteral(propertyKey)}\\s*:\\s*(.*?)\\s*$`, "i");
	for (let i = 1; i < end; i++) {
		const line = String(lines[i] ?? "");
		const match = line.match(lineRegex);
		if (!match) continue;
		let last = i;
		const value = String(match[1] ?? "").trim();
		const isBlock = /^([>|])[+-]?\s*$/.test(value);
		if (isBlock) {
			for (let j = i + 1; j < end; j++) {
				const next = String(lines[j] ?? "");
				if (!next.trim()) {
					last = j;
					continue;
				}
				if (!/^\s+/.test(next)) break;
				last = j;
			}
		}
		return { start: i, end: last };
	}
	return null;
}

function upsertYamlProperty(raw: string, propertyKey: string, value: unknown): string {
	const normalized = normalizeValue(value);
	const propertyLines = buildPropertyLines(propertyKey, normalized);
	const { lines, newline } = splitLinesPreserveNewlines(raw);
	const bounds = findFrontmatterBounds(lines);

	if (!bounds) {
		if (propertyLines.length === 0) return raw;
		return ["---", ...propertyLines, "---", "", ...lines].join(newline);
	}

	const nextLines = lines.slice();
	const range = findPropertyRange(nextLines, bounds.end, propertyKey);
	if (range) {
		nextLines.splice(range.start, range.end - range.start + 1);
	}
	if (propertyLines.length > 0) {
		nextLines.splice(1, 0, ...propertyLines);
	}

	if (propertyLines.length === 0) {
		const remaining = nextLines.slice(1, bounds.end).filter((line) => String(line ?? "").trim());
		if (remaining.length === 0) {
			const after = nextLines.slice(bounds.end + 1).join(newline);
			return after ? after.replace(/^\r?\n/, "") : "";
		}
	}

	return nextLines.join(newline);
}

function upsertYamlBareProperty(raw: string, propertyKey: string, present: boolean): string {
	const { lines, newline } = splitLinesPreserveNewlines(raw);
	const bounds = findFrontmatterBounds(lines);
	if (!present) {
		if (!bounds) return raw;
		const nextLines = lines.slice();
		const range = findPropertyRange(nextLines, bounds.end, propertyKey);
		if (range) nextLines.splice(range.start, range.end - range.start + 1);
		const remaining = nextLines.slice(1, bounds.end).filter((line) => String(line ?? "").trim());
		if (remaining.length === 0) {
			const after = nextLines.slice(bounds.end + 1).join(newline);
			return after ? after.replace(/^\r?\n/, "") : "";
		}
		return nextLines.join(newline);
	}

	const bareLines = buildBarePropertyLines(propertyKey);
	if (!bounds) {
		return ["---", ...bareLines, "---", "", ...lines].join(newline);
	}
	const nextLines = lines.slice();
	const range = findPropertyRange(nextLines, bounds.end, propertyKey);
	if (range) nextLines.splice(range.start, range.end - range.start + 1);
	nextLines.splice(1, 0, ...bareLines);
	return nextLines.join(newline);
}

export function readYamlPropertyFromText(rawText: string, key: string): string {
	try {
		const text = String(rawText ?? "");
		const match = text.match(/^[\uFEFF]?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
		if (!match) return "";
		const frontmatter = YAML.parse(String(match[1] ?? "")) as FrontmatterRecord | null;
		const value = readFrontmatterProperty(frontmatter, key);
		if (typeof value === "string") return normalizeValue(value);
		if (value == null) return "";
		return normalizeValue(String(value));
	} catch {
		return "";
	}
}

async function readCurrentYamlProperty(plugin: unknown, file: TFile, key: string): Promise<string> {
	const value = await readCurrentYamlPropertyValue(plugin, file, key);
	if (typeof value === "string") return normalizeValue(value);
	if (value == null) return "";
	return normalizeValue(String(value));
}

async function readCurrentYamlPropertyValue(plugin: unknown, file: TFile, key: string): Promise<unknown> {
	if (String(key ?? "").trim().toLowerCase() === "pin") {
		try {
			const cache = (plugin as FrontmatterApiPluginLike).app?.metadataCache?.getFileCache?.(file);
			if (cache?.frontmatter && typeof cache.frontmatter === "object" && cache.frontmatter !== null) {
				if (Object.prototype.hasOwnProperty.call(cache.frontmatter, key)) return true;
			}
		} catch {
			// ignore
		}
		try {
			const raw = await (plugin as FrontmatterApiPluginLike).app?.vault?.read?.(file);
			return hasPropertyInFrontmatterText(String(raw ?? ""), key);
		} catch {
			return false;
		}
	}
	try {
		const cache = (plugin as FrontmatterApiPluginLike).app?.metadataCache?.getFileCache?.(file);
		const raw = readFrontmatterProperty(cache?.frontmatter, key);
		if (raw != null) return raw;
	} catch {
		// ignore
	}
	try {
		const raw = await (plugin as FrontmatterApiPluginLike).app?.vault?.read?.(file);
		const text = String(raw ?? "");
		const match = text.match(/^[\uFEFF]?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
		if (!match) return null;
		const frontmatter = YAML.parse(String(match[1] ?? "")) as FrontmatterRecord | null;
		return readFrontmatterProperty(frontmatter, key);
	} catch {
		return null;
	}
}

async function updateYamlPropertyWithObsidianApi(plugin: unknown, file: TFile, key: string, value: unknown): Promise<boolean> {
	if (String(key ?? "").trim().toLowerCase() === "pin") return false;
	const app = (plugin as FrontmatterApiPluginLike).app;
	const fmApi = app?.fileManager?.processFrontMatter;
	if (typeof fmApi !== "function") return false;
	let changed = false;
	const normalized = normalizeComparableValue(value);
	const yamlValue = typeof value === "boolean" ? value : normalized;
	await fmApi(file, (fm: FrontmatterRecord) => {
		const prevRaw = readFrontmatterProperty(fm, key);
		const prev = typeof value === "boolean" ? prevRaw : normalizeComparableValue(prevRaw);
		if (prev === (typeof value === "boolean" ? value : normalized)) return;
		if (!normalized) delete fm[key];
		else fm[key] = yamlValue as never;
		changed = true;
	});
	return changed;
}

function markFrontmatterWritePath(plugin: unknown, path: string): void {
	try {
		const state = plugin as FrontmatterApiPluginLike;
		if (!(state.__epochNoteFrontmatterWritePaths instanceof Set)) {
			state.__epochNoteFrontmatterWritePaths = new Set<string>();
		}
		const p = String(path || "").trim();
		if (p) state.__epochNoteFrontmatterWritePaths.add(p);
	} catch {
		// ignore
	}
}

export function consumeNoteFrontmatterWritePath(plugin: unknown, path: string): boolean {
	try {
		const state = plugin as FrontmatterApiPluginLike;
		const p = String(path || "").trim();
		if (!p || !(state.__epochNoteFrontmatterWritePaths instanceof Set)) return false;
		const had = state.__epochNoteFrontmatterWritePaths.has(p);
		if (had) state.__epochNoteFrontmatterWritePaths.delete(p);
		return had;
	} catch {
		return false;
	}
}

export async function getYamlPropertyForFile(plugin: unknown, file: TFile, key: string): Promise<string> {
	return await readCurrentYamlProperty(plugin, file, key);
}

export async function setYamlPropertyForFile(plugin: unknown, file: TFile, key: string, value: unknown): Promise<boolean> {
	const normalized = normalizeComparableValue(value);
	const prevValue = await readCurrentYamlPropertyValue(plugin, file, key);
	const same = typeof value === "boolean"
		? prevValue === value
		: normalizeComparableValue(prevValue) === normalized;
	if (same) return false;
	markFrontmatterWritePath(plugin, file.path);
	const isPin = String(key ?? "").trim().toLowerCase() === "pin";

	try {
		if (!isPin && await updateYamlPropertyWithObsidianApi(plugin, file, key, value)) return true;
	} catch {
		// ignore
	}

	try {
		const raw = await (plugin as FrontmatterApiPluginLike).app?.vault?.read?.(file);
		const next = isPin
			? upsertYamlBareProperty(String(raw ?? ""), key, value === true)
			: upsertYamlProperty(String(raw ?? ""), key, value);
		if (next === String(raw ?? "")) return false;
		await (plugin as FrontmatterApiPluginLike).app?.vault?.modify?.(file, next);
		return true;
	} catch {
		return false;
	}
}
