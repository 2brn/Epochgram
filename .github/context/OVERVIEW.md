# Overview

Epochgram is an Obsidian plugin (TypeScript) that indexes notes and renders a timeline in a custom view.

## What It Does (Verified)
- Provides a custom view type `epochgram-view` for browsing files by date-oriented “entries”.
- Builds an index from vault files (including content lines and filename-derived dates).
- Supports file-level flags used by the UI: pinned, hidden (hide all records for a file), and marked (with a mark color).
- Supports drag-and-drop re-dating of iconless anchor-note entries by writing/upserting YAML frontmatter `<date property>: YYYY-MM-DD` for the note (default property: `date`).
- Supports per-record review state (Draft/Reviewed) via per-entry `reviewState` (store `"reviewed"`; Draft is the implicit default when missing).
- Supports per-record visibility overrides via `reviewState: "hidden"` on individual entries.
- Supports an in-view timeline search filter (session-only; not persisted) that filters visible entries across entry fields (filename/path, dates, summaries, AI summaries, topic/term, epoch metadata, Obsidian tags, and YAML frontmatter fields (including `date`)). Query language supports fuzzy text, quoted phrases (`"exact phrase"`), excluded phrases (`-"excluded phrase"`), date ranges (`YYYY-MM-DD..YYYY-MM-DD`), and `!marked` (restrict to marked entries, including inherited marks). Full-file text search is powered by an in-memory MiniSearch index built during indexing and cached to disk.
- Mark inheritance: supported for group/similarity marking ("Mark similar") and can propagate mark color to related notes (links, tags, title similarity, semantic vectors) and to notes sharing the same topic (manual or computed) even when no file is active.
- Supports tracked-change entries (when `settings.trackChanges` is enabled).
- Can reset Epochgram’s persisted JSON files (index + similarity) and rebuild from scratch (see `plugin/persistence.ts:clearEpochJsonFilesAndRebuild`).
- Offers optional Pro/desktop-only features:
  - AI bridge + AI summaries (desktop-only, Pro-gated via commands/settings).
  - “Epochs” (period epoch summaries) generation (desktop-only, Pro-gated via settings/commands).
  - Epoch inputs are summaries-only; anchor-only daily-note stubs that reduce to a date string (e.g. `YYYY-MM-DD`) are ignored so they don't create low-signal epoch jobs.

  Similarity startup maintenance (Verified)
  - On startup (after index load), if semantic vectors and/or topic classification are enabled, Epochgram enqueues missing work to fill gaps.
    - For huge vaults, semantics enqueueing is filled in a single pass so the semantics queue reflects the whole eligible vault; actual vector computation remains throttled.
  - Similarity regeneration (Pro-gated; enabled by similarity thresholds).

## Storage (Verified)
On startup, the plugin defines these paths (see `plugin/lifecycle.ts`):
- Plugin directory: `${vault.configDir}/plugins/${manifest.id}`
- Plugin data file: `${pluginDirPath}/data.json` (also written via Obsidian `saveData`)
- Timeline search cache: `${configDir}/epochgram-search.json` (MiniSearch serialized index)
- Index file: `${vault.configDir}/epochgram-index.json`
- Similarity-related files:
  - `${vault.configDir}/epochgram-semantics.json` (semantic vectors)
  - `${vault.configDir}/epochgram-topics.json` (topic classifications)
- Epochs summaries file:
  - `${vault.configDir}/epochgram-summaries.json`

Device-local Pro activation state is stored outside synced plugin data in local storage, keyed per vault/plugin, so desktop and mobile can sync settings while keeping separate activation identities.

Note: `epochgram-semantics.json` is stored as a multi-model payload with a `models` map (see `plugin/similarity/store.ts`).

Note: Disabling similarity signals via thresholds does not delete these files; the plugin simply stops using vectors/topics when disabled.

Note: When similarity thresholds are enabled (set above `0` and below `1.0`; settings UI caps at `0.99`), the plugin may enqueue background work to fill missing semantic vectors and/or missing topic classifications so the related-highlights can work without requiring a manual “Rebuild semantics” / “Rebuild topics” run.

Note: Related-highlights for the active file are invalidated when that file’s indexed snapshot changes (content hash / stat), so editing a file can refresh its similarity highlights even when the active-file path is unchanged.

Note: Enabling attachments in the timeline view forces a semantic-related refresh for the active file so newly created embeds/links can immediately participate in related-highlights when attachment rows become visible.

Note: When Obsidian’s metadata cache reports `changed` for the *active file*, Epochgram forces a semantic-related refresh for the active file so link/embedding graph updates (including new image embeds) can update related-highlights even if the indexed snapshot did not change.

Note: On the first-ever successful Pro activation, Epochgram seeds `similarityZeroShotMinScore` (Topic threshold) to `0.85`.

## Notices (Verified)
- Index rebuild progress notices are throttled to avoid spam; there is a short grace period (~10s on mobile, ~1s on desktop) so fast operations don't show progress.
  - Desktop: ~1s between progress notices
  - Mobile: ~10s between progress notices
- Similarity/vector/topic progress notices follow the same desktop/mobile throttling (see `plugin/similarity/notice.ts`).

The plugin persists:
- sync-safe `settings` via Obsidian `saveData` (see `plugin/persistence.ts`).
- device-local Pro activation state via local storage (not synced by Obsidian Sync).
- The serialized index as JSON to `epochgram-index.json` (normalized for disk; does not persist epoch entries or AI summary fields — see `indexer/disk-serialization.ts:normalizeSerializedEpochIndexForDisk`).
- Epochs + AI summaries to `epochgram-summaries.json`.

Note: view preferences (review filter mode, attachments/tracked/parsed/YAML-frontmatter/marked toggles, and epochs-view toggle) are treated as session-only and are not persisted.

## Primary Entry Points (Verified)
- Plugin class composition: `main.ts` mixes in method modules from `plugin/*`.
- View integration:
  - View type: `ui/epoch-view-mode.ts` (`epochgram-view`)
  - View implementation: `ui/epoch-view.ts`
  - View lifecycle/registration: `plugin/lifecycle.ts`, `plugin/view.ts`
- Indexing core: `indexer/indexer.ts` (stable entry) and `indexer/indexer-class.ts` (implementation).

## Release Workflow (Verified)
- On semver tag push (e.g. `1.0.0`, no leading `v`) or manual dispatch, GitHub Actions runs tests + `npm run build:production` (includes `npm run lint`), prepares release assets, and publishes the GitHub Release to `2brn/epochgram` (see `.github/workflows/release.yml`).
- GitHub Release publishes only the 3 Obsidian-supported plugin files: `manifest.json`, `main.js`, `styles.css` (removes legacy `export-epochs-standalone.js` and non-plugin assets like README/LICENSE/versions.json).
- **Artifact attestations:** Each of the 3 plugin files is cryptographically attested using `actions/attest@v4` to establish build provenance and allow users to verify authenticity via `gh attestation verify`.
- CI install steps set `ONNXRUNTIME_NODE_INSTALL=skip` during `npm ci` to avoid optional `onnxruntime-node` NuGet download failures on hosted runners.
