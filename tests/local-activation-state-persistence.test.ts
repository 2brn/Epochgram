import { afterEach, describe, expect, it, vi } from "vitest";
import { persistenceMethods } from "../src/plugin/persistence";
import { pollingMethods } from "../src/plugin/polling";
import { readLocalActivationState } from "../src/plugin/local-activation-state";

type StorageMock = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	clear(): void;
};

function createLocalStorageMock(): StorageMock {
	const store = new Map<string, string>();
	return {
		getItem(key: string) {
			return store.has(key) ? String(store.get(key)) : null;
		},
		setItem(key: string, value: string) {
			store.set(key, String(value));
		},
		removeItem(key: string) {
			store.delete(key);
		},
		clear() {
			store.clear();
		}
	};
}

function installLocalStorageMock(): StorageMock {
	const mock = createLocalStorageMock();
	Object.defineProperty(globalThis, "localStorage", {
		value: mock,
		configurable: true,
		writable: true
	});
	return mock;
}

function createPluginBase(overrides: Record<string, any> = {}): any {
	const configDir = "config";
	return {
		manifest: { id: "epochgram", version: "0.4.3-test" },
		app: {
			vault: {
				configDir,
				adapter: {
					basePath: "/vault"
				}
			}
		},
		pluginDirPath: `${configDir}/plugins/epochgram`,
		dataFilePath: `${configDir}/plugins/epochgram/data.json`,
		lastDataSignature: null,
		lastDataSignatureCheck: 0,
		computeDataSignature: function (...args: any[]) {
			return (persistenceMethods.computeDataSignature as any).call(this, ...args);
		},
		saveData: vi.fn(async (_payload: any) => {}),
		updateDataFileStat: vi.fn(async () => {}),
		refreshEpochViews: vi.fn(),
		registerFileEvents: vi.fn(),
		ensureExcludedSync: vi.fn(async () => {}),
		refreshLicenseState: vi.fn(async () => false),
		areSettingsEqual: function (a: any, b: any) {
			return persistenceMethods.areSettingsEqual.call(this, a, b);
		},
		...overrides
	};
}

afterEach(() => {
	try {
		delete (globalThis as any).localStorage;
	} catch {
		// ignore
	}
});

