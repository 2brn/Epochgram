import { TFile } from "obsidian";
import type { EpochPlugin } from "../main";
import { extractFrontmatterDescription } from "../indexer/summarizer";
import {
	buildFrontmatterPropertyLineRegex,
	getYamlDescriptionPropertyKey,
	readFrontmatterProperty,
} from "./frontmatter-keys";

export interface DescriptionFrontmatterMethods {
	getYamlDescriptionForPath(path: string): Promise<string>;
	getYamlDescriptionForFile(file: TFile): Promise<string>;
	setYamlDescriptionForPath(path: string, description: string): Promise<boolean>;
	setYamlDescriptionForFile(file: TFile, description: string): Promise<boolean>;
}

function normalizeDescriptionInput(value: string): string {
	return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function splitLinesPreserveNewlines(text: string): { lines: string[]; newline: string } {
	const s = String(text ?? "");
	const newline = s.includes("\r\n") ? "\r\n" : "\n";
	const lines = newline === "\r\n" ? s.split("\r\n") : s.split("\n");
	return { lines, newline };
}

function buildDescriptionLines(propertyKey: string, description: string): string[] {
	const normalized = normalizeDescriptionInput(description);
	if (!normalized) return [];
	if (!normalized.includes("\n") && /^[^\s#:][^#]*$/.test(normalized)) {
		return [`${propertyKey}: ${normalized}`];
	}
	return [
		`${propertyKey}: |-`,
		...normalized.split("\n").map((line) => `  ${line}`)
	];
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

function findDescriptionRange(lines: string[], end: number, propertyKey: string): { start: number; end: number } | null {
	const lineRegex = buildFrontmatterPropertyLineRegex(propertyKey);
	for (let i = 1; i < end; i++) {
		const line = String(lines[i] ?? "");
		if (!lineRegex.test(line)) continue;
		let last = i;
		const value = String(line.match(lineRegex)?.[1] ?? "").trim();
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

function upsertYamlDescription(raw: string, propertyKey: string, description: string): string {
	const normalized = normalizeDescriptionInput(description);
	const descriptionLines = buildDescriptionLines(propertyKey, normalized);
	const { lines, newline } = splitLinesPreserveNewlines(raw);
	const bounds = findFrontmatterBounds(lines);

	if (!bounds) {
		if (descriptionLines.length === 0) return raw;
		return ["---", ...descriptionLines, "---", "", ...lines].join(newline);
	}

	const nextLines = lines.slice();
	const range = findDescriptionRange(nextLines, bounds.end, propertyKey);
	if (range) {
		nextLines.splice(range.start, range.end - range.start + 1);
	}
	if (descriptionLines.length > 0) {
		nextLines.splice(1, 0, ...descriptionLines);
	}

	const remaining = nextLines.slice(1, bounds.end + (descriptionLines.length > 0 ? descriptionLines.length - (range ? range.end - range.start + 1 : 0) : -(range ? range.end - range.start + 1 : 0))).filter((line) => String(line ?? "").trim());
	if (remaining.length === 0) {
		const after = nextLines.slice(bounds.end + 1).join(newline);
		if (!after) return "";
		return after.replace(/^\r?\n/, "");
	}

	return nextLines.join(newline);
}

async function updateFrontmatterDescriptionWithObsidianApi(plugin: any, file: TFile, description: string): Promise<boolean> {
	const app = plugin?.app;
	const fmApi = app?.fileManager?.processFrontMatter;
	if (typeof fmApi !== "function") return false;
	let changed = false;
	const normalized = normalizeDescriptionInput(description);
	const propertyKey = getYamlDescriptionPropertyKey(plugin);
	await fmApi.call(app.fileManager, file, (fm: any) => {
		const prevRaw = readFrontmatterProperty(fm, propertyKey);
		const prev = typeof prevRaw === "string" ? normalizeDescriptionInput(prevRaw) : "";
		if (prev === normalized) return;
		if (!normalized) delete fm[propertyKey];
		else fm[propertyKey] = normalized;
		changed = true;
	});
	return changed;
}

async function readCurrentYamlDescription(plugin: any, file: TFile): Promise<string> {
	const propertyKey = getYamlDescriptionPropertyKey(plugin);
	try {
		const cache: any = plugin?.app?.metadataCache?.getFileCache?.(file);
		const raw = readFrontmatterProperty(cache?.frontmatter, propertyKey);
		if (typeof raw === "string") return normalizeDescriptionInput(raw);
	} catch {
		// ignore
	}
	try {
		const raw = await plugin?.app?.vault?.read?.(file);
		return normalizeDescriptionInput(extractFrontmatterDescription(String(raw ?? ""), propertyKey));
	} catch {
		return "";
	}
}

export const descriptionFrontmatterMethods: DescriptionFrontmatterMethods = {
	async getYamlDescriptionForPath(this: EpochPlugin, path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return "";
		return await this.getYamlDescriptionForFile(file);
	},

	async getYamlDescriptionForFile(this: EpochPlugin, file: TFile): Promise<string> {
		return await readCurrentYamlDescription(this, file);
	},

	async setYamlDescriptionForPath(this: EpochPlugin, path: string, descriptionRaw: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;
		return await this.setYamlDescriptionForFile(file, descriptionRaw);
	},

	async setYamlDescriptionForFile(this: EpochPlugin, file: TFile, descriptionRaw: string): Promise<boolean> {
		const description = normalizeDescriptionInput(descriptionRaw);
		const propertyKey = getYamlDescriptionPropertyKey(this);
		await this.ensureIndexLoaded();
		await this.waitForExcludedSync();
		if (!this.shouldIndexFile(file)) return false;

		const prev = await readCurrentYamlDescription(this, file);
		if (prev === description) return false;

		try {
			const apiChanged = await updateFrontmatterDescriptionWithObsidianApi(this, file, description);
			if (apiChanged) {
				this.refreshEpochViews();
				return true;
			}
		} catch {
			// ignore
		}

		try {
			const raw = await this.app.vault.read(file);
			const next = upsertYamlDescription(raw, propertyKey, description);
			if (next === raw) return false;
			await this.app.vault.modify(file, next);
			this.refreshEpochViews();
			return true;
		} catch {
			return false;
		}
	}
};