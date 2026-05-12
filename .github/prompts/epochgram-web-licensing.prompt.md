# Epochgram Web API Licensing Hardening

You are working in the `epochgram-web` repository.

Your task is to implement the backend changes required by the new Epochgram Pro licensing model already landed in the Obsidian plugin.

## Objective

Implement a certificate-based activation flow with these rules:

- The plugin contacts the backend only:
  - on first activation
  - after a plugin update or release build hash change
- Same-version use stays fully offline.
- The backend signs activation certificates with a server private key.
- The plugin verifies certificates locally with an embedded server public key.
- Update-time revalidation uses challenge-response signed by the plugin’s local device private key.
- No legacy token flow or backward compatibility is required.

## Release Gate

These backend checks are the highest-priority release blockers because the plugin cannot verify them by itself beyond checking the final signed certificate:

- [ ] `/api/pro/validate` must verify `challengeSignature` against the server-side stored device public key for the entitlement/install/device being refreshed.
- [ ] Certificate issuance must verify entitlement ownership and install/device ownership before signing.
- [ ] `licenseGeneration` must be server-authoritative and monotonic across revoke/replace/reactivate flows.
- [ ] Feature claims must be issued from the real backend entitlement/plan mapping, not from request data or a loose default.
- [ ] `recurring` must be treated as its own signed feature decision; `trackChanges` alone no longer unlocks frontmatter `repeat:` expansion in the plugin.

If any of the above is wrong in `epochgram-web`, the plugin may accept a validly signed but incorrectly issued certificate.

## Verified Plugin Contract

These facts are already implemented in the plugin repo and must be treated as the active integration contract unless the backend repo proves otherwise.

### Activation request

- `POST /api/pro/activate`
- JSON body contains:
  - `claimKey`
  - `installId`
  - `devicePublicKey`
  - `deviceName`
  - `pluginVersion`
  - `buildHash`

### Activation success response

- HTTP `2xx`
- JSON must contain:
  - `certificate`
- Optional:
  - `holder`

`certificate` is a signed envelope with this shape:

```json
{
  "version": 1,
  "keyId": "epochgram-20260411",
  "algorithm": "ECDSA-P256-SHA256",
  "payload": "base64url(JSON claims)",
  "signature": "base64url(signature bytes)"
}
```

The decoded claims payload must contain:

```json
{
  "schema": 1,
  "issuer": "epochgram-web",
  "audience": "obsidian-epochgram",
  "licenseId": "...",
  "licenseGeneration": 12,
  "installId": "...",
  "devicePublicKey": "...",
  "pluginVersion": "0.4.4",
  "buildHash": "...",
  "features": [
    "trackChanges",
    "recurring",
    "summarizeAI",
    "generateEpochs",
    "aiBridge",
    "similarity"
  ],
  "issuedAt": "2026-03-24T12:00:00.000Z",
  "notBefore": null,
  "expiresAt": null,
  "holder": "...",
  "refreshChallenge": "..."
}
```

`refreshChallenge` is required on certificates returned by `/api/pro/validate` and should be omitted on first activation certificates.

Feature semantics the backend must honor:

- `trackChanges` controls tracked-edit/timeline tracking behavior.
- `recurring` controls frontmatter `repeat:` expansion into synthetic recurring timeline entries.
- `recurring` is independent from `trackChanges`; do not infer one from the other unless your product policy intentionally grants both and the certificate includes both.

### Validation request

- `POST /api/pro/validate`
- JSON body contains:
  - `installId`
  - `devicePublicKey`
  - `deviceName`
  - `pluginVersion`
  - `buildHash`
  - `challenge`
  - `challengeSignature`
  - `certificate`

The plugin signs this exact logical payload with its device private key before calling `/api/pro/validate`:

```json
{
  "challenge": "...",
  "pluginId": "obsidian-epochgram",
  "pluginVersion": "...",
  "buildHash": "...",
  "installId": "...",
  "devicePublicKey": "..."
}
```

### Validation success response

- HTTP `2xx`
- JSON contains:
  - `valid: true`
  - `certificate`
- `certificate.payload.refreshChallenge` must equal the request `challenge`
- Optional:
  - `holder`

The returned certificate must be freshly signed for the new plugin version/build hash.

### Failure semantics expected by the plugin