describe("local activation persistence", () => {
	it("writes install-bound activation state to local storage and strips it from synced plugin data", async () => {
		installLocalStorageMock();
		const saveData = vi.fn(async (_payload: any) => {});
		const plugin = createPluginBase({
			saveData,
			settings: {
				trackChanges: true,
				claimKeyPreview: "EPO-ABCD-XXXX-XXXX-XXXX-XXXX",
				installId: "install-local",
				devicePublicKey: "device-public-local",
				activationEnvelope: "signed-envelope-local",
				activationWitness: "witness-local",
				activationGenerationFloor: 7,
				activationStatus: "active",
				activationError: "",
				lastValidationAt: "2026-03-23T00:00:00.000Z",
				lastValidatedAt: "2026-03-23T00:00:00.000Z"
			}
		});

		await persistenceMethods.savePluginData.call(plugin);

		expect(saveData).toHaveBeenCalledTimes(1);
		const payload = saveData.mock.calls[0]?.[0] ?? {};
		expect(payload.settings.trackChanges).toBe(true);
		expect(payload.settings.claimKeyPreview).toBeUndefined();
		expect(payload.settings.installId).toBeUndefined();
		expect(payload.settings.devicePublicKey).toBeUndefined();
		expect(payload.settings.activationEnvelope).toBeUndefined();
		expect(payload.settings.activationWitness).toBeUndefined();
		expect(payload.settings.activationGenerationFloor).toBeUndefined();
		expect(payload.settings.activationError).toBeUndefined();

		const localState = readLocalActivationState(plugin);
		expect(localState.claimKeyPreview).toBe("EPO-ABCD-XXXX-XXXX-XXXX-XXXX");
		expect((localState as any).installId).toBe("install-local");
		expect((localState as any).devicePublicKey).toBe("device-public-local");
		expect((localState as any).activationEnvelope).toBe("signed-envelope-local");
		expect((localState as any).activationWitness).toBe("witness-local");
		expect((localState as any).activationGenerationFloor).toBe(7);
		expect(localState.lastValidatedAt).toBe("2026-03-23T00:00:00.000Z");
	});

	it("keeps only sync-safe settings in synced plugin data", async () => {
		installLocalStorageMock();
		const saveData = vi.fn(async (_payload: any) => {});
		const plugin = createPluginBase({
			saveData,
			settings: {
				trackChanges: true,
				claimKeyPreview: "EPO-ABCD-XXXX-XXXX-XXXX-XXXX",
				unexpectedField: "drop-me"
			}
		});

		await persistenceMethods.savePluginData.call(plugin);

		const payload = saveData.mock.calls[0]?.[0] ?? {};
		expect(payload.settings.claimKeyPreview).toBeUndefined();
		expect(payload.settings.unexpectedField).toBeUndefined();
		const localState = readLocalActivationState(plugin);
		expect(localState.claimKeyPreview).toBe("EPO-ABCD-XXXX-XXXX-XXXX-XXXX");
	});

	it("keeps device-local activation when synced settings reload", async () => {
		installLocalStorageMock();
		const plugin = createPluginBase({
			settings: {
				trackChanges: false,
				claimKeyPreview: "EPO-LOCAL-XXXX-XXXX-XXXX-XXXX",
				installId: "install-local",
				devicePublicKey: "device-public-local",
				activationEnvelope: "signed-envelope-local",
				activationWitness: "witness-local",
				activationStatus: "active",
				activationError: "",
				lastValidationAt: "2026-03-23T00:00:00.000Z",
				lastValidatedAt: "2026-03-23T00:00:00.000Z"
			},
			loadData: vi.fn(async () => ({
				settings: {
					trackChanges: true,
					claimKeyPreview: "EPO-ABCD-XXXX-XXXX-XXXX-XXXX",
					installId: "install-synced",
					devicePublicKey: "device-public-synced",
					activationEnvelope: "signed-envelope-synced",
					activationWitness: "witness-synced",
					activationStatus: "active"
				}
			}))
		});

		await persistenceMethods.savePluginData.call(plugin);
		plugin.settings = {
			trackChanges: false,
			installId: "",
			devicePublicKey: "",
			activationEnvelope: "",
			activationWitness: "",
			activationStatus: "inactive",
			activationError: "",
			lastValidationAt: ""
		};

		await pollingMethods.reloadIndexFromPluginData.call(plugin);

		expect(plugin.settings.trackChanges).toBe(true);
		expect((plugin.settings as any).claimKeyPreview).toBe("EPO-LOCAL-XXXX-XXXX-XXXX-XXXX");
		expect((plugin.settings as any).installId).toBe("install-local");
		expect((plugin.settings as any).devicePublicKey).toBe("device-public-local");
		expect((plugin.settings as any).activationEnvelope).toBe("signed-envelope-local");
		expect((plugin.settings as any).activationWitness).toBe("witness-local");
	});

	it("ignores synced activation fields when no local activation exists", async () => {
		installLocalStorageMock();
		const plugin = createPluginBase({
			settings: {
				trackChanges: false,
				installId: "",
				devicePublicKey: "",
				activationEnvelope: "",
				activationWitness: "",
				activationStatus: "inactive",
				activationError: "",
				lastValidationAt: ""
			},
			loadData: vi.fn(async () => ({
				settings: {
					trackChanges: true,
					claimKeyPreview: "EPO-ABCD-XXXX-XXXX-XXXX-XXXX",
					installId: "install-sync",
					devicePublicKey: "device-public-sync",
					activationEnvelope: "signed-envelope-sync",
					activationWitness: "witness-sync",
					activationStatus: "active"
				}
			}))
		});

		await pollingMethods.reloadIndexFromPluginData.call(plugin);

		expect(plugin.settings.trackChanges).toBe(true);
		expect((plugin.settings as any).claimKeyPreview).toBe("");
		expect((plugin.settings as any).installId).toBe("");
		expect((plugin.settings as any).devicePublicKey).toBe("");
		expect((plugin.settings as any).activationEnvelope).toBe("");
		expect((plugin.settings as any).activationWitness).toBe("");
		expect(plugin.settings.activationStatus).toBe("inactive");
	});
});
