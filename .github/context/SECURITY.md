# Security Model

## Scope

Epochgram Pro runs inside an Obsidian plugin bundle. A determined local attacker can always inspect and patch JavaScript, so the goal is not impossible DRM. The goal is to raise the cost of casual patching, bind an activation to a specific install/device, and make bypasses release-fragile.

## Current Design

- Activation uses `POST /api/pro/activate` with:
  - `claimKey`
  - `installId`
  - `devicePublicKey`
  - `deviceName`
  - `pluginVersion`
  - `buildHash`
- The backend returns a server-signed activation certificate.
- The signed certificate is feature-scoped; current feature names are `trackChanges`, `recurring`, `summarizeAI`, `generateEpochs`, `aiBridge`, and `similarity`.
- The plugin stores only device-local activation state:
  - `installId`
  - `devicePublicKey`
  - signed certificate envelope
  - locally derived witness
  - locally tracked maximum accepted license generation
  - activation timestamps/status fields
- Startup trust is offline and fail-closed:
  - verify certificate signature with the embedded server public key
  - verify install ID
  - verify device public key
  - verify plugin version
  - verify build hash
  - verify validity window
- Update-time revalidation uses `POST /api/pro/validate` with a challenge signed by the local device private key.
- Refreshed certificates must bind the issued challenge and carry a monotonic license generation.

## Threat Model

The current design is intended to resist:

- copying a synced activation blob from one vault/device to another
- replaying a certificate across plugin versions or release builds
- simple string-edit bypasses that assume one global `isPro` flag
- naive endpoint stubbing that only returns `valid: true`

The current design does not claim to resist:

- a determined attacker patching multiple JS guard sites
- a user who fully controls the local runtime and can alter the bundle
- extraction of local device-side material from a compromised machine

## Hardening Measures

- Per-feature runtime guards instead of a single global feature gate
- Production runtime trust no longer contains a Vitest/test-mode compatibility bypass
- Release-specific build hash embedded by the build pipeline
- Install-bound and device-public-key-bound certificates
- Offline local signature verification
- Challenge-response refresh after plugin update
- Refreshed certificates are accepted only when they bind the live challenge
- The plugin tracks the highest accepted license generation and rejects older replayed certificates
- Licensing/protection modules receive the extra minification pass during production build
- AI Bridge localhost server is loopback-only and CORS-restricted (allowlist of loopback origins + `app://obsidian.md`); all bridge API requests remain token-gated
- AI Bridge page sets a `no-referrer` policy to reduce accidental token-in-URL leakage via referrers

## Operational Notes

- The server signing private key must stay server-side only.
- The plugin embeds only the public verification key.
- Revocation and device-limit enforcement remain backend responsibilities.
- Build hash changes require backend awareness for the corresponding release.

## Known Limits

- Device private-key storage is local to the plugin runtime and should be treated as attacker-recoverable on a compromised machine, even though it is no longer persisted as plaintext export data.
- This system is intended to be patch-hostile, not tamper-proof.
- A backend/operator mistake that signs the wrong claims can still grant access; claim validation is only as strong as the issuing service.

## Backend Follow-up

- `epochgram-web` must issue the signed certificate described above.
- `epochgram-web` must verify update-time challenge signatures against the stored device public key.
- `epochgram-web` must return refreshed certificates that embed the issued challenge and a monotonic license generation.
- `epochgram-web` should keep signing keys in managed KMS/HSM infrastructure if available.