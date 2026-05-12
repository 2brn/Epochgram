# Files Map

This is a “what to open first” map of the codebase.

## Root
- `main.ts` — Defines `EpochPlugin` and mixes in method modules.
- `settings.ts` — Settings schema (`EpochSettings`), defaults (`DEFAULT_SETTINGS`), and settings UI.
- `esbuild.config.mjs` / `tsconfig.json` / `vitest.config.ts` — Build/test configuration.
- `manifest.json` — Obsidian plugin metadata (id, name, version, min app version).

## plugin/
- `plugin/lifecycle.ts` — Startup: loads data, sets file paths, registers commands/view/menu, kicks off indexing.
- `plugin/view.ts` — Opens/reveals Epochgram, refreshes it, registers file-menu items.
- `plugin/mark-context.ts` — Shared “mark with context” helper: resolves ancestor/seed and applies mark changes so inherited/related marks update consistently across entry menus, file menus, and commands.
- `plugin/persistence.ts` — Persists plugin payload and writes `epochgram-index.json` (disk-normalized) + `epochgram-summaries.json`; includes `clearEpochJsonFilesAndRebuild()` reset flow.
- `plugin/local-activation-state.ts` — Splits device-local Pro activation state from sync-safe settings; reads/writes local storage and strips activation fields from synced plugin data.
- `plugin/device-proof.ts` — Generates/persists the local install identity and device keypair used for challenge-response validation.
- `plugin/pro-feature-state.ts` — Central per-feature entitlement helpers for Pro-only runtime behavior; keeps synced settings intact while unlicensed devices apply runtime-only disablement.
- `plugin/state.ts` — Persisted shapes: `PersistedPluginData` (settings-only). Session-only shapes: `EpochViewPreferences`.
- `plugin/indexing.ts` — Rebuild/refresh flows and progress notices.
- `plugin/search.ts` — Search-specific actions (rebuild/reset timeline MiniSearch index).
- `plugin/timeline-search-hydration.ts` — Builds timeline MiniSearch docs from already-loaded index state (startup fallback).
- `plugin/timeline-search-cache.ts` — Loads/saves the MiniSearch cache (`epochgram-search.json`).
- `plugin/license.ts` — Activation, local certificate verification, update-time challenge-response revalidation, and runtime Pro state.
- `plugin/pro-trust.ts` — Signed certificate parsing/verification, runtime trust cache, and per-feature certificate introspection.
- `plugin/release-fingerprint.ts` — Release fingerprint/build hash helpers (salt removed; build hash is derived from installed files or manifest fallback); no longer required for Pro certificate verification.

## plugin/similarity/
- `plugin/similarity/store.ts` — Reads/writes `epochgram-semantics.json` (semantic vectors; multi-model `models` map).
- `plugin/similarity-term-store.ts` — Reads/writes `epochgram-topics.json` (topic classifications).

## ui/
- `ui/epoch-view-mode.ts` — View type constant (`epochgram-view`).
- `ui/epoch-view.ts` — Obsidian view implementation.
- `ui/epoch-canvas.ts` — Timeline canvas and interactions (delegates to `ui/epoch-canvas/*`).
- `ui/timeline-search.ts` — Timeline search query parser (fuzzy text, quoted phrases, excluded quoted phrases, date-range filter tokens) and badge formatting.
- `ui/modals/timeline-search-modal.ts` — Modal with a search input used to update the timeline search query.
- `ui/mark-colors.ts` — Mark color palette and grouping.

## search/
- `search/timeline-search-index.ts` — In-memory MiniSearch index used by timeline search.

## indexer/
- `indexer/indexer.ts` — Stable entrypoint exporting `Indexer`.
- `indexer/indexer-class.ts` — Core indexing implementation and per-file derived data.
- `indexer/disk-serialization.ts` — Canonical “disk normalization” for `epochgram-index.json` serialization.
- `indexer/extractor.ts` — Strict date extraction utilities.
- `indexer/types.ts` — Core types (`DateEntry`, `DateSource`, serialization types).

## tests/
- Vitest suite including an Obsidian mock (`tests/obsidian-mock.ts`).
