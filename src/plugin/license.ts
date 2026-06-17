import { Notice, Platform, requestUrl } from "obsidian";
import type { EpochPlugin } from "../main";
import {
	RESET_PRO_SIMILARITY_THRESHOLD,
	RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE
} from "../settings-reset-defaults";
import { formatDate, NOTE_TITLE_SIMILARITY_JW_THRESHOLD } from "../utils";
import { normalizeSnapshotValue } from "../indexer/snapshot-helpers";
import { runSimilarityStartupMaintenance } from "./similarity/startup-maintenance";
import { isTrackChangesEffective } from "./pro-feature-state";
import { ensureDeviceProofMaterial, ensureInstallId, signUpdateChallenge } from "./device-proof";
import {
	clearTrustedActivationCache,
	getCurrentPluginVersion,
	getStoredActivationEnvelope,
	getStoredActivationWitness,
	getVerifiedLicenseHolder,
	hasTrustedActivationState,
	hasVerifiedFeatureAccess,
	needsActivationValidationForCurrentVersion,
	verifyStoredActivationEnvelope,
	type SignedEntitlementEnvelope
} from "./pro-trust";

const DEFAULT_PRO_BACKEND_BASE_URL = "https://www.epochgram.com";
const MAX_BACKEND_REDIRECTS = 4;

const PRO_STATUS_INACTIVE = "inactive";
const PRO_STATUS_ACTIVE = "active";
const PRO_STATUS_VALIDATING = "validating";
const PRO_STATUS_ERROR = "error";
const PRO_STATUS_INVALID = "invalid";
const PRO_STATUS_INVALID_CLAIM = "invalid-claim";
const PRO_STATUS_REVOKED = "revoked";
const PRO_STATUS_DEVICE_LIMIT = "device-limit";

const KNOWN_PRO_STATUSES = new Set([
	PRO_STATUS_INACTIVE,
	PRO_STATUS_ACTIVE,
	PRO_STATUS_VALIDATING,
	PRO_STATUS_ERROR,
	PRO_STATUS_INVALID,
	PRO_STATUS_INVALID_CLAIM,
	PRO_STATUS_REVOKED,
	PRO_STATUS_DEVICE_LIMIT
]);

type ActivateSuccessResponse = {
	certificate?: SignedEntitlementEnvelope | string;
	holder?: string;
	error?: string;
	message?: string;
};

type ValidateSuccessResponse = {
	valid?: boolean;
	certificate?: SignedEntitlementEnvelope | string;
	holder?: string;
	challenge?: string;
	error?: string;
	message?: string;
};

type ValidationOptions = {
	force?: boolean;
	source?: string;
};

const STARTUP_VALIDATION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface LicenseMethods {
	refreshLicenseState(saveIfChanged?: boolean): Promise<boolean>;
	disableProViewPreferences(): void;
	hasProAccess(): boolean;
	applyClaimKey(rawKey: string): Promise<{ valid: boolean; message: string }>;
	notifyProFeature(feature: string): void;
	ensureDeviceIdentity(saveIfChanged?: boolean): string;
	validateStoredActivationToken(options?: ValidationOptions): Promise<boolean>;
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? String(value).trim() : "";
}

function getPlatformLabel(): string {
	if (Platform.isMobileApp) {
		const mobileOs = String((window as any)?.process?.platform ?? "").trim().toLowerCase();
		if (mobileOs === "darwin") return "iOS";
		if (mobileOs === "android") return "Android";
		return "Mobile";
	}
	try {
		const p = String((window as any)?.process?.platform ?? "").trim().toLowerCase();
		if (p === "win32") return "Windows";
		if (p === "darwin") return "macOS";
		if (p === "linux") return "Linux";
	} catch {
		// ignore
	}
	return "Unknown";
}

