import type { EpochPlugin } from "../main";

const KEY_STORAGE_VERSION = 1;
const KEY_DB_NAME = "epochgram-device-proof";
const KEY_DB_STORE = "keys";
const KEY_DB_VERSION = 1;

type StoredKeyRecord = {
	v: number;
	publicKey: string;
	privateKey: CryptoKey;
	createdAt: string;
};

type StorageLike = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
};

const memoryKeyStore = new Map<string, StoredKeyRecord>();

function normalizeText(value: unknown): string {
	return typeof value === "string" ? String(value).trim() : "";
}

function fastStringHash(input: string): string {
	let hash = 5381;
	for (let i = 0; i < input.length; i++) {
		hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

function getStorage(): StorageLike | null {
	const storage = (globalThis as any)?.localStorage;
	if (!storage) return null;
	if (typeof storage.getItem !== "function") return null;
	if (typeof storage.setItem !== "function") return null;
	if (typeof storage.removeItem !== "function") return null;
	return storage as StorageLike;
}

function getVaultIdentity(plugin: any): string {
	const candidates = [
		String(plugin?.app?.vault?.adapter?.basePath ?? "").trim(),
		typeof plugin?.app?.vault?.getName === "function" ? String(plugin.app.vault.getName() ?? "").trim() : "",
		String(plugin?.dataFilePath ?? "").trim(),
		String(plugin?.pluginDirPath ?? "").trim(),
		String(plugin?.app?.vault?.configDir ?? "").trim()
	].filter(Boolean);
	return candidates.join("|") || "default-vault";
}

function getScopeKey(plugin: any): string {
	const pluginId = normalizeText(plugin?.manifest?.id) || "obsidian-epochgram";
	return `${pluginId}:device-proof:${fastStringHash(getVaultIdentity(plugin))}`;
}

function getInstallIdStorageKey(plugin: any): string {
	return `${getScopeKey(plugin)}:install-id`;
}

function getDeviceMaterialStorageKey(plugin: any): string {
	return `${getScopeKey(plugin)}:material`;
}

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("WebCrypto unavailable");
	}
	return subtle;
}

function utf8Bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
	const { buffer, byteOffset, byteLength } = view;
	if (buffer instanceof ArrayBuffer) {
		return buffer.slice(byteOffset, byteOffset + byteLength);
	}
	return new Uint8Array(view).buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const encoded = typeof btoa === "function"
		? btoa(binary)
		: Buffer.from(bytes).toString("base64");
	return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
	return bytesToBase64Url(new Uint8Array(await getSubtle().exportKey("spki", publicKey)));
}

