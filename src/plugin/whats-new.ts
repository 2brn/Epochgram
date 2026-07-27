import { TFile, type WorkspaceLeaf } from "obsidian";
import type { EpochPlugin } from "../main";
import { VIEW_TYPE_WHATS_NEW } from "../ui/whats-new-view-mode";
import whatsNewPages from "epochgram-whats-new-registry";

type WhatsNewRuntime = EpochPlugin & {
	__epochWhatsNewStartupDone?: boolean;
};

type ShouldShowOptions = {
	hadSavedSettings: boolean;
	currentVersion: string;
	shownVersions: string[];
	optOut: boolean;
	availableVersions: string[];
};

type WhatsNewViewState = {
	version: string;
	markdown: string;
};

function toVersionParts(version: string): number[] {
	const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return [0, 0, 0];
	return [Number(match[1]) || 0, Number(match[2]) || 0, Number(match[3]) || 0];
}

function compareVersions(a: string, b: string): number {
	const ap = toVersionParts(a);
	const bp = toVersionParts(b);
	for (let i = 0; i < 3; i++) {
		const d = (ap[i] || 0) - (bp[i] || 0);
		if (d !== 0) return d;
	}
	return 0;
}

function getAvailablePages(): Record<string, string> {
	const raw = (whatsNewPages && typeof whatsNewPages === "object") ? whatsNewPages : {};
	const out: Record<string, string> = {};
	for (const [version, body] of Object.entries(raw)) {
		const v = String(version || "").trim();
		if (!v) continue;
		const text = String(body || "").trim();
		if (!text) continue;
		out[v] = text;
	}
	return out;
}

function resolveBundledImageResource(plugin: EpochPlugin, fileNameWithQuery: string): string | null {
	const raw = String(fileNameWithQuery || "").trim();
	if (!raw) return null;
	const fileName = (raw.split(/[?#]/, 1)[0] ?? "").trim();
	if (!fileName) return null;

	const configDir = String(plugin.app.vault.configDir || "").replace(/\\/g, "/").replace(/\/+$/, "");
	const candidates = [
		`${configDir}/plugins/${plugin.manifest.id}/images/${fileName}`,
		`${plugin.manifest.dir}/images/${fileName}`
	];

	for (const candidate of candidates) {
		const normalized = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
		const af = plugin.app.vault.getAbstractFileByPath(normalized);
		if (af instanceof TFile) {
			return plugin.app.vault.getResourcePath(af);
		}
	}

	return null;
}

export function normalizeWhatsNewMarkdownAssets(plugin: EpochPlugin, markdown: string): string {
	const source = String(markdown || "");
	let out = source.replace(/\]\((\.\.\/images\/[^)\s]+)\)/g, (full, relPath: string) => {
		const fileName = String(relPath).replace(/^\.\.\/images\//, "").trim();
		if (!fileName) return full;
		const resource = resolveBundledImageResource(plugin, fileName);
		return resource ? `](${resource})` : full;
	});

	out = out.replace(/(src=["'])(\.\.\/images\/[^"']+)(["'])/gi, (full, prefix: string, relPath: string, suffix: string) => {
		const fileName = String(relPath).replace(/^\.\.\/images\//, "").trim();
		if (!fileName) return full;
		const resource = resolveBundledImageResource(plugin, fileName);
		return resource ? `${prefix}${resource}${suffix}` : full;
	});

	return out;
}

async function openInNewLeaf(plugin: EpochPlugin, state: WhatsNewViewState): Promise<boolean> {
	try {
		const leaves = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_WHATS_NEW);
		const leaf = (leaves[0] ?? plugin.app.workspace.getLeaf(true)) as WorkspaceLeaf | null;
		if (!leaf) return false;
		await leaf.setViewState({
			type: VIEW_TYPE_WHATS_NEW,
			active: true,
			state,
		});
		await plugin.app.workspace.revealLeaf(leaf);
		plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	} catch {
		return false;
	}
}

function getShownVersions(plugin: EpochPlugin): string[] {
	const raw = (plugin.settings as { whatsNewShownVersions?: unknown }).whatsNewShownVersions;
	if (!Array.isArray(raw)) return [];
	return raw
		.map((v) => String(v || "").trim())
		.filter(Boolean);
}

function isOptOut(plugin: EpochPlugin): boolean {
	return (plugin.settings as { whatsNewOptOut?: boolean }).whatsNewOptOut === true;
}

function markShown(plugin: EpochPlugin, version: string): boolean {
	const normalized = String(version || "").trim();
	if (!normalized) return false;
	const existing = getShownVersions(plugin);
	if (existing.includes(normalized)) return false;
	existing.push(normalized);
	(plugin.settings as { whatsNewShownVersions?: string[] }).whatsNewShownVersions = existing;
	return true;
}

export function getAvailableWhatsNewVersions(): string[] {
	return Object.keys(getAvailablePages()).sort((a, b) => compareVersions(b, a));
}

export function resolveWhatsNewVersionToShow(options: ShouldShowOptions): string | null {
	if (options.optOut) return null;
	if (!options.availableVersions.length) return null;
	const sorted = [...options.availableVersions].sort((a, b) => compareVersions(b, a));
	const normalizedShown = options.shownVersions.map((v) => String(v || "").trim()).filter(Boolean);
	const shown = new Set(normalizedShown);
	const newestShown = normalizedShown.sort((a, b) => compareVersions(b, a))[0] ?? "";
	if (options.hadSavedSettings) {
		for (const version of sorted) {
			if (compareVersions(version, options.currentVersion) > 0) continue;
			if (shown.has(version)) continue;
			if (newestShown && compareVersions(version, newestShown) <= 0) continue;
			return version;
		}
		return null;
	}
	for (const version of sorted) {
		if (shown.has(version)) continue;
		if (newestShown && compareVersions(version, newestShown) <= 0) continue;
		return version;
	}
	return null;
}

export async function maybeOpenWhatsNewOnStartup(plugin: EpochPlugin, hadSavedSettings: boolean): Promise<void> {
	const runtime = plugin as WhatsNewRuntime;
	if (runtime.__epochWhatsNewStartupDone) return;
	runtime.__epochWhatsNewStartupDone = true;

	const versions = getAvailableWhatsNewVersions();
	const versionToShow = resolveWhatsNewVersionToShow({
		hadSavedSettings,
		currentVersion: String(plugin.manifest?.version || ""),
		shownVersions: getShownVersions(plugin),
		optOut: isOptOut(plugin),
		availableVersions: versions,
	});
	if (!versionToShow) return;

	const body = getAvailablePages()[versionToShow] ?? "";
	if (!body.trim()) return;
	const rendered = normalizeWhatsNewMarkdownAssets(plugin, body);

	const opened = await openInNewLeaf(plugin, {
		version: versionToShow,
		markdown: rendered,
	});
	if (!opened) return;

	if (markShown(plugin, versionToShow)) {
		await plugin.saveSettings();
	}
}

export async function setWhatsNewOptOut(plugin: EpochPlugin, checked: boolean): Promise<void> {
	const next = checked === true;
	const prev = isOptOut(plugin);
	if (prev === next) return;
	(plugin.settings as { whatsNewOptOut?: boolean }).whatsNewOptOut = next;
	await plugin.saveSettings();
}
