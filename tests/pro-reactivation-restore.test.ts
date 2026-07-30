import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { Platform } from "obsidian";
import * as obsidian from "obsidian";
import { __resetDeviceProofCacheForTests } from "../src/plugin/device-proof";
import { licenseMethods } from "../src/plugin/license";
import { NOTE_TITLE_SIMILARITY_JW_THRESHOLD } from "../src/utils";
import { __setServerVerifyKeyForTests } from "../src/plugin/pro-trust";
import { buildEntitlementClaims, buildSignedEntitlementEnvelope, TEST_SERVER_VERIFY_KEY_DER_BASE64 } from "./helpers/signed-entitlement";

const setRequestUrlHandler = (obsidian as any).__setRequestUrlHandler as ((handler: ((request: any) => any) | null) => void);

type AnySettings = Record<string, any>;

type StorageMock = {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	clear(): void;
};

type FakePlugin = {
	manifest: {
		id: string;
		version: string;
	};
	__epochSettingTab?: { display: () => void };
	maybeOpenAiBridgeOnStartup: () => Promise<void>;
	settings: AnySettings;
	viewPreferences: {
		reviewFilterMode: "reviewed+draft" | "draft" | "all";
		showAttachments: boolean;
		showTrackedChanges: boolean;
		parsedFilterMode: "none" | "parsed" | "parsed+frontmatter";
		showEpochsView: boolean;
	};
	proActive: boolean;
	licenseHolder: string;
	proNoticesShown: Set<string>;
	indexer: { refreshSyntheticEntries: () => void };
	app: any;
	saveSettings: () => Promise<void>;
	onSettingsChanged: (key: string) => Promise<void>;
	registerFileEvents: () => void;
	refreshEpochViews: () => void;
	disableProViewPreferences: () => void;
	refreshLicenseState: () => Promise<boolean>;
	hasProAccess: () => boolean;
	ensureDeviceIdentity: () => string;
	validateStoredActivationToken: (options?: any) => Promise<boolean>;
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

function installLocalStorageMock(): void {
	Object.defineProperty(globalThis, "localStorage", {
		value: createLocalStorageMock(),
		configurable: true,
		writable: true
	});
}

function createFakePlugin(settingsOverrides: AnySettings = {}, preferenceOverrides: Partial<FakePlugin["viewPreferences"]> = {}): FakePlugin {
	const settings: AnySettings = {
		trackChanges: false,
		summarizeAI: false,
		generateEpochs: false,
		similarityThreshold: 0,
		similarityZeroShotMinScore: 0,
		claimKeyPreview: "",
		installId: "",
		devicePublicKey: "",
		activationEnvelope: "",
		activationWitness: "",
		activationStatus: "inactive",
		activationError: "",
		lastValidationAt: "",
		lastValidatedAt: "",
		...settingsOverrides
	};

	const viewPreferences: FakePlugin["viewPreferences"] = {
		reviewFilterMode: "reviewed+draft",
		showAttachments: false,
		showTrackedChanges: false,
		parsedFilterMode: "parsed",
		showEpochsView: false,
		...preferenceOverrides
	};

	const plugin: FakePlugin = {
		manifest: {
			id: "epochgram",
			version: "0.4.3-test"
		},
		settings,
		viewPreferences,
		proActive: false,
		licenseHolder: "",
		proNoticesShown: new Set<string>(),
		indexer: { refreshSyntheticEntries: vi.fn() },
		app: {
			vault: {
				adapter: {
					read: vi.fn(async () => "")
				}
			}
		},
		saveSettings: vi.fn(async () => {}),
		onSettingsChanged: vi.fn(async () => {}),
		registerFileEvents: vi.fn(),
		refreshEpochViews: vi.fn(),
		maybeOpenAiBridgeOnStartup: vi.fn(async () => {}),
		disableProViewPreferences: function () {
			return licenseMethods.disableProViewPreferences.call(this as any);
		},
		refreshLicenseState: function () {
			return licenseMethods.refreshLicenseState.call(this as any);
		},
		hasProAccess: function () {
			return licenseMethods.hasProAccess.call(this as any);
		},
		ensureDeviceIdentity: function () {
			return licenseMethods.ensureDeviceIdentity.call(this as any);
		},
		validateStoredActivationToken: function (options?: any) {
			return licenseMethods.validateStoredActivationToken.call(this as any, options);
		}
	};

	return plugin;
}

function mockResponse(status: number, json: Record<string, any>) {
	return {
		status,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json,
		text: JSON.stringify(json)
	};
}

function buildResponseEnvelope(body: Record<string, any>, overrides: Partial<ReturnType<typeof buildEntitlementClaims>> = {}) {
	const claims = buildEntitlementClaims({
		audience: "epochgram",
		installId: String(body.installId ?? "install-test"),
		devicePublicKey: String(body.devicePublicKey ?? "device-public-test"),
		pluginVersion: String(body.pluginVersion ?? "0.4.3-test"),
		refreshChallenge: typeof body.challenge === "string" ? body.challenge : undefined,
		...overrides
	});
	return buildSignedEntitlementEnvelope(claims);
}

async function activatePlugin(plugin: FakePlugin, claimKey = "EPO-ACTI-VATE-TEST-0000-1"): Promise<void> {
	setRequestUrlHandler(async (request: any) => {
		const body = JSON.parse(String(request.body ?? "{}"));
		return mockResponse(200, {
			certificate: buildResponseEnvelope(body)
		});
	});
	const result = await licenseMethods.applyClaimKey.call(plugin as any, claimKey);
	expect(result.valid).toBe(true);
}

beforeEach(() => {
	installLocalStorageMock();
	vi.stubGlobal("crypto", webcrypto as any);
	__setServerVerifyKeyForTests({ der: TEST_SERVER_VERIFY_KEY_DER_BASE64 });
	__resetDeviceProofCacheForTests();
});

afterEach(() => {
	setRequestUrlHandler(null);
	Platform.isDesktop = true;
	Platform.isMobile = false;
	vi.useRealTimers();
	vi.unstubAllGlobals();
	try {
		delete (globalThis as any).localStorage;
	} catch {
		// ignore
	}
	__resetDeviceProofCacheForTests();
});

describe("license: signed activation certificates", () => {
	it("preserves stored Pro settings on re-activation", async () => {
		setRequestUrlHandler(async (request: any) => {
			expect(request.url).toContain("/api/pro/activate");
			const body = JSON.parse(String(request.body ?? "{}"));
			expect(body.claimKey).toBe("EPO-AAAA-BBBB-CCCC-DDDD-EEEE");
			expect(typeof body.installId).toBe("string");
			expect(typeof body.devicePublicKey).toBe("string");
			return mockResponse(200, {
				certificate: buildResponseEnvelope(body)
			});
		});

		const plugin = createFakePlugin({
			trackChanges: true,
			summarizeAI: true,
			generateEpochs: true,
			similarityUseLinks: false,
			similarityUseTags: true,
			similarityTitleJwThreshold: 0.8,
			similarityThreshold: 0.92,
			similarityZeroShotMinScore: 0.88
		});
		plugin.viewPreferences.showTrackedChanges = false;

		const result = await licenseMethods.applyClaimKey.call(plugin as any, "EPO-AAAA-BBBB-CCCC-DDDD-EEEE");
		expect(result.valid).toBe(true);
		expect(plugin.proActive).toBe(true);
		expect(plugin.settings.claimKeyPreview).toBe("EPO-AAAA-XXXX-XXXX-XXXX-XXXX");
		expect(plugin.settings.installId).not.toBe("");
		expect(plugin.settings.devicePublicKey).not.toBe("");
		expect(plugin.settings.activationEnvelope).not.toBe("");
		expect(plugin.settings.activationWitness).not.toBe("");

		expect(plugin.settings.trackChanges).toBe(true);
		expect(plugin.settings.summarizeAI).toBe(true);
		expect(plugin.settings.generateEpochs).toBe(true);
		expect(plugin.settings.similarityUseLinks).toBe(false);
		expect(plugin.settings.similarityUseTags).toBe(true);
		expect(plugin.settings.similarityTitleJwThreshold).toBeCloseTo(0.8);
		expect(plugin.settings.similarityThreshold).toBeCloseTo(0.92);
		expect(plugin.settings.similarityZeroShotMinScore).toBeCloseTo(0.88);
		expect(plugin.viewPreferences.showTrackedChanges).toBe(false);
		expect(plugin.onSettingsChanged).toHaveBeenCalledWith("trackChanges");
	});

	it("keeps default settings on successful activation", async () => {
		setRequestUrlHandler(async (request: any) => {
			const body = JSON.parse(String(request.body ?? "{}"));
			return mockResponse(200, {
				certificate: buildResponseEnvelope(body)
			});
		});

		const plugin = createFakePlugin({
			trackChanges: false,
			summarizeAI: false,
			generateEpochs: false,
			similarityThreshold: 0,
			similarityZeroShotMinScore: 0
		});

		const result = await licenseMethods.applyClaimKey.call(plugin as any, "EPO-FIRST-ACTI-VATI-ON00");
		expect(result.valid).toBe(true);
		expect(plugin.settings.trackChanges).toBe(false);
		expect(plugin.settings.summarizeAI).toBe(false);
		expect(plugin.settings.generateEpochs).toBe(false);
		expect(plugin.settings.similarityThreshold).toBeCloseTo(0);
		expect(plugin.settings.similarityZeroShotMinScore).toBeCloseTo(0);
		expect(plugin.viewPreferences.showTrackedChanges).toBe(false);
		expect(plugin.onSettingsChanged).not.toHaveBeenCalledWith("trackChanges");
	});

	it("rejects an invalid claim key", async () => {
		setRequestUrlHandler(async () => mockResponse(404, { error: "claim key not found" }));
		const plugin = createFakePlugin();

		const result = await licenseMethods.applyClaimKey.call(plugin as any, "EPO-BAD-KEY0-0000-0000-0000");
		expect(result.valid).toBe(false);
		expect(result.message).toBe("License key not found");
		expect(plugin.proActive).toBe(false);
		expect(plugin.settings.claimKeyPreview).toBe("");
		expect(plugin.settings.activationEnvelope).toBe("");
		expect(plugin.settings.activationWitness).toBe("");
	});

	it("follows backend redirects during activation", async () => {
		const handler = vi.fn(async (request) => {
			if (request.url === "https://www.epochgram.com/api/pro/activate") {
				return {
					status: 307,
					headers: { Location: "https://epochgram.com/api/pro/activate" },
					json: {},
					text: ""
				};
			}
			const body = JSON.parse(String(request.body ?? "{}"));
			return mockResponse(200, { certificate: buildResponseEnvelope(body) });
		});
		setRequestUrlHandler(handler);
		const plugin = createFakePlugin();

		const result = await licenseMethods.applyClaimKey.call(plugin as any, "EPO-REDI-RECT-0000-0000-0");

		expect(result.valid).toBe(true);
		expect(plugin.settings.activationEnvelope).not.toBe("");
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it("rejects redirects to unexpected hosts during activation", async () => {
		const handler = vi.fn(async () => ({
			status: 307,
			headers: { Location: "https://evil.example/api/pro/activate" },
			json: {},
			text: ""
		}));
		setRequestUrlHandler(handler);
		const plugin = createFakePlugin();

		const result = await licenseMethods.applyClaimKey.call(plugin as any, "EPO-REDI-RECT-0000-0000-0");

		expect(result.valid).toBe(false);
		expect(plugin.proActive).toBe(false);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("keeps persisted activation across restart without revalidating on the same version", async () => {
		const plugin = createFakePlugin();
		await activatePlugin(plugin);

		const validateHandler = vi.fn(async () => mockResponse(200, { valid: true }));
		setRequestUrlHandler(validateHandler);

		await plugin.refreshLicenseState();
		expect(plugin.proActive).toBe(true);

		const changed = await plugin.validateStoredActivationToken({ source: "startup" });
		expect(changed).toBe(false);
		expect(plugin.proActive).toBe(true);
		expect(validateHandler).not.toHaveBeenCalled();
	});

	it("validates on startup when the plugin version changes", async () => {
		const plugin = createFakePlugin();
		plugin.manifest.version = "0.4.2-test";
		await activatePlugin(plugin);

		plugin.manifest.version = "0.4.3-test";
		await plugin.refreshLicenseState();
		expect(plugin.proActive).toBe(false);

		const handler = vi.fn(async (request) => {
			expect(request.url).toContain("/api/pro/validate");
			const body = JSON.parse(String(request.body ?? "{}"));
			expect(typeof body.challenge).toBe("string");
			expect(typeof body.challengeSignature).toBe("string");
			expect(typeof body.certificate).toBe("string");
			return mockResponse(200, {
				valid: true,
				certificate: buildResponseEnvelope(body)
			});
		});
		setRequestUrlHandler(handler);

		await plugin.validateStoredActivationToken({ source: "startup" });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(plugin.proActive).toBe(true);
		expect(plugin.settings.activationStatus).toBe("active");
		expect(plugin.settings.activationWitness).not.toBe("");
		expect(plugin.settings.lastValidatedAt).not.toBe("");
	});

	it("refreshes settings tab after successful startup validation", async () => {
		const plugin = createFakePlugin();
		plugin.manifest.version = "0.4.2-test";
		await activatePlugin(plugin);

		plugin.manifest.version = "0.4.3-test";
		await plugin.refreshLicenseState();
		expect(plugin.proActive).toBe(false);

		const display = vi.fn();
		plugin.__epochSettingTab = { display };

		setRequestUrlHandler(async (request) => {
			const body = JSON.parse(String(request.body ?? "{}"));
			return mockResponse(200, {
				valid: true,
				certificate: buildResponseEnvelope(body)
			});
		});

		await plugin.validateStoredActivationToken({ source: "startup" });

		expect(plugin.proActive).toBe(true);
		expect(display).toHaveBeenCalled();
	});

	it("re-runs AI bridge startup after Pro activation when AI is enabled", async () => {
		const plugin = createFakePlugin({ summarizeAI: true });

		await activatePlugin(plugin);

		expect(plugin.proActive).toBe(true);
		expect(plugin.maybeOpenAiBridgeOnStartup).toHaveBeenCalledTimes(1);
	});

	it("re-runs AI bridge startup after successful startup validation when AI is enabled", async () => {
		const plugin = createFakePlugin({ summarizeAI: false });
		plugin.manifest.version = "0.4.2-test";
		await activatePlugin(plugin);

		plugin.settings.summarizeAI = true;
		plugin.manifest.version = "0.4.3-test";
		await plugin.refreshLicenseState();
		expect(plugin.proActive).toBe(false);

		vi.mocked(plugin.maybeOpenAiBridgeOnStartup).mockClear();
		setRequestUrlHandler(async (request) => {
			const body = JSON.parse(String(request.body ?? "{}"));
			return mockResponse(200, {
				valid: true,
				certificate: buildResponseEnvelope(body)
			});
		});

		await plugin.validateStoredActivationToken({ source: "startup" });

		expect(plugin.proActive).toBe(true);
		expect(plugin.maybeOpenAiBridgeOnStartup).toHaveBeenCalledTimes(1);
	});

	it("rejects refreshed certificates that do not bind the issued challenge", async () => {
		const plugin = createFakePlugin();
		plugin.manifest.version = "0.4.2-test";
		await activatePlugin(plugin);

		plugin.manifest.version = "0.4.3-test";
		await plugin.refreshLicenseState();

		setRequestUrlHandler(async (request) => {
			const body = JSON.parse(String(request.body ?? "{}"));
			return mockResponse(200, {
				valid: true,
				certificate: buildResponseEnvelope(body, { refreshChallenge: "wrong-challenge" })
			});
		});

		await plugin.validateStoredActivationToken({ source: "startup" });

		expect(plugin.proActive).toBe(false);
		expect(plugin.settings.activationStatus).toBe("invalid");
	});

	it("keeps Pro locked on an updated version until validation succeeds", async () => {
		const plugin = createFakePlugin();
		plugin.manifest.version = "0.4.2-test";
		await activatePlugin(plugin);

		plugin.manifest.version = "0.4.3-test";
		await plugin.refreshLicenseState();
		expect(plugin.proActive).toBe(false);

		setRequestUrlHandler(async () => {
			throw new Error("offline");
		});

		await plugin.validateStoredActivationToken({ source: "startup" });

		expect(plugin.proActive).toBe(false);
		expect(plugin.settings.activationStatus).toBe("error");
		expect(plugin.settings.activationEnvelope).not.toBe("");
		expect(plugin.settings.activationWitness).toBe("");
	});

	it("does not show startup lock notice when offline but Pro remains active", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const plugin = createFakePlugin();
		await activatePlugin(plugin);
		await plugin.refreshLicenseState();
		expect(plugin.proActive).toBe(true);

		vi.setSystemTime(new Date("2026-01-06T00:00:00.000Z"));
		const noticeSpy = vi.spyOn(obsidian, "Notice").mockImplementation((() => {
			return {} as any;
		}) as any);
		setRequestUrlHandler(async () => {
			throw new Error("offline");
		});

		await plugin.validateStoredActivationToken({ source: "startup" });

		expect(plugin.proActive).toBe(true);
		expect(plugin.settings.activationStatus).toBe("active");
		expect(noticeSpy).not.toHaveBeenCalled();
	});

	it("fails closed when the stored certificate is forged", async () => {
		const plugin = createFakePlugin({
			installId: "install-forged",
			devicePublicKey: "device-public-forged",
			activationStatus: "active"
		});
		const forgedEnvelope = buildSignedEntitlementEnvelope(buildEntitlementClaims({
			installId: "install-forged",
			devicePublicKey: "device-public-forged",
			buildHash: "wrong-build"
		}));
		plugin.settings.activationEnvelope = JSON.stringify(forgedEnvelope);
		plugin.settings.activationWitness = "forged-witness";

		const changed = await plugin.refreshLicenseState();
		expect(changed).toBe(true);
		expect(plugin.proActive).toBe(false);
		expect(plugin.hasProAccess()).toBe(false);
	});

	it("normalizes stale unknown activation states", async () => {
		const plugin = createFakePlugin({
			activationStatus: "unexpected-status",
			activationError: "Some stale persisted error"
		});

		const changed = await plugin.refreshLicenseState();
		expect(changed).toBe(true);
		expect(plugin.settings.activationStatus).toBe("inactive");
		expect(plugin.settings.activationError).toBe("");
	});
});
