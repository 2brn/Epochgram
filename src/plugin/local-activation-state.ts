import type { EpochSettings } from "../settings";

const LOCAL_ACTIVATION_STORAGE_VERSION = 1;

export const LOCAL_ACTIVATION_SETTING_KEYS = [
	"claimKeyPreview",
	"installId",
	"devicePublicKey",
	"activationEnvelope",
	"activationWitness",
	"activationGenerationFloor",
	"activationStatus",
	"lastValidationAt",
	"lastValidatedAt"
] as const;

const SYNC_SAFE_SETTING_KEYS = [
	"openEpochViewOnStartup",
	"enableAnimation",
	"compactModeMinWidthPercent",
	"searchResultsLimit",
	"trackChanges",
	"anchorMdate",
	"timelineFilters",
	"parseDatesInFrontmatter",
	"yamlDateProperty",
	"yamlDescriptionProperty",
	"summaryWordsCount",
	"filenameWordsCount",
	"summarizeAI",
	"generateEpochs",
	"openAiBridgeOnStartup",
	"openAiBridgeInObsidianWebViewer",
	"calendarSyncIcsUrls",
	"calendarSyncPeriod",
	"calendarSyncFolder",
	"calendarSyncTemplatePath",
	"proActivatedOnce",
	"completedMigrations",
	"whatsNewShownVersions",
	"whatsNewOptOut",
	"similarityUseLinks",
	"similarityUseTags",
	"similarityTitleJwThreshold",
	"similarityEmbeddingModelId",
	"similarityZeroShotModelId",
	"similarityThreshold",
	"similarityZeroShotMinScore",
	"aiBridgeOptions",
	"aiBridgeServer"
] as const;

type LocalActivationSettingKey = typeof LOCAL_ACTIVATION_SETTING_KEYS[number];
type SyncSafeSettingKey = typeof SYNC_SAFE_SETTING_KEYS[number];

type StorageLike = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
};

type WindowWithStorage = Window & {
	localStorage?: StorageLike;
};

type LocalActivationPluginLike = {
	app?: {
		vault?: {
			adapter?: { basePath?: string };
			getName?: () => string;
			configDir?: string;
		};
	};
	dataFilePath?: string;
	pluginDirPath?: string;
	manifest?: {
		id?: string;
	};
};

type LocalActivationPayload = {
	v: number;
	state: Partial<Pick<EpochSettings, LocalActivationSettingKey>>;
};

function getStorage(): StorageLike | null {
	const storage = (window as WindowWithStorage).localStorage;
	if (!storage) return null;
	if (typeof storage.getItem !== "function") return null;
	if (typeof storage.setItem !== "function") return null;
	if (typeof storage.removeItem !== "function") return null;
	return storage;
}

function fastStringHash(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

function getVaultIdentity(plugin: unknown): string {
	const pluginLike = plugin as LocalActivationPluginLike;
	const candidates = [
		String(pluginLike.app?.vault?.adapter?.basePath ?? "").trim(),
		typeof pluginLike.app?.vault?.getName === "function" ? String(pluginLike.app.vault.getName() ?? "").trim() : "",
		String(pluginLike.dataFilePath ?? "").trim(),
		String(pluginLike.pluginDirPath ?? "").trim(),
		String(pluginLike.app?.vault?.configDir ?? "").trim()
	].filter(Boolean);
	return candidates.join("|") || "default-vault";
}

function getStorageKey(plugin: unknown): string {
	const pluginLike = plugin as LocalActivationPluginLike;
	const pluginId = String(pluginLike.manifest?.id ?? "obsidian-epochgram").trim() || "obsidian-epochgram";
	const scope = fastStringHash(getVaultIdentity(plugin));
	return `${pluginId}:local-activation:${scope}`;
}

function setActivationStateValue(
	target: Partial<Pick<EpochSettings, LocalActivationSettingKey>>,
	key: LocalActivationSettingKey,
	value: string | number
): void {
	(target as Partial<Record<LocalActivationSettingKey, string | number>>)[key] = value;
}

function normalizeLocalActivationState(raw: unknown): Partial<Pick<EpochSettings, LocalActivationSettingKey>> {
	const input = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
	const next: Partial<Pick<EpochSettings, LocalActivationSettingKey>> = {};
	for (const key of LOCAL_ACTIVATION_SETTING_KEYS) {
		const value = input[key];
		if (typeof value === "string") {
			setActivationStateValue(next, key, value);
			continue;
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			setActivationStateValue(next, key, Math.max(0, Math.floor(value)));
		}
	}
	return next;
}

export function pickLocalActivationState(settings: Partial<EpochSettings> | null | undefined): Partial<Pick<EpochSettings, LocalActivationSettingKey>> {
	return normalizeLocalActivationState(settings ?? {});
}

export function stripLocalActivationState(settings: Partial<EpochSettings> | null | undefined): Partial<EpochSettings> {
	const input = (settings ?? {}) as Record<string, unknown>;
	const next: Partial<Pick<EpochSettings, SyncSafeSettingKey>> = {};
	for (const key of SYNC_SAFE_SETTING_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
		(next as Partial<Record<SyncSafeSettingKey, unknown>>)[key] = input[key];
	}
	return next;
}

export function readLocalActivationState(plugin: unknown): Partial<Pick<EpochSettings, LocalActivationSettingKey>> {
	const storage = getStorage();
	if (!storage) return {};
	try {
		const raw = storage.getItem(getStorageKey(plugin));
		if (!raw) return {};
		const parsed = JSON.parse(raw) as LocalActivationPayload | null;
		if (!parsed || parsed.v !== LOCAL_ACTIVATION_STORAGE_VERSION) return {};
		return normalizeLocalActivationState(parsed.state);
	} catch {
		return {};
	}
}

export function writeLocalActivationState(plugin: unknown, settings: Partial<EpochSettings> | null | undefined): void {
	const storage = getStorage();
	if (!storage) return;
	const state = pickLocalActivationState(settings);
	const hasAnyValue = LOCAL_ACTIVATION_SETTING_KEYS.some((key) => {
		const value = (state as Partial<Record<LocalActivationSettingKey, string | number | undefined>>)[key];
		if (typeof value === "string") return value.trim().length > 0;
		if (typeof value === "number") return value > 0;
		return false;
	});
	const storageKey = getStorageKey(plugin);
	try {
		if (!hasAnyValue) {
			storage.removeItem(storageKey);
			return;
		}
		const payload: LocalActivationPayload = {
			v: LOCAL_ACTIVATION_STORAGE_VERSION,
			state
		};
		storage.setItem(storageKey, JSON.stringify(payload));
	} catch {
		// ignore
	}
}

export function mergeSyncedSettingsWithLocalActivation(
	syncedSettings: Partial<EpochSettings> | null | undefined,
	localActivationState: Partial<Pick<EpochSettings, LocalActivationSettingKey>> | null | undefined
): Partial<EpochSettings> {
	return Object.assign({}, stripLocalActivationState(syncedSettings), normalizeLocalActivationState(localActivationState ?? {}));
}