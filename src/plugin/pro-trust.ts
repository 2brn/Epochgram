export type EntitlementFeature =
	| "trackChanges"
	| "recurring"
	| "summarizeAI"
	| "generateEpochs"
	| "aiBridge"
	| "similarity";

export type EntitlementClaims = {
	schema: number;
	issuer: string;
	audience: string;
	licenseId: string;
	licenseGeneration: number;
	installId: string;
	devicePublicKey: string;
	pluginVersion: string;
	features: EntitlementFeature[];
	issuedAt: string;
	notBefore?: string;
	expiresAt?: string;
	holder?: string;
	refreshChallenge?: string;
};

export type SignedEntitlementEnvelope = {
	version: number;
	keyId: string;
	algorithm: string;
	payload: string;
	signature: string;
};

import { decodeBase64, encodeBase64 } from "./base64";

type RuntimeEntitlementCache = {
	cacheKey: string;
	witness: string;
	claims: EntitlementClaims;
	features: Set<EntitlementFeature>;
	holder: string;
};

const ENTITLEMENT_SCHEMA_VERSION = 1;
const DEFAULT_AUDIENCE = "obsidian-epochgram";
const DEFAULT_ALGORITHM = "ECDSA-P256-SHA256";
const SERVER_VERIFY_KEY_ID = "epochgram-20260411";
const SERVER_VERIFY_KEY_DER = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE72MNoiEZ5lYpKtBk6zXWpI0J2SV2/OSMsgnqL0Wrq/IyY5AjXCY8Jutpv8rpF52SfW6kmwJxx9XC2uBJ7dxQ3A==";
let serverVerifyKeyId = SERVER_VERIFY_KEY_ID;
let serverVerifyKeyDer = SERVER_VERIFY_KEY_DER;

export function __setServerVerifyKeyForTests(options: { keyId?: string; der?: string }): void {
	if (typeof options.keyId === "string" && options.keyId.trim()) serverVerifyKeyId = options.keyId.trim();
	if (typeof options.der === "string" && options.der.trim()) serverVerifyKeyDer = options.der.trim();
	verifyKeyPromise = null;
}

const ENTITLEMENT_FEATURES: EntitlementFeature[] = [
	"trackChanges",
	"recurring",
	"summarizeAI",
	"generateEpochs",
	"aiBridge",
	"similarity"
];

let verifyKeyPromise: Promise<CryptoKey> | null = null;

