import { Notice, TFile, normalizePath, requestUrl } from "obsidian";
import { RRule } from "rrule";
import type { EpochPlugin } from "../main";
import { formatDate } from "../utils";
import { getYamlDatePropertyKey, getYamlDescriptionPropertyKey } from "./frontmatter-keys";
import { hasVerifiedEntitlement } from "./pro-feature-state";
import { resolveSecretPlaceholders } from "../utils/secret-placeholders";

export type CalendarSyncPeriod = "manual" | "startup" | "1m" | "5m" | "15m" | "1h" | "6h" | "24h";

export interface CalendarSyncMethods {
	runCalendarSync(options?: { reason?: "manual" | "startup" | "interval"; showNotice?: boolean }): Promise<void>;
	refreshCalendarSyncSchedule(): void;
	maybeRunCalendarSyncOnStartup(): Promise<void>;
	getCalendarSyncTargetFolder(): string;
}

type CalendarSyncRuntime = {
	__epochCalendarSyncTimer?: number | null;
	__epochCalendarSyncRunning?: boolean;
};

type IcsDateValue = {
	raw: string;
	date: Date;
	allDay: boolean;
};

type IcsEvent = {
	uid: string;
	title: string;
	description: string;
	location: string;
	url: string;
	status: string;
	start: IcsDateValue;
	end: IcsDateValue | null;
	rrule: string;
	recurrenceId: string;
	sourceUrl: string;
};

type SyncRecord = {
	syncKey: string;
	uid: string;
	title: string;
	description: string;
	location: string;
	url: string;
	status: string;
	start: Date;
	end: Date | null;
	allDay: boolean;
	rrule: string;
	sourceUrl: string;
};

type ExistingSyncFile = {
	file: TFile;
	syncKey: string;
	owned: boolean;
};

const DEFAULT_PERIOD: CalendarSyncPeriod = "manual";
const DEFAULT_TEMPLATE_PATH = "";
const DEFAULT_FALLBACK_TEMPLATE = [
	"---",
	"source: \"{{source}}\"",
	"syncKey: \"{{syncKey}}\"",
	"owned: \"{{owned}}\"",
	"uid: \"{{uid}}\"",
	"startIso: \"{{startIso}}\"",
	"endIso: \"{{endIso}}\"",
	"sourceUrl: \"{{sourceUrl}}\"",
	"lastSyncedAt: \"{{lastSyncedAt}}\"",
	"cancelled: \"{{cancelled}}\"",
	"title: \"{{title}}\"",
	"date: \"{{date}}\"",
	"time: \"{{time}}\"",
	"url: \"{{url}}\"",
	"location: \"{{location}}\"",
	"description: |-",
	"{{descriptionYaml}}",
	"recur: \"{{recur}}\"",
	"status: \"{{status}}\"",
	"allDay: \"{{allDay}}\"",
	"---",
	"",
].join("\n");
const SYNC_SOURCE = "ics";
const FRONTMATTER_SYNC_KEY = "syncKey";
const FRONTMATTER_OWNED = "owned";
const FRONTMATTER_UID = "uid";
const FRONTMATTER_START = "startIso";
const FRONTMATTER_END = "endIso";
const FRONTMATTER_SOURCE_URL = "sourceUrl";
const FRONTMATTER_LAST_SYNC = "lastSyncedAt";
const FRONTMATTER_CANCELLED = "cancelled";
const RANGE_DAYS_PAST = 30;
const RANGE_DAYS_FUTURE = 365;

const PERIOD_TO_MS: Record<Exclude<CalendarSyncPeriod, "manual" | "startup">, number> = {
	"1m": 60_000,
	"5m": 5 * 60_000,
	"15m": 15 * 60_000,
	"1h": 60 * 60_000,
	"6h": 6 * 60 * 60_000,
	"24h": 24 * 60 * 60_000,
};

function toSafeString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