- `404` during activation => invalid claim key
- `403` => revoked/inactive
- `409` => device limit reached
- other activation failures => generic activation failure
- validation failures should distinguish revoked/inactive when possible
- plugin follows `307` and `308` redirects

## Required Backend Behavior Checklist

Use this as a strict implementation checklist. Every unchecked item is a plugin/backend compatibility risk.

### Core contract

- [ ] Remove any assumption that the plugin stores, receives, or reuses a backend activation token.
- [ ] Treat `claimKey` as an activation-only credential.
- [ ] Issue a signed certificate on successful `POST /api/pro/activate`.
- [ ] Ensure every issued certificate contains a positive integer `licenseGeneration`.
- [ ] Bind every certificate to all of:
  - [ ] the backend entitlement/license record
  - [ ] `installId`
  - [ ] `devicePublicKey`
  - [ ] plugin/product ID (`audience` / `pluginId`)
  - [ ] `pluginVersion`
  - [ ] `buildHash`
  - [ ] granted feature list
- [ ] Derive the granted feature list from backend plan/entitlement policy explicitly, including whether `recurring` is enabled.

### Activation endpoint

- [ ] `POST /api/pro/activate` accepts the plugin request body described above.
- [ ] On success, return HTTP `2xx` with `certificate`.
- [ ] On activation certificates, omit `refreshChallenge`.
- [ ] On invalid claim key, return `404`.
- [ ] On revoked/inactive entitlement, return `403`.
- [ ] On device-limit failure, return `409`.

### Validation endpoint

- [ ] `POST /api/pro/validate` verifies that the supplied certificate was signed by your server signing key.
- [ ] `POST /api/pro/validate` verifies that the certificate still maps to an active, non-revoked entitlement.
- [ ] `POST /api/pro/validate` verifies that the challenge signature matches the stored device public key for the claimed install/device pair.
- [ ] `POST /api/pro/validate` verifies that the install/device pairing is still allowed for that entitlement.
- [ ] `POST /api/pro/validate` does not trust `installId`, `devicePublicKey`, `pluginVersion`, `buildHash`, or feature decisions from the request unless they are validated against backend state.
- [ ] If validation succeeds, return HTTP `2xx` with `valid: true` and a freshly signed certificate for the current `pluginVersion` and `buildHash`.
- [ ] Every refreshed certificate returned by `POST /api/pro/validate` includes `refreshChallenge` equal to the exact request `challenge`.
- [ ] Never return a refreshed certificate without `refreshChallenge`.
- [ ] Never echo a different challenge value.

### Generation and revocation semantics

- [ ] Maintain a monotonic `licenseGeneration` for each entitlement.
- [ ] Increment `licenseGeneration` whenever revocation-sensitive entitlement state changes.
- [ ] Never issue a certificate whose `licenseGeneration` is lower than the highest valid generation already issued for that entitlement.
- [ ] Ensure reactivation/replacement flows also respect monotonic generation.
- [ ] Ensure certificate issuance after same-device replacement/reactivation cannot move generation backward.
- [ ] Treat plugin-side deactivation as local-only state removal, not as a backend revocation event.
- [ ] Keep revocation authority server-side only.

### Same-device reactivation policy

- [ ] Decide explicitly whether the same `claimKey` may be reused on the same install/device.
- [ ] If allowed, treat it as the same install/device relationship rather than creating duplicate activations.
- [ ] If not allowed, fail clearly instead of issuing another certificate.
- [ ] Ensure same-device reactivation does not incorrectly consume another device slot.

### Redirects and transport assumptions

- [ ] If your backend depends on redirects, keep them compatible with POST-preserving `307`/`308` behavior.
- [ ] Do not rely on non-HTTPS redirect targets.

### Security requirements

- [ ] Do not add periodic validation or heartbeat requirements.
- [ ] Do not add fail-open behavior.
- [ ] Do not add test backdoors or bypass flags in production code.
- [ ] Keep signing private keys server-side only.
- [ ] Never issue a certificate from request-supplied feature flags or client-asserted entitlement state.
- [ ] Never treat possession of an old certificate alone as sufficient proof to refresh it.
- [ ] Never assume `trackChanges` implies `recurring` unless the signed certificate intentionally contains both features.

### Tests and verification