function getHumanDeviceName(): string {
	const kind = Platform.isMobileApp ? "Obsidian Mobile" : "Obsidian Desktop";
	return `${kind} (${getPlatformLabel()})`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function buildClaimKeyPreview(rawKey: string): string {
	const normalized = String(rawKey ?? "").trim().toUpperCase();
	if (!normalized) return "";
	const segments = normalized.split("-").filter(Boolean);
	if (segments.length >= 3) {
		return [segments[0], segments[1], ...segments.slice(2).map(() => "XXXX")].join("-");
	}
	if (normalized.length <= 8) return normalized;
	return `${normalized.slice(0, 8)}${"X".repeat(Math.max(0, normalized.length - 8))}`;
}

function activationKeepsProUnlocked(plugin: EpochPlugin): boolean {
	if (!getStoredActivationEnvelope(plugin)) return false;
	if (!hasTrustedActivationState(plugin)) return false;
	const status = String(plugin.settings.activationStatus ?? PRO_STATUS_INACTIVE).trim();
	return status !== PRO_STATUS_INACTIVE
		&& status !== PRO_STATUS_INVALID
		&& status !== PRO_STATUS_INVALID_CLAIM
		&& status !== PRO_STATUS_REVOKED
		&& status !== PRO_STATUS_DEVICE_LIMIT;
}

function setActivationMetadata(
	plugin: EpochPlugin,
	data: {
		claimKeyPreview?: string;
		installId?: string;
		devicePublicKey?: string;
		envelope?: string;
		witness?: string;
		generationFloor?: number;
		status?: string;
		error?: string;
		lastValidationAt?: string;
		lastValidatedAt?: string;
	}
): void {
	if (typeof data.claimKeyPreview === "string") plugin.settings.claimKeyPreview = data.claimKeyPreview;
	if (typeof data.installId === "string") (plugin.settings as any).installId = data.installId;
	if (typeof data.devicePublicKey === "string") (plugin.settings as any).devicePublicKey = data.devicePublicKey;
	if (typeof data.envelope === "string") (plugin.settings as any).activationEnvelope = data.envelope;
	if (typeof data.witness === "string") (plugin.settings as any).activationWitness = data.witness;
	if (typeof data.generationFloor === "number" && Number.isFinite(data.generationFloor)) {
		(plugin.settings as any).activationGenerationFloor = Math.max(0, Math.floor(data.generationFloor));
	}
	if (typeof data.status === "string") plugin.settings.activationStatus = data.status;
	if (typeof data.error === "string") plugin.settings.activationError = data.error;
	if (typeof data.lastValidationAt === "string") plugin.settings.lastValidationAt = data.lastValidationAt;
	if (typeof data.lastValidatedAt === "string") (plugin.settings as any).lastValidatedAt = data.lastValidatedAt;
}

function clearStoredActivation(plugin: EpochPlugin, status: string, error: string): void {
	plugin.settings.claimKeyPreview = "";
	(plugin.settings as any).devicePublicKey = "";
	(plugin.settings as any).activationEnvelope = "";
	(plugin.settings as any).activationWitness = "";
	plugin.settings.activationStatus = status;
	plugin.settings.activationError = error;
	(plugin.settings as any).lastValidatedAt = "";
	clearTrustedActivationCache(plugin);
}

function clearStoredActivationKeepClaimKeyPreview(plugin: EpochPlugin, status: string, error: string): void {
	(plugin.settings as any).devicePublicKey = "";
	(plugin.settings as any).activationEnvelope = "";
	(plugin.settings as any).activationWitness = "";
	plugin.settings.activationStatus = status;
	plugin.settings.activationError = error;
	(plugin.settings as any).lastValidatedAt = "";
	clearTrustedActivationCache(plugin);
}

function restoreEffectiveProViewPreferences(plugin: EpochPlugin): void {
	const timelineDefaults = plugin.settings.timelineFilters ?? {};
	const showDraftsOnly = false;
	if (plugin.viewPreferences) {
		plugin.viewPreferences.showDraftsOnly = showDraftsOnly;
		plugin.viewPreferences.showTrackedChanges = timelineDefaults.showTrackedChanges !== false;
	}
}

function deactivateProRuntimeState(plugin: EpochPlugin): void {
	plugin.proActive = false;
	plugin.licenseHolder = "";
	licenseMethods.disableProViewPreferences.call(plugin);
	clearTrustedActivationCache(plugin);
}

function applyFirstTimeProDefaults(plugin: EpochPlugin, hasActivatedProOnce: boolean): boolean {
	let activatedFirstTime = false;
	if (!hasActivatedProOnce) {
		plugin.settings.proActivatedOnce = true;
		plugin.settings.trackChanges = true;
		if (plugin.viewPreferences) {
			plugin.viewPreferences.showTrackedChanges = true;
			try {
				plugin.refreshEpochViews();
			} catch {
				// ignore
			}
		}
		plugin.settings.similarityTitleJwThreshold = NOTE_TITLE_SIMILARITY_JW_THRESHOLD;
			plugin.settings.similarityThreshold = RESET_PRO_SIMILARITY_THRESHOLD;
			plugin.settings.similarityZeroShotMinScore = RESET_PRO_SIMILARITY_ZERO_SHOT_MIN_SCORE;
		plugin.settings.similarityUseLinks = true;
		plugin.settings.similarityUseTags = true;
		activatedFirstTime = true;
	}
	return activatedFirstTime;
}

async function postBackendJson(path: string, body: Record<string, unknown>): Promise<{ status: number; json: any; text: string }> {
	const requestBody = JSON.stringify(body);
	let url = `${DEFAULT_PRO_BACKEND_BASE_URL}${path}`;
	let lastResponse: any = null;
	for (let attempt = 0; attempt <= MAX_BACKEND_REDIRECTS; attempt++) {
		const response = await requestUrl({
			url,
			method: "POST",
			contentType: "application/json",
			headers: {
				Accept: "application/json"
			},
			body: requestBody,
			throw: false
		});
		lastResponse = response;
		const status = Number(response?.status ?? 0);
		const location = getHeaderValue(response?.headers, "location");
		if ((status === 307 || status === 308) && location) {
			const nextUrl = resolveRedirectUrl(url, location);
			if (nextUrl && nextUrl !== url && isAllowedRedirectUrl(nextUrl)) {
				url = nextUrl;
				continue;
			}
		}
		return {
			status,
			json: response?.json ?? {},
			text: typeof response?.text === "string" ? response.text : ""
		};
	}
	return {
		status: Number(lastResponse?.status ?? 0),
		json: lastResponse?.json ?? {},
		text: typeof lastResponse?.text === "string" ? lastResponse.text : ""
	};
}

function getHeaderValue(headers: unknown, name: string): string {
	const rawName = String(name ?? "").trim();
	const key = rawName.toLowerCase();
	if (!headers || !key) return "";
	const anyHeaders: any = headers as any;
	try {
		if (typeof anyHeaders.get === "function") {
			const value = anyHeaders.get(key) ?? anyHeaders.get(rawName);
			return String(value ?? "").trim();
		}
	} catch {
		// ignore
	}
	if (typeof anyHeaders === "object") {
		try {
			const direct =
				anyHeaders[rawName] ??
				anyHeaders[key] ??
				anyHeaders[rawName.toUpperCase()] ??
				anyHeaders[rawName.toLowerCase()];
			if (direct != null) {
				if (typeof direct === "string") return direct.trim();
				if (typeof direct === "number" || typeof direct === "boolean" || typeof direct === "bigint") return String(direct).trim();
			}
		} catch {
			// ignore
		}
		for (const [rawKey, rawValue] of Object.entries(anyHeaders)) {
			if (String(rawKey).trim().toLowerCase() !== key) continue;
			if (typeof rawValue === "string") return rawValue.trim();
			if (typeof rawValue === "number" || typeof rawValue === "boolean" || typeof rawValue === "bigint") return String(rawValue).trim();
			return "";
		}
	}
	return "";
}

function resolveRedirectUrl(currentUrl: string, location: string): string {
	const raw = String(location ?? "").trim();
	if (!raw) return "";
	try {
		return new URL(raw, currentUrl).toString();
	} catch {
		return raw;
	}
}

function isAllowedRedirectUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:") return false;
		const host = parsed.hostname.toLowerCase();
		return host === "epochgram.com" || host === "www.epochgram.com";
	} catch {
		return false;
	}
}