function normalizeCalendarSyncPeriod(value: unknown): CalendarSyncPeriod {
	const raw = toSafeString(value).trim().toLowerCase();
	switch (raw) {
		case "manual":
		case "startup":
		case "1m":
		case "5m":
		case "15m":
		case "1h":
		case "6h":
		case "24h":
			return raw;
		default:
			return DEFAULT_PERIOD;
	}
}

function normalizeCalendarSyncUrls(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const v of raw) {
		const s = toSafeString(v).trim();
		if (!s) continue;
		out.push(s);
	}
	return Array.from(new Set(out));
}

function getSecretLookup(plugin: EpochPlugin): (id: string) => string | null {
	return (id: string) => {
		try {
			return plugin.app.secretStorage.getSecret(String(id || ""));
		} catch {
			return null;
		}
	};
}

function resolveCalendarSyncUrl(plugin: EpochPlugin, raw: string): string {
	return resolveSecretPlaceholders(String(raw ?? ""), getSecretLookup(plugin));
}

function normalizeRelativePath(raw: unknown): string {
	const value = toSafeString(raw).trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (!value) return "";
	return normalizePath(value);
}

function normalizeTemplatePath(raw: unknown): string {
	const value = normalizeRelativePath(raw);
	return value || DEFAULT_TEMPLATE_PATH;
}

function toDateRange(): { from: Date; to: Date } {
	const now = new Date();
	const from = new Date(now.getTime());
	from.setHours(0, 0, 0, 0);
	from.setDate(from.getDate() - RANGE_DAYS_PAST);
	const to = new Date(now.getTime());
	to.setHours(23, 59, 59, 999);
	to.setDate(to.getDate() + RANGE_DAYS_FUTURE);
	return { from, to };
}