function normalizeText(value: unknown): string {
	return typeof value === "string" ? String(value).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function utf8Bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	const encoded = encodeBase64(bytes);
	return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
	const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
	return decodeBase64(padded);
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function derSignatureToP1363(bytes: Uint8Array, limbSize: number = 32): Uint8Array | null {
	if (bytes.length < 8 || bytes[0] !== 0x30) return null;
	let offset = 1;
	let seqLen = bytes[offset++];
	if (seqLen & 0x80) {
		const lenBytes = seqLen & 0x7f;
		if (lenBytes <= 0 || lenBytes > 2 || offset + lenBytes > bytes.length) return null;
		seqLen = 0;
		for (let i = 0; i < lenBytes; i++) {
			seqLen = (seqLen << 8) | bytes[offset++];
		}
	}
	if (offset + seqLen > bytes.length) return null;
	if (bytes[offset++] !== 0x02) return null;
	const rLen = bytes[offset++];
	if (offset + rLen > bytes.length) return null;
	const r = bytes.slice(offset, offset + rLen);
	offset += rLen;
	if (bytes[offset++] !== 0x02) return null;
	const sLen = bytes[offset++];
	if (offset + sLen > bytes.length) return null;
	const s = bytes.slice(offset, offset + sLen);
	const out = new Uint8Array(limbSize * 2);
	const rTrimmed = r.length > limbSize ? r.slice(r.length - limbSize) : r;
	const sTrimmed = s.length > limbSize ? s.slice(s.length - limbSize) : s;
	out.set(rTrimmed, limbSize - rTrimmed.length);
	out.set(sTrimmed, out.length - sTrimmed.length);
	return out;
}

function stableStringify(value: unknown): string {
	if (value == null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	if (!isRecord(value)) return "null";
	const keys = Object.keys(value).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function normalizeFeatures(raw: unknown): EntitlementFeature[] {
	const seen = new Set<EntitlementFeature>();
	const out: EntitlementFeature[] = [];
	for (const value of Array.isArray(raw) ? raw : []) {
		const normalized = normalizeText(value) as EntitlementFeature;
		if (!ENTITLEMENT_FEATURES.includes(normalized)) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out.sort();
}

function parseIso(value: string): number | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

function parseGeneration(value: unknown): number {
	const numeric = Number(value);
	return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function getStoredActivationGenerationFloor(plugin: any): number {
	return parseGeneration(plugin?.settings?.activationGenerationFloor);
}

function getCurrentAudience(plugin: any): string {
	return normalizeText(plugin?.manifest?.id) || DEFAULT_AUDIENCE;
}

function parseEnvelope(raw: unknown): SignedEntitlementEnvelope | null {
	const input = typeof raw === "string"
		? (() => {
			try {
				return JSON.parse(raw) as unknown;
			} catch {
				return null;
			}
		})()
		: raw;
	if (!isRecord(input)) return null;
	const version = Number(input.version ?? 0);
	const keyId = normalizeText(input.keyId);
	const algorithm = normalizeText(input.algorithm) || DEFAULT_ALGORITHM;
	const payload = normalizeText(input.payload);
	const signature = normalizeText(input.signature);
	if (version !== ENTITLEMENT_SCHEMA_VERSION || !keyId || !payload || !signature) return null;
	return { version, keyId, algorithm, payload, signature };
}

function parseClaims(envelope: SignedEntitlementEnvelope | null): EntitlementClaims | null {
	if (!envelope) return null;
	try {
		const json = new TextDecoder().decode(base64UrlToBytes(envelope.payload));
		const input = JSON.parse(json) as unknown;
		if (!isRecord(input)) return null;
		const claims: EntitlementClaims = {
			schema: Number(input.schema ?? 0),
			issuer: normalizeText(input.issuer),
			audience: normalizeText(input.audience),
			licenseId: normalizeText(input.licenseId),
			licenseGeneration: parseGeneration(input.licenseGeneration),
			installId: normalizeText(input.installId),
			devicePublicKey: normalizeText(input.devicePublicKey),
			pluginVersion: normalizeText(input.pluginVersion),
			features: normalizeFeatures(input.features),
			issuedAt: normalizeText(input.issuedAt),
			notBefore: normalizeText(input.notBefore),
			expiresAt: normalizeText(input.expiresAt),
			holder: normalizeText(input.holder),
			refreshChallenge: normalizeText(input.refreshChallenge)
		};
		if (
			claims.schema !== ENTITLEMENT_SCHEMA_VERSION
			|| !claims.issuer
			|| !claims.audience
			|| !claims.licenseId
			|| claims.licenseGeneration <= 0
			|| !claims.installId
			|| !claims.devicePublicKey
			|| !claims.pluginVersion
			|| claims.features.length === 0
			|| !claims.issuedAt
		) {
			return null;
		}
		return claims;
	} catch {
		return null;
	}
}

function currentCacheKey(plugin: any): string {
	return stableStringify({
		audience: getCurrentAudience(plugin),
		version: getCurrentPluginVersion(plugin),
		installId: normalizeText(plugin?.settings?.installId),
		devicePublicKey: normalizeText(plugin?.settings?.devicePublicKey),
		envelope: normalizeText(plugin?.settings?.activationEnvelope),
		witness: normalizeText(plugin?.settings?.activationWitness)
	});
}

function hasUsableWindow(claims: EntitlementClaims): boolean {
	const now = Date.now();
	const notBefore = parseIso(claims.notBefore ?? "");
	const expiresAt = parseIso(claims.expiresAt ?? "");
	if (notBefore != null && now < notBefore) return false;
	if (expiresAt != null && now > expiresAt) return false;
	return true;
}

function claimsMatchRuntime(plugin: any, claims: EntitlementClaims): boolean {
	return claims.audience === getCurrentAudience(plugin)
		&& claims.installId === normalizeText(plugin?.settings?.installId)
		&& claims.devicePublicKey === normalizeText(plugin?.settings?.devicePublicKey)
		&& claims.pluginVersion === getCurrentPluginVersion(plugin)
		&& hasUsableWindow(claims);
}

async function sha256Base64Url(input: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", toBufferSource(utf8Bytes(input)));
	return bytesToBase64Url(new Uint8Array(digest));
}

async function getVerifyKey(): Promise<CryptoKey> {
	if (!verifyKeyPromise) {
		verifyKeyPromise = globalThis.crypto.subtle.importKey(
			"spki",
			toBufferSource(base64UrlToBytes(serverVerifyKeyDer)),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"]
		);
	}
	return await verifyKeyPromise;
}

async function verifySignature(envelope: SignedEntitlementEnvelope): Promise<boolean> {
	if (envelope.algorithm !== DEFAULT_ALGORITHM || envelope.keyId !== serverVerifyKeyId) return false;
	try {
		const verifyKey = await getVerifyKey();
		const payloadBytes = toBufferSource(utf8Bytes(envelope.payload));
		const signatureBytes = base64UrlToBytes(envelope.signature);
		if (await globalThis.crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			verifyKey,
			toBufferSource(signatureBytes),
			payloadBytes
		)) {
			return true;
		}
		const converted = derSignatureToP1363(signatureBytes);
		if (!converted) return false;
		return await globalThis.crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			verifyKey,
			toBufferSource(converted),
			payloadBytes
		);
	} catch {
		return false;
	}
}

async function buildWitness(plugin: any, envelope: SignedEntitlementEnvelope, claims: EntitlementClaims): Promise<string> {
	return await sha256Base64Url(stableStringify({
		audience: getCurrentAudience(plugin),
		version: getCurrentPluginVersion(plugin),
		licenseGeneration: claims.licenseGeneration,
		installId: claims.installId,
		devicePublicKey: claims.devicePublicKey,
		features: claims.features,
		issuedAt: claims.issuedAt,
		refreshChallenge: claims.refreshChallenge,
		envelope
	}));
}

function setRuntimeCache(plugin: any, cache: RuntimeEntitlementCache | null): void {
	plugin.__epochEntitlementRuntime = cache;
}

function getRuntimeCache(plugin: any): RuntimeEntitlementCache | null {
	const cache = plugin?.__epochEntitlementRuntime;
	if (!cache || typeof cache !== "object") return null;
	if (!(cache.features instanceof Set)) return null;
	return cache as RuntimeEntitlementCache;
}

export function getCurrentPluginVersion(plugin: any): string {
	return normalizeText(plugin?.manifest?.version);
}

export function getStoredActivationEnvelope(plugin: any): string {
	return normalizeText(plugin?.settings?.activationEnvelope);
}

export function getStoredInstallId(plugin: any): string {
	return normalizeText(plugin?.settings?.installId);
}

export function getStoredDevicePublicKey(plugin: any): string {
	return normalizeText(plugin?.settings?.devicePublicKey);
}

export function getStoredActivationWitness(plugin: any): string {
	return normalizeText(plugin?.settings?.activationWitness);
}

export function clearTrustedActivationCache(plugin: any): void {
	setRuntimeCache(plugin, null);
}

export function primeTrustedActivationCache(
	plugin: any,
	data: {
		claims: EntitlementClaims;
		witness: string;
		envelope: SignedEntitlementEnvelope | string;
	}
): void {
	const envelope = parseEnvelope(data.envelope);
	if (!envelope) return;
	(plugin.settings as any).activationEnvelope = JSON.stringify(envelope);
	(plugin.settings as any).activationWitness = normalizeText(data.witness);
	(plugin.settings as any).activationGenerationFloor = Math.max(getStoredActivationGenerationFloor(plugin), data.claims.licenseGeneration);
	(plugin.settings as any).installId = data.claims.installId;
	(plugin.settings as any).devicePublicKey = data.claims.devicePublicKey;
	setRuntimeCache(plugin, {
		cacheKey: currentCacheKey(plugin),
		witness: normalizeText(data.witness),
		claims: data.claims,
		features: new Set(normalizeFeatures(data.claims.features)),
		holder: normalizeText(data.claims.holder)
	});
}

export async function verifyStoredActivationEnvelope(
	plugin: any,
	options: { expectedRefreshChallenge?: string } = {}
): Promise<{ claims: EntitlementClaims; witness: string; envelope: SignedEntitlementEnvelope } | null> {
	const envelope = parseEnvelope(getStoredActivationEnvelope(plugin));
	const claims = parseClaims(envelope);
	if (!envelope || !claims) return null;
	if (!(await verifySignature(envelope))) return null;
	if (claims.licenseGeneration < getStoredActivationGenerationFloor(plugin)) return null;
	if (!claimsMatchRuntime(plugin, claims)) return null;
	if (options.expectedRefreshChallenge && claims.refreshChallenge !== options.expectedRefreshChallenge) return null;
	const witness = await buildWitness(plugin, envelope, claims);
	const storedWitness = getStoredActivationWitness(plugin);
	if (storedWitness && storedWitness !== witness) return null;
	setRuntimeCache(plugin, {
		cacheKey: currentCacheKey(plugin),
		witness,
		claims,
		features: new Set(claims.features),
		holder: normalizeText(claims.holder)
	});
	return { claims, witness, envelope };
}

export function hasTrustedActivationState(plugin: any): boolean {
	const cache = getRuntimeCache(plugin);
	if (!cache) return false;
	if (cache.cacheKey !== currentCacheKey(plugin)) return false;
	if (cache.claims.pluginVersion !== getCurrentPluginVersion(plugin)) return false;
	return cache.witness === getStoredActivationWitness(plugin);
}

export function hasVerifiedFeatureAccess(
	plugin: any,
	feature: EntitlementFeature
): boolean {
	const cache = getRuntimeCache(plugin);
	if (!cache) return false;
	if (!hasTrustedActivationState(plugin)) return false;
	return !!cache?.features.has(feature);
}

export function getVerifiedLicenseHolder(plugin: any): string {
	if (!hasTrustedActivationState(plugin)) return "";
	return normalizeText(getRuntimeCache(plugin)?.holder);
}

export function needsActivationValidationForCurrentVersion(plugin: any): boolean {
	const envelope = parseEnvelope(getStoredActivationEnvelope(plugin));
	const claims = parseClaims(envelope);
	if (!envelope || !claims) return false;
	if (claims.pluginVersion !== getCurrentPluginVersion(plugin)) return true;
	return !hasTrustedActivationState(plugin);
}