function summarizeBackendErrorText(raw: unknown): string {
	const text = (typeof raw === "string")
		? raw
		: (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint")
			? String(raw)
			: "";
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.startsWith("<") || /^<!doctype html/i.test(normalized)) return "";
	if (normalized.startsWith("{") || normalized.startsWith("[")) return "";
	return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized;
}

function buildActivationNoticeMessage(): string {
	return "Couldn't activate Epochgram Pro right now. Try again in a moment.";
}

function buildActivationError(status: number, payload: ActivateSuccessResponse, text: string = ""): { status: string; message: string } {
	const raw = String(payload?.error ?? payload?.message ?? summarizeBackendErrorText(text)).trim();
	if (status === 404) {
		return { status: PRO_STATUS_INVALID_CLAIM, message: "License key not found" };
	}
	if (status === 403) {
		return { status: PRO_STATUS_REVOKED, message: raw || "This license key is inactive or revoked. Contact support if this seems wrong." };
	}
	if (status === 409) {
		return {
			status: PRO_STATUS_DEVICE_LIMIT,
			message: raw || "Device limit reached. Contact support."
		};
	}
	if (status === 400) {
		return { status: PRO_STATUS_ERROR, message: raw || "License key not found" };
	}
	return { status: PRO_STATUS_ERROR, message: raw || buildActivationNoticeMessage() };
}

