import { TFile } from "obsidian";
import type { EpochPlugin } from "../main";
import { formatDate } from "../utils";
import {
	buildFrontmatterPropertyLineRegex,
	getYamlDatePropertyKey,
	readFrontmatterProperty,
} from "./frontmatter-keys";

export interface DateFrontmatterMethods {
	setYamlDateForPath(path: string, dateKey: string): Promise<boolean>;
	setYamlDateForFile(file: TFile, dateKey: string): Promise<boolean>;
}

function isDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function normalizeDateKeyInput(value: string): string | null {
	const k = String(value || "").trim();
	if (!k) return null;
	if (!isDateKey(k)) return null;
	return k;
}

async function updateFrontmatterDateWithObsidianApi(plugin: any, file: TFile, dateKey: string): Promise<boolean> {
	const app = plugin?.app;
	const fmApi = app?.fileManager?.processFrontMatter;
	if (typeof fmApi !== "function") return false;
	let changed = false;
	const propertyKey = getYamlDatePropertyKey(plugin);
	await fmApi.call(app.fileManager, file, (fm: any) => {
		const prevRaw = readFrontmatterProperty(fm, propertyKey);
		const prev = typeof prevRaw === "string" ? String(prevRaw).trim() : "";
		if (prev === dateKey) return;
		fm[propertyKey] = dateKey;
		changed = true;
	});
	return changed;
}

function splitLinesPreserveNewlines(text: string): { lines: string[]; newline: string } {
	const s = String(text ?? "");
	const newline = s.includes("\r\n") ? "\r\n" : "\n";
	const lines = newline === "\r\n" ? s.split("\r\n") : s.split("\n");
	return { lines, newline };
}

function upsertYamlDateLine(raw: string, propertyKey: string, dateKey: string): string {
	const { lines, newline } = splitLinesPreserveNewlines(raw);
	const first = String(lines[0] ?? "").replace(/^\uFEFF/, "").trim();
	const hasFrontmatter = first === "---";
	const lineRegex = buildFrontmatterPropertyLineRegex(propertyKey);
	if (!hasFrontmatter) {
		return [`---`, `${propertyKey}: ${dateKey}`, `---`, "", ...lines].join(newline);
	}

	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		const t = String(lines[i] ?? "").trim();
		if (t === "---" || t === "...") {
			end = i;
			break;
		}
	}
	if (end < 0) {
		return [`---`, `${propertyKey}: ${dateKey}`, `---`, "", ...lines.slice(1)].join(newline);
	}

	let replaced = false;
	for (let i = 1; i < end; i++) {
		const m = String(lines[i] ?? "").match(lineRegex);
		if (!m) continue;
		lines[i] = `${propertyKey}: ${dateKey}`;
		replaced = true;
		break;
	}
	if (!replaced) {
		lines.splice(1, 0, `${propertyKey}: ${dateKey}`);
	}
	return lines.join(newline);
}

export const dateFrontmatterMethods: DateFrontmatterMethods = {
	async setYamlDateForPath(this: EpochPlugin, path: string, dateKeyRaw: string): Promise<boolean> {
		const dateKey = normalizeDateKeyInput(dateKeyRaw);
		if (!dateKey) return false;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;
		return await this.setYamlDateForFile(file, dateKey);
	},

	async setYamlDateForFile(this: EpochPlugin, file: TFile, dateKeyRaw: string): Promise<boolean> {
		const dateKey = normalizeDateKeyInput(dateKeyRaw);
		if (!dateKey) return false;
		const propertyKey = getYamlDatePropertyKey(this);
		await this.ensureIndexLoaded();
		await this.waitForExcludedSync();
		if (!this.shouldIndexFile(file)) return false;

		try {
			const cache: any = this.app.metadataCache.getFileCache(file);
			const prevRaw = readFrontmatterProperty(cache?.frontmatter, propertyKey);
			const prevFmDate = typeof prevRaw === "string" ? String(prevRaw).trim() : "";
			if (prevFmDate === dateKey) return false;
		} catch {
			// ignore
		}

		try {
			const apiChanged = await updateFrontmatterDateWithObsidianApi(this, file, dateKey);
			if (apiChanged) {
				this.refreshEpochViews();
				return true;
			}
		} catch {
			// ignore
		}

		try {
			const raw = await this.app.vault.read(file);
			const currentKey = (() => {
				try {
					const cache: any = this.app.metadataCache.getFileCache(file);
					const v = readFrontmatterProperty(cache?.frontmatter, propertyKey);
					if (typeof v === "string" && isDateKey(v)) return String(v).trim();
				} catch {
					// ignore
				}
				try {
					const d = this.indexer.getFileIndexData(file.path)?.dateProp?.date ?? null;
					if (typeof d === "string" && isDateKey(d)) return d;
				} catch {
					// ignore
				}
				return null;
			})();
			if (currentKey === dateKey) return false;
			const next = upsertYamlDateLine(raw, propertyKey, dateKey);
			if (next === raw) return false;
			await this.app.vault.modify(file, next);
			this.refreshEpochViews();
			return true;
		} catch {
			return false;
		}
	}
};

export function resolveDateKeyForCanvasDrop(date: Date): string {
	return formatDate(date);
}
