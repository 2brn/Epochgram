import {
	primeTrustedActivationCache,
	type EntitlementClaims,
	type SignedEntitlementEnvelope
} from "../../src/plugin/pro-trust";

function bytesToBase64Url(value: string): string {
	const encoded = typeof btoa === "function"
		? btoa(value)
		: Buffer.from(value, "utf8").toString("base64");
	return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildFixtureEnvelope(claims: EntitlementClaims): SignedEntitlementEnvelope {
	return {
		version: 1,
		keyId: "epochgram-20260411",
		algorithm: "ECDSA-P256-SHA256",
		payload: bytesToBase64Url(JSON.stringify(claims)),
		signature: "fixture-signature"
	};
}

export function withTrustedPro<T extends Record<string, any>>(
	plugin: T,
	version = "0.4.3-test",
	options: { features?: EntitlementClaims["features"]; preserveHasProAccess?: boolean } = {}
): T {
	const manifest = plugin.manifest && typeof plugin.manifest === "object"
		? plugin.manifest
		: { id: "epochgram", version };
	if (typeof manifest.id !== "string" || !manifest.id.trim()) manifest.id = "epochgram";
	if (typeof manifest.version !== "string" || !manifest.version.trim()) manifest.version = version;
	plugin.manifest = manifest;

	const settings = plugin.settings && typeof plugin.settings === "object" ? plugin.settings : {};
	const installId = typeof settings.installId === "string" && settings.installId.trim()
		? settings.installId.trim()
		: "install-test";
	const devicePublicKey = typeof settings.devicePublicKey === "string" && settings.devicePublicKey.trim()
		? settings.devicePublicKey.trim()
		: "device-public-test";
	const claims: EntitlementClaims = {
		schema: 1,
		issuer: "epochgram-web",
		audience: manifest.id,
		licenseId: "lic-test",
		licenseGeneration: 1,
		installId,
		devicePublicKey,
		pluginVersion: manifest.version,
		features: options.features ?? ["trackChanges", "recurring", "summarizeAI", "generateEpochs", "aiBridge", "similarity"],
		issuedAt: "2030-01-01T00:00:00.000Z",
		holder: "Fixture"
	};
	plugin.settings = settings;
	if (!options.preserveHasProAccess) plugin.proActive = true;
	primeTrustedActivationCache(plugin as any, {
		claims,
		witness: "fixture-witness",
		envelope: buildFixtureEnvelope(claims)
	});
	return plugin;
}