function formatUuidV4(bytes: Uint8Array): string {
	const normalized = bytes.slice(0, 16);
	normalized[6] = (normalized[6] & 0x0f) | 0x40;
	normalized[8] = (normalized[8] & 0x3f) | 0x80;
	const hex = Array.from(normalized, (value) => value.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createUuid(): string {
	try {
		const value = globalThis.crypto?.randomUUID?.();
		if (value) return value;
	} catch {
		// ignore
	}
	try {
		const bytes = new Uint8Array(16);
		globalThis.crypto?.getRandomValues?.(bytes);
		if (bytes.some((value) => value !== 0)) return formatUuidV4(bytes);
	} catch {
		// ignore
	}
	const bytes = new Uint8Array(16);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}
	return formatUuidV4(bytes);
}

function normalizeStoredMaterial(raw: unknown): StoredKeyRecord | null {
	const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
	if (!input) return null;
	const version = Number(input.v ?? 0);
	const publicKey = normalizeText(input.publicKey);
	const privateKey = input.privateKey;
	const createdAt = normalizeText(input.createdAt);
	if (version !== KEY_STORAGE_VERSION || !publicKey || !privateKey || typeof privateKey !== "object") return null;
	return {
		v: KEY_STORAGE_VERSION,
		publicKey,
		privateKey: privateKey as CryptoKey,
		createdAt: createdAt || new Date().toISOString()
	};
}

async function openIndexedDb(): Promise<IDBDatabase | null> {
	const factory = (globalThis as any)?.indexedDB;
	if (!factory || typeof factory.open !== "function") return null;
	return await new Promise((resolve) => {
		const request = factory.open(KEY_DB_NAME, KEY_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(KEY_DB_STORE)) {
				db.createObjectStore(KEY_DB_STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}

async function readIndexedMaterial(plugin: any): Promise<StoredKeyRecord | null> {
	const db = await openIndexedDb();
	if (!db) return null;
	return await new Promise((resolve) => {
		try {
			const tx = db.transaction(KEY_DB_STORE, "readonly");
			const request = tx.objectStore(KEY_DB_STORE).get(getDeviceMaterialStorageKey(plugin));
			request.onsuccess = () => resolve(normalizeStoredMaterial(request.result));
			request.onerror = () => resolve(null);
			tx.oncomplete = () => db.close();
			tx.onerror = () => db.close();
		} catch {
			db.close();
			resolve(null);
		}
	});
}

async function writeIndexedMaterial(plugin: any, value: StoredKeyRecord): Promise<boolean> {
	const db = await openIndexedDb();
	if (!db) return false;
	return await new Promise((resolve) => {
		try {
			const tx = db.transaction(KEY_DB_STORE, "readwrite");
			tx.objectStore(KEY_DB_STORE).put(value, getDeviceMaterialStorageKey(plugin));
			tx.oncomplete = () => {
				db.close();
				resolve(true);
			};
			tx.onerror = () => {
				db.close();
				resolve(false);
			};
		} catch {
			db.close();
			resolve(false);
		}
	});
}

async function readStoredMaterial(plugin: any): Promise<StoredKeyRecord | null> {
	const storageKey = getDeviceMaterialStorageKey(plugin);
	const memoryValue = memoryKeyStore.get(storageKey) ?? null;
	if (memoryValue) return memoryValue;
	const indexedValue = await readIndexedMaterial(plugin);
	if (indexedValue) {
		memoryKeyStore.set(storageKey, indexedValue);
		return indexedValue;
	}
	return null;
}


async function writeStoredMaterial(plugin: any, value: StoredKeyRecord): Promise<void> {
	const storageKey = getDeviceMaterialStorageKey(plugin);
	memoryKeyStore.set(storageKey, value);
	const wroteIndexed = await writeIndexedMaterial(plugin, value);
	if (!wroteIndexed) {
		// Keep the non-exportable private key only in memory when IndexedDB is unavailable.
	}
}

async function generateMaterial(): Promise<StoredKeyRecord> {
	const pair = await getSubtle().generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"]
	);
	const publicKey = await exportPublicKey(pair.publicKey);
	const privatePkcs8 = await getSubtle().exportKey("pkcs8", pair.privateKey);
	const privateKey = await getSubtle().importKey(
		"pkcs8",
		privatePkcs8,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"]
	);
	return {
		v: KEY_STORAGE_VERSION,
		publicKey,
		privateKey,
		createdAt: new Date().toISOString()
	};
}

export function ensureInstallId(plugin: EpochPlugin, saveIfChanged: boolean = false): string {
	const current = normalizeText((plugin.settings as any).installId);
	if (current) return current;
	const storage = getStorage();
	const storageKey = getInstallIdStorageKey(plugin);
	try {
		const stored = normalizeText(storage?.getItem(storageKey));
		if (stored) {
			(plugin.settings as any).installId = stored;
			if (saveIfChanged) void plugin.saveSettings();
			return stored;
		}
	} catch {
		// ignore
	}
	const next = createUuid();
	(plugin.settings as any).installId = next;
	try {
		storage?.setItem(storageKey, next);
	} catch {
		// ignore
	}
	if (saveIfChanged) void plugin.saveSettings();
	return next;
}

export async function ensureDeviceProofMaterial(
	plugin: EpochPlugin,
	saveIfChanged: boolean = false
): Promise<{ publicKey: string }> {
	const stored = await readStoredMaterial(plugin);
	const material = stored ?? await generateMaterial();
	if (!stored) {
		await writeStoredMaterial(plugin, material);
	}
	const currentPublicKey = normalizeText((plugin.settings as any).devicePublicKey);
	if (currentPublicKey !== material.publicKey) {
		(plugin.settings as any).devicePublicKey = material.publicKey;
		if (saveIfChanged) await plugin.saveSettings();
	}
	return { publicKey: material.publicKey };
}

export async function signUpdateChallenge(plugin: EpochPlugin, payload: string): Promise<string> {
	const material = await readStoredMaterial(plugin) ?? await generateMaterial();
	if (!(await readStoredMaterial(plugin))) {
		await writeStoredMaterial(plugin, material);
	}
	const payloadBytes = utf8Bytes(payload);
	const signature = await getSubtle().sign(
		{ name: "ECDSA", hash: "SHA-256" },
		material.privateKey,
		toArrayBuffer(payloadBytes)
	);
	return bytesToBase64Url(new Uint8Array(signature));
}

export function __resetDeviceProofCacheForTests(): void {
	memoryKeyStore.clear();
}