function buildValidationFailure(payload: ValidateSuccessResponse): { status: string; message: string } {
	const rawMessage = String(payload?.error ?? payload?.message ?? "").trim();
	const raw = rawMessage.toLowerCase();
	if (raw.includes("revok") || raw.includes("inactive")) {
		return {
			status: PRO_STATUS_REVOKED,
			message: rawMessage || "This activation is inactive or revoked. Paste your license key again to reactivate this device."
		};
	}
	return {
		status: PRO_STATUS_INVALID,
		message: rawMessage || "This activation is no longer valid. Paste your license key again to reactivate this device."
	};
}

function buildChallengePayload(plugin: EpochPlugin, challenge: string, installId: string, devicePublicKey: string): string {
	return JSON.stringify({
		challenge,
		pluginId: String(plugin.manifest.id ?? "obsidian-epochgram"),
		pluginVersion: getCurrentPluginVersion(plugin),
		installId,
		devicePublicKey
	});
}

function normalizeEnvelopeString(value: SignedEntitlementEnvelope | string | undefined): string {
	if (typeof value === "string") return value.trim();
	if (!value || typeof value !== "object") return "";
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}

async function acceptSignedEnvelope(
	plugin: EpochPlugin,
	params: {
		claimKeyPreview: string;
		envelope: string;
		status: string;
		lastValidationAt: string;
		lastValidatedAt: string;
		expectedRefreshChallenge?: string;
	}
): Promise<boolean> {
	setActivationMetadata(plugin, {
		claimKeyPreview: params.claimKeyPreview,
		status: params.status,
		error: "",
		envelope: params.envelope,
		witness: "",
		lastValidationAt: params.lastValidationAt,
		lastValidatedAt: params.lastValidatedAt
	});
	const verified = await verifyStoredActivationEnvelope(plugin, {
		expectedRefreshChallenge: params.expectedRefreshChallenge
	});
	if (!verified) return false;
	setActivationMetadata(plugin, {
		installId: verified.claims.installId,
		devicePublicKey: verified.claims.devicePublicKey,
		witness: verified.witness,
		generationFloor: verified.claims.licenseGeneration,
		status: params.status,
		error: "",
		lastValidationAt: params.lastValidationAt,
		lastValidatedAt: params.lastValidatedAt
	});
	return true;
}