- [ ] Add or update tests proving activation returns a signed certificate.
- [ ] Add or update tests proving certificate claims are bound to install ID, device public key, plugin version, and build hash.
- [ ] Add or update tests proving `/api/pro/validate` verifies the signed challenge.
- [ ] Add or update tests proving successful validation returns a fresh certificate.
- [ ] Add or update tests proving refreshed certificates contain the exact request `challenge` in `refreshChallenge`.
- [ ] Add or update tests proving older-generation certificates are not reissued after a newer generation exists.
- [ ] Add or update tests proving revoked/inactive entitlements fail validation without a replacement certificate.
- [ ] Add or update tests proving device-limit responses preserve the expected status codes.
- [ ] Add or update tests proving same-device reactivation follows the intended backend replacement/reuse policy.
- [ ] Add or update tests proving plugin-side local deactivation does not behave like server-side revocation.

### Compatibility warning

If the current backend still returns the older activation contract, the current plugin will reject it. In particular, activation/update flows now require:

- `licenseGeneration` on all certificate claims
- `refreshChallenge` on certificates returned by `/api/pro/validate`
- a certificate body bound to the current `installId`, `devicePublicKey`, `pluginVersion`, and `buildHash`

Also note:

- the plugin cannot verify whether the backend actually validated the challenge signature correctly before signing;
- the plugin cannot verify whether the backend issued the correct feature list, including whether `recurring` was granted correctly, or the correct entitlement ownership decision;
- those checks must be enforced in `epochgram-web` itself.

Practical compatibility consequence:

- if a certificate omits `recurring`, the plugin will still parse `repeat:` frontmatter but will not emit synthetic recurring timeline entries;
- a certificate containing only `trackChanges` will not unlock recurring expansion.

An unreleased backend can therefore cause activation or post-update validation to fail even when the claim key itself is still valid.

## Signature / Key Requirements

- Use asymmetric signing only.
- The server keeps the private signing key.
- The plugin embeds only the public verification key.
- Reuse existing signing/KMS infrastructure if the repo already has one.
- If possible, emit the signature format the plugin already accepts best:
  - `ECDSA-P256-SHA256`
  - base64url-encoded signature bytes
- If your server-side library emits DER-encoded ECDSA signatures, that is acceptable.

## What To Inspect First

Read the repo and verify:

- where claim keys / licenses are stored and resolved
- where device limits are enforced
- whether there is already signing or KMS support
- whether activation records already have a device table
- whether `/api/pro/activate` and `/api/pro/validate` already exist
- whether admin tooling assumes token-based activation

If anything is not repo-verified, mark it as `Unknown` and point to the file/symbol needed to confirm it.

## Implementation Guidance

1. Find the current licensing domain/service layer first.
2. Move certificate creation and verification into shared licensing code, not route handlers.
3. Define a stable certificate claims schema and serialize it deterministically before signing.
4. Add challenge verification to the validation path.
5. Persist enough backend state to revoke or rotate entitlements cleanly, including a monotonic license generation.
6. Keep status-code behavior aligned with current plugin expectations.
7. Add or update tests for:
   - activation returns a signed certificate
   - certificate claims are bound to install ID, device public key, plugin version, and build hash
  - recurring expansion is granted only when the certificate includes `recurring`
   - update validation verifies the signed challenge
   - successful validation returns a fresh certificate
  - refreshed certificates contain the exact request challenge
  - older-generation certificates are no longer reissued after a newer generation exists
   - revoked/inactive licenses fail validation without a certificate
   - device-limit responses preserve existing behavior
  - same-device reactivation follows the backend's intended replacement/reuse policy
  - local deactivation in the plugin does not behave like a backend revocation
8. Update backend docs/README for the new certificate flow.

## Deliverables

Make the code changes and then report:

1. Which files changed
2. Final `/api/pro/activate` request/response contract
3. Final `/api/pro/validate` request/response contract
4. Certificate claims schema
5. Signature format used
6. How challenge verification works
7. What tests were added or updated
8. Any migration or operational steps needed to provision the signing key

## Constraints

- No legacy activation tokens
- No backward compatibility path for older plugin builds
- No periodic validation
- No fail-open behavior
- Prefer minimal, maintainable changes in the backend repo

## Final Goal

After your changes, `epochgram-web` should issue and refresh signed, install-bound, device-bound activation certificates that the current plugin can verify offline, while forcing a backend round-trip only for first activation and plugin-update revalidation.