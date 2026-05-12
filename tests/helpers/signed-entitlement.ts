import { createPublicKey, createSign } from "node:crypto";
import type { EntitlementClaims, SignedEntitlementEnvelope } from "../../src/plugin/pro-trust";

const FIXTURE_BUILD_HASH = "a".repeat(64);

const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg4EIAVrK0jziKif3y
wTAgMlFJHRCG/lLq9oppMrbNZ/+hRANCAARfDQzkBPAiAn2mbhSWqWEaXzKXUAPm
TeamYmqrhixRXXo0lXtsJG5Mrt/bSPzk5raQ5cwFvmblzTKSN4KnvPbq
-----END PRIVATE KEY-----`;

export const TEST_SERVER_VERIFY_KEY_DER_BASE64 = createPublicKey(TEST_PRIVATE_KEY_PEM)
	.export({ format: "der", type: "spki" })
	.toString("base64");

function bytesToBase64Url(input: Buffer | string): string {
	const encoded = Buffer.isBuffer(input)
		? input.toString("base64")
		: Buffer.from(input, "utf8").toString("base64");
	return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildEntitlementClaims(overrides: Partial<EntitlementClaims> = {}): EntitlementClaims {
	return {
		schema: 1,
		issuer: "epochgram-web",
		audience: "epochgram",
		licenseId: "lic-test",
		licenseGeneration: 1,
		installId: "install-test",
		devicePublicKey: "device-public-test",
		pluginVersion: "0.4.3-test",
		buildHash: FIXTURE_BUILD_HASH,
		features: ["trackChanges", "recurring", "summarizeAI", "generateEpochs", "aiBridge", "similarity"],
		issuedAt: "2030-01-01T00:00:00.000Z",
		holder: "Fixture",
		...overrides
	};
}

export function buildSignedEntitlementEnvelope(claims: EntitlementClaims): SignedEntitlementEnvelope {
	const payloadJson = JSON.stringify(claims);
	const payload = bytesToBase64Url(payloadJson);
	const signer = createSign("sha256");
	signer.update(payload);
	signer.end();
	const signature = bytesToBase64Url(signer.sign(TEST_PRIVATE_KEY_PEM));
	return {
		version: 1,
		keyId: "epochgram-20260411",
		algorithm: "ECDSA-P256-SHA256",
		payload,
		signature
	};
}