function isUrlLike(raw: string): boolean {
	const value = String(raw ?? "").trim();
	if (!value) return false;
	try {
		const normalized = value.replace(/^webcal:/i, "https:");
		const parsed = new URL(normalized);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function normalizeSourceUrl(raw: string): string {
	return String(raw ?? "").trim().replace(/^webcal:/i, "https:");
}

function decodeUrlSegment(raw: string): string {
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function isSensitiveSourceSegment(raw: string): boolean {
	const segment = String(raw ?? "").trim();
	if (!segment) return false;
	const decoded = decodeUrlSegment(segment);
	const lower = decoded.toLowerCase();
	if (lower.startsWith("private-") || lower.startsWith("private_")) return true;
	if (/(token|secret|apikey|api-key|auth|signature|sig|session|password|passwd|pwd|key)/i.test(lower)) return true;
	if (/^[a-f0-9]{16,}$/i.test(decoded)) return true;
	if (/^[a-z0-9_-]{24,}$/i.test(decoded)) return true;
	return false;
}

function sanitizeSourcePath(pathname: string): string {
	const segments = String(pathname || "").split("/").filter(Boolean);
	const kept: string[] = [];
	for (const segment of segments) {
		if (isSensitiveSourceSegment(segment)) break;
		kept.push(segment);
	}
	if (kept.length === 0) return "/";
	return `/${kept.join("/")}`;
}

function sanitizeSourceUrlForStorage(raw: string): string {
	const normalized = normalizeSourceUrl(raw);
	if (!normalized) return "";
	try {
		const parsed = new URL(normalized);
		const protocol = parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.protocol : "https:";
		const safePath = sanitizeSourcePath(parsed.pathname || "/");
		return `${protocol}//${parsed.host}${safePath}`;
	} catch {
		const hostMatch = normalized.match(/^(https?):\/\/([^/\s?#]+)([^?#]*)/i);
		if (!hostMatch) return "";
		const safePath = sanitizeSourcePath(String(hostMatch[3] || "/"));
		return `${String(hostMatch[1]).toLowerCase()}://${hostMatch[2]}${safePath}`;
	}
}

function unfoldIcsLines(text: string): string[] {
	const raw = String(text ?? "").replace(/\r/g, "").split("\n");
	const out: string[] = [];
	for (const line of raw) {
		if (!line) continue;
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
			continue;
		}
		out.push(line);
	}
	return out;
}

function unescapeIcsText(value: string): string {
	return String(value ?? "")
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\")
		.trim();
}

function parseIcsDate(valueRaw: string, valueType: string): IcsDateValue | null {
	const value = String(valueRaw ?? "").trim();
	if (!value) return null;
	const isDateOnly = String(valueType ?? "").toUpperCase() === "DATE" || /^\d{8}$/.test(value);
	if (isDateOnly) {
		const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
		if (!m) return null;
		const y = Number(m[1]);
		const mon = Number(m[2]) - 1;
		const d = Number(m[3]);
		if (![y, mon, d].every(Number.isFinite)) return null;
		const date = new Date(y, mon, d, 12, 0, 0, 0);
		return { raw: value, date, allDay: true };
	}
	const z = value.endsWith("Z");
	const core = z ? value.slice(0, -1) : value;
	const m = core.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
	if (!m) return null;
	const y = Number(m[1]);
	const mon = Number(m[2]) - 1;
	const d = Number(m[3]);
	const hh = Number(m[4]);
	const mm = Number(m[5]);
	const ss = Number(m[6]);
	if (![y, mon, d, hh, mm, ss].every(Number.isFinite)) return null;
	const date = z ? new Date(Date.UTC(y, mon, d, hh, mm, ss, 0)) : new Date(y, mon, d, hh, mm, ss, 0);
	return { raw: value, date, allDay: false };
}

function parseIcsEvents(sourceUrl: string, icsText: string): IcsEvent[] {
	const lines = unfoldIcsLines(icsText);
	const out: IcsEvent[] = [];
	let inEvent = false;
	let cur: Record<string, string> = {};
	let params: Record<string, string> = {};
	const flush = () => {
		if (!inEvent) return;
		const uid = String(cur.UID ?? "").trim();
		const dtstartRaw = String(cur.DTSTART ?? "").trim();
		if (!uid || !dtstartRaw) {
			inEvent = false;
			cur = {};
			params = {};
			return;
		}
		const dtstart = parseIcsDate(dtstartRaw, params.DTSTART_VALUE ?? "");
		if (!dtstart) {
			inEvent = false;
			cur = {};
			params = {};
			return;
		}
		const dtendRaw = String(cur.DTEND ?? "").trim();
		const dtend = dtendRaw ? parseIcsDate(dtendRaw, params.DTEND_VALUE ?? "") : null;
		out.push({
			uid,
			title: unescapeIcsText(cur.SUMMARY ?? ""),
			description: unescapeIcsText(cur.DESCRIPTION ?? ""),
			location: unescapeIcsText(cur.LOCATION ?? ""),
			url: String(cur.URL ?? "").trim(),
			status: String(cur.STATUS ?? "").trim().toUpperCase(),
			start: dtstart,
			end: dtend,
			rrule: String(cur.RRULE ?? "").trim(),
			recurrenceId: String(cur["RECURRENCE-ID"] ?? "").trim(),
			sourceUrl,
		});
		inEvent = false;
		cur = {};
		params = {};
	};

	for (const rawLine of lines) {
		const line = String(rawLine ?? "").trim();
		if (!line) continue;
		if (line.toUpperCase() === "BEGIN:VEVENT") {
			inEvent = true;
			cur = {};
			params = {};
			continue;
		}
		if (line.toUpperCase() === "END:VEVENT") {
			flush();
			continue;
		}
		if (!inEvent) continue;
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const left = line.slice(0, idx);
		const right = line.slice(idx + 1);
		const chunks = left.split(";");
		const key = String(chunks[0] ?? "").trim().toUpperCase();
		if (!key) continue;
		cur[key] = right;
		for (let i = 1; i < chunks.length; i++) {
			const p = String(chunks[i] ?? "").trim();
			if (!p) continue;
			const eq = p.indexOf("=");
			if (eq < 0) continue;
			const pKey = p.slice(0, eq).trim().toUpperCase();
			const pVal = p.slice(eq + 1).trim();
			params[`${key}_${pKey}`] = pVal;
		}
	}
	return out;
}

function startWithinRange(start: Date, from: Date, to: Date): boolean {
	const t = start.getTime();
	return t >= from.getTime() && t <= to.getTime();
}

function expandRecurringRecords(events: IcsEvent[], from: Date, to: Date): SyncRecord[] {
	const out: SyncRecord[] = [];
	for (const e of events) {
		if (e.recurrenceId) continue;
		const title = e.title || "event";
		const durationMs = (() => {
			if (e.end && Number.isFinite(e.end.date.getTime())) {
				const d = e.end.date.getTime() - e.start.date.getTime();
				if (d > 0) return d;
			}
			return e.start.allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
		})();
		if (!e.rrule) {
			if (!startWithinRange(e.start.date, from, to)) continue;
			const syncKey = `${e.uid}|${e.start.date.toISOString()}`;
			out.push({
				syncKey,
				uid: e.uid,
				title,
				description: e.description,
				location: e.location,
				url: e.url,
				status: e.status,
				start: e.start.date,
				end: e.end?.date ?? new Date(e.start.date.getTime() + durationMs),
				allDay: e.start.allDay,
				rrule: "",
				sourceUrl: e.sourceUrl,
			});
			continue;
		}
		try {
			const options = RRule.parseString(e.rrule);
			options.dtstart = e.start.date;
			const rule = new RRule(options);
			const hasOccurrenceInRange = rule.between(from, to, true).length > 0;
			if (!hasOccurrenceInRange) continue;
			const syncKey = `${e.uid}|${e.start.date.toISOString()}`;
			out.push({
				syncKey,
				uid: e.uid,
				title,
				description: e.description,
				location: e.location,
				url: e.url,
				status: e.status,
				start: e.start.date,
				end: e.end?.date ?? new Date(e.start.date.getTime() + durationMs),
				allDay: e.start.allDay,
				rrule: e.rrule,
				sourceUrl: e.sourceUrl,
			});
		} catch {
			if (!startWithinRange(e.start.date, from, to)) continue;
			const syncKey = `${e.uid}|${e.start.date.toISOString()}`;
			out.push({
				syncKey,
				uid: e.uid,
				title,
				description: e.description,
				location: e.location,
				url: e.url,
				status: e.status,
				start: e.start.date,
				end: e.end?.date ?? null,
				allDay: e.start.allDay,
				rrule: "",
				sourceUrl: e.sourceUrl,
			});
		}
	}
	return out;
}

function two(value: number): string {
	return String(value).padStart(2, "0");
}

function formatTimeForName(date: Date, allDay: boolean): string {
	if (allDay) return "all-day";
	return `${two(date.getHours())}-${two(date.getMinutes())}`;
}

function sanitizeFileName(raw: string): string {
	const cleaned = String(raw ?? "")
		.replace(/[\\/:*?"<>|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned || "event";
}

function buildFileStem(record: SyncRecord): string {
	return sanitizeFileName(record.title || "event");
}

async function ensureFolder(plugin: EpochPlugin, folderRaw: string): Promise<void> {
	const folder = normalizeRelativePath(folderRaw);
	if (!folder) return;
	const parts = folder.split("/").filter(Boolean);
	let acc = "";
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part;
		const existing = plugin.app.vault.getAbstractFileByPath(acc);
		if (existing) continue;
		try {
			await plugin.app.vault.createFolder(acc);
		} catch (error) {
			const current = plugin.app.vault.getAbstractFileByPath(acc);
			if (current) continue;
			const rawMessage = (error as { message?: unknown } | null)?.message;
			const message = typeof rawMessage === "string" ? rawMessage.toLowerCase() : "";
			if (message.includes("already exists")) continue;
			throw error;
		}
	}
}

function isPathInFolder(pathRaw: string, folderRaw: string): boolean {
	const path = normalizeRelativePath(pathRaw);
	const folder = normalizeRelativePath(folderRaw);
	if (!folder || folder === "/") return true;
	if (path === folder) return true;
	return path.startsWith(`${folder}/`);
}

function buildFrontmatterText(frontmatter: Record<string, unknown>): string {
	const lines: string[] = ["---"];
	for (const [k, v] of Object.entries(frontmatter)) {
		if (v == null) continue;
		if (typeof v === "boolean") {
			lines.push(`${k}: ${v ? "true" : "false"}`);
			continue;
		}
		const value = typeof v === "string"
			? v
			: (typeof v === "number" ? String(v) : JSON.stringify(v));
		if (!value.includes("\n")) {
			lines.push(`${k}: ${value}`);
			continue;
		}
		lines.push(`${k}: |-`);
		for (const l of value.split("\n")) {
			lines.push(`  ${l}`);
		}
	}
	lines.push("---", "");
	return lines.join("\n");
}

function toYamlBlockScalarValue(value: string, indent = 2): string {
	const prefix = " ".repeat(Math.max(0, indent));
	const normalized = String(value ?? "").replace(/\r\n?/g, "\n");
	const lines = normalized.split("\n");
	return lines.map((line) => `${prefix}${line}`).join("\n");
}

function renderTemplate(template: string, record: SyncRecord): string {
	const dateKey = formatDate(record.start);
	const time = formatTimeForName(record.start, record.allDay).replace(/-/g, ":");
	const startIso = record.start.toISOString();
	const endIso = record.end ? record.end.toISOString() : "";
	const syncKey = `${record.uid}|${startIso}`;
	const lastSyncedAt = new Date().toISOString();
	return String(template || "").replace(/\{\{\s*([A-Za-z0-9]+)\s*\}\}/g, (fullMatch, rawKey) => {
		const key = String(rawKey || "").toLowerCase();
		switch (key) {
			case "title": return record.title || "";
			case "date": return dateKey;
			case "time": return time;
			case "uid": return record.uid;
			case "url": return record.url || "";
			case "location": return record.location || "";
			case "description": return record.description || "";
			case "descriptionyaml": return toYamlBlockScalarValue(record.description || "", 2);
			case "source": return SYNC_SOURCE;
			case "synckey": return syncKey;
			case "owned": return "true";
			case "startiso": return startIso;
			case "endiso": return endIso;
			case "sourceurl": return sanitizeSourceUrlForStorage(record.sourceUrl || "");
			case "lastsyncedat": return lastSyncedAt;
			case "cancelled": return "false";
			case "recur": return record.rrule || "";
			case "status": return record.status || "";
			case "allday": return record.allDay ? "true" : "false";
			default: return fullMatch;
		}
	});
}

function buildFallbackBody(record: SyncRecord): string {
	const lines: string[] = [];
	if (record.description) lines.push(record.description.trim());
	if (record.location) lines.push(`Location: ${record.location}`);
	if (record.url) lines.push(record.url);
	return lines.join("\n\n").trim();
}

async function resolveTemplateText(plugin: EpochPlugin, templatePathRaw: string): Promise<string> {
	const templatePath = normalizeTemplatePath(templatePathRaw);
	if (!templatePath) return DEFAULT_FALLBACK_TEMPLATE;
	const candidates = [templatePath];
	if (!/\.md$/i.test(templatePath)) candidates.push(`${templatePath}.md`);
	for (const candidate of candidates) {
		const af = plugin.app.vault.getAbstractFileByPath(candidate);
		if (!(af instanceof TFile)) continue;
		try {
			return await plugin.app.vault.read(af);
		} catch {
			return DEFAULT_FALLBACK_TEMPLATE;
		}
	}
	return DEFAULT_FALLBACK_TEMPLATE;
}

async function upsertFrontmatterOnly(file: TFile, patch: Record<string, unknown>, plugin: EpochPlugin): Promise<void> {
	if (typeof plugin.app.fileManager?.processFrontMatter !== "function") return;
	await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		for (const [k, v] of Object.entries(patch)) {
			if (v === undefined) continue;
			fm[k] = v;
		}
	});
}

function readFrontmatter(file: TFile, plugin: EpochPlugin): Record<string, unknown> {
	try {
		const cache = plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (fm && typeof fm === "object") return fm;
	} catch {
		// ignore
	}
	return {};
}

function extractSyncKeyFromFrontmatter(fm: Record<string, unknown>): string {
	const raw = fm[FRONTMATTER_SYNC_KEY];
	return typeof raw === "string" ? raw.trim() : "";
}

export function isOwnedSyncFile(fm: Record<string, unknown>): boolean {
	const sourceRaw = typeof fm.source === "string" ? fm.source.trim().toLowerCase() : "";
	const ownedRaw = fm[FRONTMATTER_OWNED];
	const owned = ownedRaw === true
		|| (typeof ownedRaw === "string" && ["true", "1", "yes", "on"].includes(ownedRaw.trim().toLowerCase()));
	const syncKey = extractSyncKeyFromFrontmatter(fm);
	const source = sourceRaw.length > 0 ? sourceRaw : null;
	return owned && syncKey.length > 0 && (source === null || source === SYNC_SOURCE);
}

function periodToMs(period: CalendarSyncPeriod): number {
	switch (period) {
		case "1m": return PERIOD_TO_MS["1m"];
		case "5m": return PERIOD_TO_MS["5m"];
		case "15m": return PERIOD_TO_MS["15m"];
		case "1h": return PERIOD_TO_MS["1h"];
		case "6h": return PERIOD_TO_MS["6h"];
		case "24h": return PERIOD_TO_MS["24h"];
		default: return 0;
	}
}

async function collectExistingSyncFiles(plugin: EpochPlugin, folder: string): Promise<Map<string, ExistingSyncFile>> {
	const out = new Map<string, ExistingSyncFile>();
	for (const file of plugin.app.vault.getMarkdownFiles()) {
		if (!isPathInFolder(file.path, folder)) continue;
		const fm = readFrontmatter(file, plugin);
		const syncKey = extractSyncKeyFromFrontmatter(fm);
		if (!syncKey) continue;
		out.set(syncKey, { file, syncKey, owned: isOwnedSyncFile(fm) });
	}
	return out;
}

export function getMinimalCalendarSyncPatch(managedFrontmatter: Record<string, unknown>): Record<string, unknown> {
	const requiredKeys = new Set<string>([
		FRONTMATTER_SYNC_KEY,
		FRONTMATTER_START,
		FRONTMATTER_UID,
		FRONTMATTER_OWNED,
		FRONTMATTER_LAST_SYNC,
	]);
	const requiredPatch: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(managedFrontmatter)) {
		if (requiredKeys.has(k)) requiredPatch[k] = v;
	}
	return requiredPatch;
}

function buildEventFrontmatter(plugin: EpochPlugin, record: SyncRecord, templateProvided: boolean): Record<string, unknown> {
	const dateProperty = getYamlDatePropertyKey(plugin);
	const descProperty = getYamlDescriptionPropertyKey(plugin);
	const fm: Record<string, unknown> = {
		source: SYNC_SOURCE,
		[dateProperty]: formatDate(record.start),
		[FRONTMATTER_UID]: record.uid,
		[FRONTMATTER_START]: record.start.toISOString(),
		[FRONTMATTER_END]: record.end ? record.end.toISOString() : "",
		[FRONTMATTER_SOURCE_URL]: sanitizeSourceUrlForStorage(record.sourceUrl),
		[FRONTMATTER_SYNC_KEY]: record.syncKey,
		[FRONTMATTER_OWNED]: true,
		[FRONTMATTER_LAST_SYNC]: new Date().toISOString(),
		[FRONTMATTER_CANCELLED]: false,
	};
	if (record.rrule) fm.recur = record.rrule;
	if (!templateProvided) {
		fm[descProperty] = record.title || "event";
	}
	return fm;
}

async function createOrUpdateOwnedNote(
	plugin: EpochPlugin,
	record: SyncRecord,
	targetFolder: string,
	templateText: string,
	existing: ExistingSyncFile | null
): Promise<{ created: boolean; updated: boolean; file: TFile | null }> {
	const templateProvided = templateText.trim().length > 0;
	const managedFrontmatter = buildEventFrontmatter(plugin, record, templateProvided);
	const requiredPatch = getMinimalCalendarSyncPatch(managedFrontmatter);

	const content = (() => {
		if (templateProvided) {
			return renderTemplate(templateText, record).trimEnd() + "\n";
		}
		const frontmatter = managedFrontmatter;
		const body = buildFallbackBody(record);
		return `${buildFrontmatterText(frontmatter)}${body}`.trimEnd() + "\n";
	})();

	if (existing?.owned && existing.file instanceof TFile) {
		try {
			await plugin.app.vault.modify(existing.file, content);
			// If user provided a template, only enforce required sync keys.
			if (templateProvided) {
				await upsertFrontmatterOnly(existing.file, requiredPatch, plugin);
			} else {
				await upsertFrontmatterOnly(existing.file, managedFrontmatter, plugin);
			}
			return { created: false, updated: true, file: existing.file };
		} catch {
			return { created: false, updated: false, file: null };
		}
	}

	const baseStem = buildFileStem(record);
	const folder = normalizeRelativePath(targetFolder);
	for (let i = 0; i < 200; i++) {
		const suffix = i === 0 ? "" : ` (${i})`;
		const rel = folder ? `${folder}/${baseStem}${suffix}.md` : `${baseStem}${suffix}.md`;
		const path = normalizePath(rel);
		const af = plugin.app.vault.getAbstractFileByPath(path);
		if (af instanceof TFile) continue;
		try {
			const file = await plugin.app.vault.create(path, content);
			// After creating file, only write required sync keys when user template provided.
			if (templateProvided) {
				await upsertFrontmatterOnly(file, requiredPatch, plugin);
			} else {
				await upsertFrontmatterOnly(file, managedFrontmatter, plugin);
			}
			return { created: true, updated: false, file };
		} catch {
			continue;
		}
	}
	return { created: false, updated: false, file: null };
}

function shouldDropCancelled(record: SyncRecord): boolean {
	return record.status === "CANCELLED";
}

async function fetchIcsText(url: string): Promise<string> {
	const target = normalizeSourceUrl(url);
	const rsp = await requestUrl({ url: target, method: "GET" });
	return String(rsp.text ?? "");
}

export const calendarSyncMethods: CalendarSyncMethods = {
	getCalendarSyncTargetFolder(this: EpochPlugin): string {
		const raw = normalizeRelativePath(this.settings.calendarSyncFolder);
		if (raw) return raw;
		return normalizeRelativePath(this.getDailyNoteFolder());
	},

	refreshCalendarSyncSchedule(this: EpochPlugin): void {
		const runtime = this as unknown as CalendarSyncRuntime;
		const existing = Number(runtime.__epochCalendarSyncTimer ?? 0);
		if (existing > 0) {
			window.clearInterval(existing);
			runtime.__epochCalendarSyncTimer = null;
		}
		if (!hasVerifiedEntitlement(this)) return;
		const period = normalizeCalendarSyncPeriod(this.settings.calendarSyncPeriod);
		if (period === "manual" || period === "startup") return;
		const ms = periodToMs(period);
		if (!(ms > 0)) return;
		const id = window.setInterval(() => {
			void this.runCalendarSync({ reason: "interval", showNotice: false });
		}, ms);
		runtime.__epochCalendarSyncTimer = id;
		this.registerInterval(id);
	},

	async maybeRunCalendarSyncOnStartup(this: EpochPlugin): Promise<void> {
		if (!hasVerifiedEntitlement(this)) return;
		const period = normalizeCalendarSyncPeriod(this.settings.calendarSyncPeriod);
		if (period !== "startup") return;
		await this.runCalendarSync({ reason: "startup", showNotice: false });
	},

	async runCalendarSync(this: EpochPlugin, options?: { reason?: "manual" | "startup" | "interval"; showNotice?: boolean }): Promise<void> {
		if (!hasVerifiedEntitlement(this)) return;
		const runtime = this as unknown as CalendarSyncRuntime;
		if (runtime.__epochCalendarSyncRunning) {
			if (options?.showNotice) new Notice("Calendar sync is already running.");
			return;
		}
		const urls = normalizeCalendarSyncUrls(this.settings.calendarSyncIcsUrls)
			.map((url) => resolveCalendarSyncUrl(this, url))
			.filter(isUrlLike);
		if (urls.length === 0) {
			if (options?.showNotice) new Notice("No valid ICS links configured.");
			return;
		}

		runtime.__epochCalendarSyncRunning = true;
		const targetFolder = this.getCalendarSyncTargetFolder();
		const templatePath = normalizeTemplatePath(this.settings.calendarSyncTemplatePath);
		const templateText = await resolveTemplateText(this, templatePath);
		let created = 0;
		let updated = 0;
		let cancelled = 0;
		let deleted = 0;
		let errors = 0;
		try {
			await ensureFolder(this, targetFolder);
			const range = toDateRange();
			const desired = new Map<string, SyncRecord>();
			for (const url of urls) {
				try {
					const text = await fetchIcsText(url);
					const parsed = parseIcsEvents(sanitizeSourceUrlForStorage(url), text);
					const records = expandRecurringRecords(parsed, range.from, range.to);
					for (const record of records) {
						if (!desired.has(record.syncKey)) desired.set(record.syncKey, record);
					}
				} catch {
					errors++;
				}
			}

			const existingMap = await collectExistingSyncFiles(this, targetFolder);
			const seen = new Set<string>();

			for (const [syncKey, record] of desired) {
				seen.add(syncKey);
				const existing = existingMap.get(syncKey) ?? null;
				if (shouldDropCancelled(record)) {
					if (!existing) continue;
					if (existing.owned) {
						try {
							await this.app.fileManager.trashFile(existing.file);
							deleted++;
						} catch {
							errors++;
						}
					} else {
						try {
							await upsertFrontmatterOnly(existing.file, {
								[FRONTMATTER_CANCELLED]: true,
								[FRONTMATTER_LAST_SYNC]: new Date().toISOString(),
							}, this);
							cancelled++;
						} catch {
							errors++;
						}
					}
					continue;
				}
				const result = await createOrUpdateOwnedNote(this, record, targetFolder, templateText, existing);
				if (result.created) created++;
				if (result.updated) updated++;
				if (!result.file && !result.created && !result.updated) errors++;
			}

			for (const [syncKey, existing] of existingMap.entries()) {
				if (seen.has(syncKey)) continue;
				if (existing.owned) {
					try {
						await this.app.fileManager.trashFile(existing.file);
						deleted++;
					} catch {
						errors++;
					}
					continue;
				}
				try {
					await upsertFrontmatterOnly(existing.file, {
						[FRONTMATTER_CANCELLED]: true,
						[FRONTMATTER_LAST_SYNC]: new Date().toISOString(),
					}, this);
					cancelled++;
				} catch {
					errors++;
				}
			}

			if (options?.showNotice) {
				const affected = created + updated + deleted + cancelled;
				if (errors > 0 || affected > 0) {
					new Notice(`Epochgram: Synced ${affected} events${errors > 0 ? `, ${errors} errors` : ""}.`);
				}
			}
		} finally {
			runtime.__epochCalendarSyncRunning = false;
		}
	}
};