export const licenseMethods: LicenseMethods = {
	async refreshLicenseState(this: EpochPlugin, saveIfChanged: boolean = false): Promise<boolean> {
		const prevPro = this.proActive;
		const prevHolder = this.licenseHolder;
		let dirty = false;
		const normalizeField = (key: string): string => {
			const current = normalizeText((this.settings as any)[key]);
			if ((this.settings as any)[key] !== current) {
				(this.settings as any)[key] = current;
				dirty = true;
			}
			return current;
		};
		const normalizeGenerationFloor = (): number => {
			const raw = Number((this.settings as any).activationGenerationFloor ?? 0);
			const current = Number.isInteger(raw) && raw > 0 ? raw : 0;
			if ((this.settings as any).activationGenerationFloor !== current) {
				(this.settings as any).activationGenerationFloor = current;
				dirty = true;
			}
			return current;
		};

		normalizeField("claimKeyPreview");
		normalizeField("installId");
		normalizeField("devicePublicKey");
		normalizeField("activationEnvelope");
		normalizeField("activationWitness");
		normalizeGenerationFloor();
		normalizeField("activationStatus");
		normalizeField("activationError");
		normalizeField("lastValidationAt");
		normalizeField("lastValidatedAt");

		let status = normalizeText(this.settings.activationStatus) || PRO_STATUS_INACTIVE;
		if (!KNOWN_PRO_STATUSES.has(status)) {
			status = PRO_STATUS_INACTIVE;
			this.settings.activationStatus = status;
			this.settings.activationError = "";
			dirty = true;
		}

		const envelope = getStoredActivationEnvelope(this);
		const witness = getStoredActivationWitness(this);
		if (!envelope) {
			if (status === PRO_STATUS_ACTIVE || status === PRO_STATUS_VALIDATING) {
				this.settings.activationStatus = PRO_STATUS_INACTIVE;
				status = PRO_STATUS_INACTIVE;
				dirty = true;
			}
			if (witness) {
				(this.settings as any).activationWitness = "";
				dirty = true;
			}
			clearTrustedActivationCache(this);
		}

		const verified = envelope ? await verifyStoredActivationEnvelope(this) : null;
		if (verified) {
			const generationFloor = Number((this.settings as any).activationGenerationFloor ?? 0);
			if (!Number.isInteger(generationFloor) || generationFloor < verified.claims.licenseGeneration) {
				(this.settings as any).activationGenerationFloor = verified.claims.licenseGeneration;
				dirty = true;
			}
			if (getStoredActivationWitness(this) !== verified.witness) {
				(this.settings as any).activationWitness = verified.witness;
				dirty = true;
			}
			if (this.settings.activationStatus !== PRO_STATUS_ACTIVE) {
				this.settings.activationStatus = PRO_STATUS_ACTIVE;
				dirty = true;
			}
			this.settings.activationError = "";
		} else if (envelope) {
			clearTrustedActivationCache(this);
			if (status === PRO_STATUS_ACTIVE || status === PRO_STATUS_VALIDATING) {
				this.settings.activationStatus = PRO_STATUS_INVALID;
				dirty = true;
			}
			if (witness) {
				(this.settings as any).activationWitness = "";
				dirty = true;
			}
		}

		if (activationKeepsProUnlocked(this)) {
			this.proActive = true;
			this.licenseHolder = verified?.claims.holder || getVerifiedLicenseHolder(this);
			if (!prevPro) restoreEffectiveProViewPreferences(this);
		} else {
			deactivateProRuntimeState(this);
		}

		const proActivated = !prevPro && this.proActive;
		const changed = dirty || this.proActive !== prevPro || this.licenseHolder !== prevHolder;
		if (changed) {
			try {
				(this.indexer as any)?.refreshSyntheticEntries?.();
			} catch {
				// ignore
			}
			try {
				this.refreshEpochViews();
			} catch {
				// ignore
			}
			try {
				(this as any).__epochSettingTab?.display?.();
			} catch {
				// ignore
			}
		}
		try {
			void (this as any).refreshAiBridgeStatusBar?.();
		} catch {
			// ignore
		}
		if (proActivated) {
			try {
				void (this as any).maybeOpenAiBridgeOnStartup?.();
			} catch {
				// ignore
			}
		}
		if (saveIfChanged && changed) {
			await this.saveSettings();
		}
		return changed;
	},

	disableProViewPreferences(this: EpochPlugin): void {
		const prefs = this.viewPreferences;
		if (!prefs) return;
		if (prefs.showDraftsOnly || prefs.showTrackedChanges || prefs.showEpochsView) {
			prefs.showDraftsOnly = false;
			prefs.showTrackedChanges = false;
			prefs.showEpochsView = false;
			try {
				this.refreshEpochViews();
			} catch {
				// ignore
			}
		}
	},

	hasProAccess(this: EpochPlugin): boolean {
		return this.proActive && hasTrustedActivationState(this);
	},

	ensureDeviceIdentity(this: EpochPlugin, saveIfChanged: boolean = false): string {
		return ensureInstallId(this, saveIfChanged);
	},

	async validateStoredActivationToken(this: EpochPlugin, options: ValidationOptions = {}): Promise<boolean> {
		const force = options.force === true;
		const source = String(options.source ?? "");
		const envelope = getStoredActivationEnvelope(this);
		if (!envelope) return false;
		const shouldValidateForVersion = needsActivationValidationForCurrentVersion(this);
		if (source === "startup" && !force && !shouldValidateForVersion) {
			const lastValidationAt = normalizeText(this.settings.lastValidationAt);
			const lastMs = lastValidationAt ? Date.parse(lastValidationAt) : NaN;
			const nowMs = Date.now();
			if (Number.isFinite(lastMs) && nowMs > lastMs && nowMs - lastMs < STARTUP_VALIDATION_MIN_INTERVAL_MS) {
				return false;
			}
			// Version doesn't require validation, but we haven't checked in 24h: allow a refresh attempt.
		}

		const maybeShowStartupValidationFailureNotice = (): void => {
			if (source !== "startup") return;
			try {
				const anyThis: any = this as any;
				if (anyThis.__epochProStartupValidationFailureNoticeShown) return;
				anyThis.__epochProStartupValidationFailureNoticeShown = true;
			} catch { void 0; }
			try {
				new Notice(
					"Epochgram Pro: couldn't validate license on startup. Pro stays locked until validation succeeds.",
					8000
				);
			} catch { void 0; }
		};

		const anyThis: any = this as any;
		if (anyThis.__proValidationPromise) {
			return await anyThis.__proValidationPromise;
		}

		anyThis.__proValidationPromise = (async () => {
			const nowText = new Date().toISOString();
			const installId = ensureInstallId(this);
			const { publicKey } = await ensureDeviceProofMaterial(this);
			const challenge = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const challengePayload = buildChallengePayload(this, challenge, installId, publicKey);
			try {
				setActivationMetadata(this, { status: PRO_STATUS_VALIDATING, error: "" });
				const response = await postBackendJson("/api/pro/validate", {
					installId,
					devicePublicKey: publicKey,
					deviceName: getHumanDeviceName(),
					pluginVersion: getCurrentPluginVersion(this),
					challenge,
					challengeSignature: await signUpdateChallenge(this, challengePayload),
					certificate: envelope,
					// TODO(epochgram-web): verify the signed challenge with the stored device public key and return a fresh certificate.
				});
				const payload = (response.json ?? {}) as ValidateSuccessResponse;
				if (response.status >= 200 && response.status < 300 && payload?.valid === true) {
					const nextEnvelope = normalizeEnvelopeString(payload.certificate);
					if (!nextEnvelope) {
						maybeShowStartupValidationFailureNotice();
						clearStoredActivationKeepClaimKeyPreview(this, PRO_STATUS_INVALID, "");
						this.settings.lastValidationAt = nowText;
						const changed = await this.refreshLicenseState();
						await this.saveSettings();
						return changed || true;
					}
					const accepted = await acceptSignedEnvelope(this, {
						claimKeyPreview: normalizeText(this.settings.claimKeyPreview),
						envelope: nextEnvelope,
						status: PRO_STATUS_ACTIVE,
						lastValidationAt: nowText,
						lastValidatedAt: nowText,
						expectedRefreshChallenge: challenge
					});
					if (!accepted) {
						maybeShowStartupValidationFailureNotice();
						clearStoredActivationKeepClaimKeyPreview(this, PRO_STATUS_INVALID, "");
						this.settings.lastValidationAt = nowText;
						const changed = await this.refreshLicenseState();
						await this.saveSettings();
						return changed || true;
					}
					if (payload.challenge && String(payload.challenge).trim() !== challenge) {
						maybeShowStartupValidationFailureNotice();
						clearStoredActivationKeepClaimKeyPreview(this, PRO_STATUS_INVALID, "");
						this.settings.lastValidationAt = nowText;
						const changed = await this.refreshLicenseState();
						await this.saveSettings();
						return changed || true;
					}
					const changed = await this.refreshLicenseState();
					await this.saveSettings();
					return changed || true;
				}

				maybeShowStartupValidationFailureNotice();
				const failure = buildValidationFailure(payload);
				clearStoredActivationKeepClaimKeyPreview(this, failure.status, failure.message);
				this.settings.lastValidationAt = nowText;
				const changed = await this.refreshLicenseState();
				await this.saveSettings();
				return changed || true;
			} catch {
				this.settings.lastValidationAt = nowText;
				this.settings.activationStatus = PRO_STATUS_ERROR;
				this.settings.activationError = "";
				const changed = await this.refreshLicenseState();
				await this.saveSettings();
				return changed || true;
			} finally {
				anyThis.__proValidationPromise = null;
				try {
					void (this as any).refreshAiBridgeStatusBar?.();
				} catch {
					// ignore
				}
			}
		})();

		return await anyThis.__proValidationPromise;
	},

	async applyClaimKey(this: EpochPlugin, rawKey: string): Promise<{ valid: boolean; message: string }> {
		const trimmed = rawKey.trim();
		const previouslyTracking = isTrackChangesEffective(this);
		const hasActivatedProOnce = this.settings.proActivatedOnce === true;
		let activatedFirstTime = false;

		const seedTrackedBaselineLightweight = async (): Promise<void> => {
			try {
				if (typeof (this as any)?.ensureIndexLoaded !== "function") return;
				if (typeof (this as any)?.persist !== "function") return;
				if (!this.app?.vault?.adapter || typeof this.app.vault.adapter.read !== "function") return;
				await (this as any).ensureIndexLoaded();
				const indexerAny: any = this.indexer as any;
				const files: Record<string, any> = indexerAny?.files ?? {};
				const latestLines: Record<string, string[]> = indexerAny?.latestLines ?? {};
				const today = formatDate(new Date());
				const paths = Object.keys(files).filter((p) => String(p).toLowerCase().endsWith(".md"));
				let touched = 0;
				for (let i = 0; i < paths.length; i++) {
					const path = paths[i] as string;
					const data = files[path];
					if (!data) continue;
					let content = "";
					const cached = latestLines[path];
					if (Array.isArray(cached) && cached.length > 0) {
						content = cached.join("\n");
					} else {
						try {
							content = await this.app.vault.adapter.read(path);
						} catch {
							continue;
						}
					}
					const snap = normalizeSnapshotValue(content) ?? "";
					data.trackedDates = {};
					data.trackedSnapshot = snap;
					data.trackedSnapshotDate = today;
					data.trackedBaselineSnapshot = snap;
					data.trackedBaselineDate = today;
					touched++;
					if (touched % 25 === 0) {
						await new Promise((r) => window.setTimeout(r, 0));
					}
				}
				if (touched > 0) {
					await (this as any).persist({ skipEnsure: true });
				}
			} catch {
				// ignore
			}
		};

		if (!trimmed) {
			this.settings.activationStatus = PRO_STATUS_INVALID_CLAIM;
			this.settings.activationError = "";
			(this.settings as any).activationEnvelope = "";
			(this.settings as any).activationWitness = "";
			await this.saveSettings();
			return {
				valid: false,
				message: "Paste your license key to activate Epochgram Pro."
			};
		}

		const installId = ensureInstallId(this);
		const { publicKey } = await ensureDeviceProofMaterial(this);
		const deviceName = getHumanDeviceName();

		try {
			const response = await postBackendJson("/api/pro/activate", {
				claimKey: trimmed,
				installId,
				devicePublicKey: publicKey,
				deviceName,
				pluginVersion: getCurrentPluginVersion(this),
				// TODO(epochgram-web): issue a signed certificate bound to installId, devicePublicKey, pluginVersion, and features.
			});
			const payload = (response.json ?? {}) as ActivateSuccessResponse;
			const envelope = normalizeEnvelopeString(payload.certificate);
			if (response.status >= 200 && response.status < 300 && envelope) {
				const accepted = await acceptSignedEnvelope(this, {
					claimKeyPreview: buildClaimKeyPreview(trimmed),
					envelope,
					status: PRO_STATUS_ACTIVE,
					lastValidationAt: nowIso(),
					lastValidatedAt: nowIso()
				});
				if (!accepted) {
					clearStoredActivation(this, PRO_STATUS_INVALID, "");
					await this.refreshLicenseState();
					await this.saveSettings();
					return {
						valid: false,
						message: buildActivationNoticeMessage()
					};
				}
				await this.refreshLicenseState();
				activatedFirstTime = applyFirstTimeProDefaults(this, hasActivatedProOnce);

				const trackingJustEnabled = isTrackChangesEffective(this) && !previouslyTracking;
				if (trackingJustEnabled && !activatedFirstTime) {
					await this.onSettingsChanged("trackChanges");
				} else {
					await this.saveSettings();
					this.registerFileEvents();
					if (activatedFirstTime && trackingJustEnabled) {
						void seedTrackedBaselineLightweight();
					}
					if (activatedFirstTime) {
						try {
							void (this as any).recomputeInheritedMarksNow?.("similarityUseLinks");
							void (this as any).recomputeInheritedMarksNow?.("similarityUseTags");
							void (this as any).recomputeInheritedMarksNow?.("similarityTitleJwThreshold");
						} catch {
							// ignore
						}
					}
				}
				this.refreshEpochViews();
				void (async () => {
					try {
						if (!hasVerifiedFeatureAccess(this, "similarity")) return;
					} catch {
						return;
					}
					try {
						await (this as any).ensureIndexLoaded?.();
					} catch {
						// ignore
					}
					try {
						await runSimilarityStartupMaintenance(this);
					} catch {
						// ignore
					}
				})();

				return {
					valid: true,
					message: "Epochgram Pro activated on this device."
				};
			}

			const failure = buildActivationError(response.status, payload, response.text ?? "");
			clearStoredActivation(this, failure.status, "");
			await this.refreshLicenseState();
			await this.saveSettings();
			return {
				valid: false,
				message: failure.message || buildActivationNoticeMessage()
			};
		} catch (error) {
			const errorMessage = summarizeBackendErrorText(error instanceof Error ? error.message : error);
			this.settings.activationStatus = PRO_STATUS_ERROR;
			this.settings.activationError = "";
			await this.refreshLicenseState();
			await this.saveSettings();
			return {
				valid: false,
				message: errorMessage || buildActivationNoticeMessage()
			};
		}
	},

	notifyProFeature(this: EpochPlugin, feature: string): void {
		if (this.hasProAccess()) return;
		if (this.proNoticesShown.has(feature)) return;
		this.proNoticesShown.add(feature);
	}
};
