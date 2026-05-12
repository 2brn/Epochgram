import { normalizePath, TFile } from "obsidian";
import { formatDate, isValidDailyNoteDateFormat, normalizeDailyNoteDateFormatInput } from "../utils";
import type { EpochPlugin } from "../main";

export interface DailyNoteMethods {
	applyDailyNotesDefaults(): void;
	getDailyNoteFolder(): string;
	getDailyNoteFormat(): string;
	getDailyNoteTemplatePath(): string;
	getDailyNoteTemplateContent(date: Date, notePath: string): Promise<string | null>;
	getDateFormat(date: Date): string;
}

function formatDateTimeToken(date: Date, token: string): string {
	switch (token) {
		case "YYYY": return String(date.getFullYear()).padStart(4, "0");
		case "YY": return String(date.getFullYear() % 100).padStart(2, "0");
		case "MM": return String(date.getMonth() + 1).padStart(2, "0");
		case "DD": return String(date.getDate()).padStart(2, "0");
		case "HH": return String(date.getHours()).padStart(2, "0");
		case "hh": {
			const h = date.getHours() % 12 || 12;
			return String(h).padStart(2, "0");
		}
		case "mm": return String(date.getMinutes()).padStart(2, "0");
		case "ss": return String(date.getSeconds()).padStart(2, "0");
		case "SSS": return String(date.getMilliseconds()).padStart(3, "0");
		case "A": return date.getHours() < 12 ? "AM" : "PM";
		case "a": return date.getHours() < 12 ? "am" : "pm";
		default: return token;
	}
}

function formatWithMomentOrFallback(date: Date, pattern: string): string {
	const fmt = String(pattern || "").trim();
	if (!fmt) return formatDate(date);
	try {
		const win = window as typeof window & { moment?: ((input?: any) => { format: (f: string) => string }) };
		if (typeof win?.moment === "function") {
			return String(win.moment(date).format(fmt) ?? "");
		}
	} catch {
	}
	return fmt.replace(/YYYY|SSS|YY|MM|DD|HH|hh|mm|ss|A|a/g, (tok) => formatDateTimeToken(date, tok));
}

function renderDailyTemplatePlaceholders(
	template: string,
	date: Date,
	title: string,
	defaultDatePattern: string
): string {
	const dt = new Date(date.getTime());
	const datePattern = defaultDatePattern || "YYYY-MM-DD";
	return String(template || "").replace(
		/\{\{\s*(date|time|title|yesterday|tomorrow)(?::([^}]+))?\s*\}\}/gi,
		(_m, keyRaw, patternRaw) => {
			const key = String(keyRaw || "").toLowerCase();
			const pattern = String(patternRaw || "").trim();
			if (key === "title") return title;
			if (key === "time") return formatWithMomentOrFallback(dt, pattern || "HH:mm");
			if (key === "date") return formatWithMomentOrFallback(dt, pattern || datePattern);
			const shifted = new Date(dt.getTime());
			shifted.setDate(shifted.getDate() + (key === "yesterday" ? -1 : 1));
			return formatWithMomentOrFallback(shifted, pattern || datePattern);
		}
	);
}

function getCoreDailyNotesOptions(plugin: EpochPlugin): { enabled: boolean; folder: string; format: string; template: string } {
	const defaultFolder = "/";
	const defaultFormat = "YYYY-MM-DD";
	const defaultTemplate = "";
	try {
		const internalPlugins = (plugin.app as any)?.internalPlugins;
		if (!internalPlugins) return { enabled: false, folder: defaultFolder, format: defaultFormat, template: defaultTemplate };
		const dailyNotes = typeof internalPlugins.getPluginById === "function"
			? internalPlugins.getPluginById("daily-notes")
			: internalPlugins.plugins?.["daily-notes"];
		if (!dailyNotes || !dailyNotes.enabled) {
			return { enabled: false, folder: defaultFolder, format: defaultFormat, template: defaultTemplate };
		}
		const options = dailyNotes.instance?.options;
		const folderRaw = typeof options?.folder === "string" ? options.folder.trim() : "";
		const formatRaw = typeof options?.format === "string" ? options.format.trim() : "";
		const templateRaw = typeof options?.template === "string"
			? options.template.trim()
			: (typeof options?.templatePath === "string" ? options.templatePath.trim() : "");
		const folder = folderRaw.length > 0 ? folderRaw : defaultFolder;
		const normalizedFormat = normalizeDailyNoteDateFormatInput(formatRaw);
		const format = normalizedFormat && isValidDailyNoteDateFormat(normalizedFormat)
			? normalizedFormat
			: defaultFormat;
		const template = templateRaw
			? normalizePath(templateRaw.replace(/\\/g, "/").replace(/^\/+/, ""))
			: defaultTemplate;
		return { enabled: true, folder, format, template };
	} catch {
		return { enabled: false, folder: defaultFolder, format: defaultFormat, template: defaultTemplate };
	}
}

function resolveDailyTemplateFile(plugin: EpochPlugin, templatePath: string): TFile | null {
	const vault: any = plugin?.app?.vault;
	if (!vault || typeof vault.getAbstractFileByPath !== "function") return null;
	const normalized = normalizePath(String(templatePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, ""));
	if (!normalized) return null;
	const candidates = [normalized];
	if (!/\.md$/i.test(normalized)) {
		candidates.push(`${normalized}.md`);
	}
	for (const candidate of candidates) {
		const hit = vault.getAbstractFileByPath(candidate);
		if (hit instanceof TFile) return hit;
	}
	return null;
}

export const dailyNoteMethods: DailyNoteMethods = {
	applyDailyNotesDefaults(this: EpochPlugin): void {
		// No-op: Epoch always reads Daily Notes settings directly.
	},

	getDailyNoteFolder(this: EpochPlugin): string {
		return getCoreDailyNotesOptions(this).folder;
	},

	getDailyNoteFormat(this: EpochPlugin): string {
		return getCoreDailyNotesOptions(this).format;
	},

	getDailyNoteTemplatePath(this: EpochPlugin): string {
		return getCoreDailyNotesOptions(this).template;
	},

	async getDailyNoteTemplateContent(this: EpochPlugin, date: Date, notePath: string): Promise<string | null> {
		const { template, format } = getCoreDailyNotesOptions(this);
		if (!template) return null;
		const abstract = resolveDailyTemplateFile(this, template);
		if (!(abstract instanceof TFile)) return null;
		let text = "";
		if (typeof (this.app.vault as any).cachedRead === "function") {
			text = await (this.app.vault as any).cachedRead(abstract);
		} else if (typeof (this.app.vault as any).read === "function") {
			text = await (this.app.vault as any).read(abstract);
		} else {
			return null;
		}
		const leaf = String(notePath || "").split("/").pop() || "";
		const title = leaf.replace(/\.md$/i, "");
		return renderDailyTemplatePlaceholders(String(text || ""), date, title, format);
	},

	getDateFormat(this: EpochPlugin, date: Date): string {
		const { format } = getCoreDailyNotesOptions(this);
		const win = window as typeof window & { moment?: ((input?: any) => { format: (fmt: string) => string }) };
		try {
			if (typeof win?.moment === "function") {
				return win.moment(date).format(format);
			}
		} catch (error) {
			void error;
		}
		return formatDate(date);
	}
};
