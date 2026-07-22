# Architecture

## High-Level Components (Verified)
- Plugin entry: `main.ts` defines class `EpochPlugin` and `Object.assign`s method modules onto its prototype.
- Lifecycle + registration: `plugin/lifecycle.ts`
  - Reads persisted data via `loadData()`.
  - Sets storage paths (`pluginDirPath`, `indexFilePath`, `dataFilePath`, plus similarity file paths).
  - Registers commands, ribbon icon, view, hover link source, file menu items.
  - Kicks off async index initialization and periodic polling.
- View management: `plugin/view.ts`
  - Opens/reveals the `epochgram-view` leaf.
  - Refreshes all open Epochgram panes (preference sync + index refresh).
  - Registers file explorer context menu entries: file actions (Pin/Mark/Review/Draft/Hide) and folder actions (Review/Draft/Hide).
- Persistence: `plugin/persistence.ts`
  - Persists sync-safe `settings` via `saveData`.
  - Sync-safe settings include What's New state (`whatsNewShownVersions`, `whatsNewOptOut`) so one-time-per-version startup behavior is tracked across devices.
  - Stores device-bound Pro activation state in local storage per vault/device (not in synced plugin data).
  - Local activation state now consists of `installId`, `devicePublicKey`, a signed activation certificate envelope, a locally-verified witness, a monotonic `activationGenerationFloor`, and activation timestamps/status fields.
  - Writes the serialized index JSON to `epochgram-index.json` (normalized for disk; excludes epoch entries and AI summary fields via `indexer/disk-serialization.ts:normalizeSerializedEpochIndexForDisk`). Disk normalization also sorts key order (e.g., `files` and nested `trackedDates`) so serialization is deterministic across restarts (reduces no-op rewrites, especially on Android/mobile).
  - Skips rewriting `epochgram-index.json` when the on-disk contents already match the new serialized payload (prevents mtime-only changes).
  - Writes `epochgram-summaries.json` for epochs + AI summaries.
  - Tracks file stats (and, on mobile, content hashes) for change/no-op detection to avoid unnecessary index rewrites.
- Indexing: `plugin/indexing.ts` + `indexer/*`
  - Coordinates (re)build and refresh flows (with progress notices).
  - `Indexer` owns per-file derived data and produces serialized index output.
  - After successful rebuild/refresh, Epochgram saves a MiniSearch cache so full-text timeline search can be restored quickly on next startup.

## Startup Flow (Verified)
- `plugin/lifecycle.ts:onload()`:
  - Loads saved data (`loadData`) and merges sync-safe settings into `DEFAULT_SETTINGS`.
  - Overlays device-local Pro activation state from local storage after loading synced settings.
  - Applies bounds/clamping for some settings.
  - Creates `this.indexer = new Indexer(this)`.
  - Starts `initializeIndex()`; if missing/fails, rebuilds index.
  - Registers vault/workspace file event handlers immediately (even while the index is still loading) to avoid missing startup-created notes.
  - Indexing events include a metadata-cache `changed` safeguard for the *active file* to catch Properties/frontmatter edits that may not emit vault-level `modify` events.
    - When this safeguard fires, Epochgram also forces a semantic-related refresh so link graph updates (e.g. new embeds) can update related-highlights even if the indexed snapshot did not change.
  - Once ready, refreshes views.
  - When Epochgram is opened on startup, it may run a short-lived refocus loop to snap the currently-open file to the focus anchor; these refocus attempts suppress hover/highlight so startup doesn’t repeatedly retrigger hover animations.
  - When Epochgram is opened on startup, it may run a short-lived refocus loop to snap the currently-open file to the focus anchor; these refocus attempts suppress hover/highlight so startup doesn’t repeatedly retrigger hover animations. The loop cancels as soon as the user interacts with the timeline (click/pan/zoom/scroll-nav) to avoid “snap back” fights.
  - Canvas resize now preserves the current world anchor at the Today focus ratio (for both live and target offsets), reducing startup/post-resize position drift.
  - When focusing/snapping the timeline view to the currently-open file (startup refocus / initial snap):
    - If a visible on-screen record matches the editor cursor line, that record is preferred.
    - Otherwise, Epochgram selects the file's record date that is nearest to Today (applies to both recurring and non-recurring matches).
  - On `file-open`, if the opened file is indexable but missing from the current index, Epochgram opportunistically indexes it and refreshes views.
  - On startup, Epochgram may open a dedicated What's New view tab (`epochgram-whats-new`) when a new eligible embedded page exists and the user is not opted out.
    - The view renders bundled markdown content from the build-time registry embedded into `main.js`.
    - No per-version What's New markdown file is written under `.obsidian`.
    - Existing users: only the current plugin version is considered, and shown once.
    - Fresh install (no saved settings): opens the latest available embedded What's New page once.
    - The service page contains a checkbox marker; toggling it updates `settings.whatsNewOptOut` via file modify events.
  - After index load, runs similarity startup maintenance to enqueue missing vectors/topics when enabled. Vectors cover “likely text” files (see `utils.ts:isLikelyTextFileExtension`), while topic classification runs only for Markdown notes.
    - For huge vaults, missing semantic vectors are enqueued in a single pass so the semantics queue reflects the whole eligible vault (vector computation remains throttled in the background queue).
    - Topic classification enqueueing remains markdown-only and is backfilled in batches.

## Shutdown Flow (Verified)
- `plugin/lifecycle.ts:onunload()` calls `plugin/view/leaf-actions.ts:onViewUnload()` (best-effort), which:
  - Stops the local AI bridge server.
  - Terminates the similarity worker (if any).
  - Detaches all Epochgram view leaves (`detachLeavesOfType(VIEW_TYPE_EPOCH)`) so stale panes don’t survive a hot reload.

## AI bridge (Verified)
- The plugin may auto-open the Chrome bridge page for background work, but it throttles silent/background open attempts to avoid spawning duplicate Chrome tabs after idle.
- When enqueueing AI summary jobs, Epochgram replaces any older queued/in-flight jobs for the same logical work group (`filePath + groupType + groupDate`, with `groupType: "anchor"` normalized to a single stable group). This prevents duplicate processing when the same file/group is re-enqueued with slightly different targets or block ranges.

## AI Result Handling (Verified)
- When an epoch summary job completes, Epochgram stores it by inserting an `epoch://...` entry into the in-memory aggregated index and schedules a small debounced `refreshEpochViews()` so newly-created epoch entries (including future dates) appear without waiting for disk persistence.
- To avoid race conditions, older epoch job results (by `createdAt`) do not overwrite newer results for the same `epoch://...` key.

  ## Pro Activation (Verified)
  - Activation is certificate-based.
    - The plugin generates or loads a local device keypair.
    - It sends the claim key, `installId`, `devicePublicKey`, and plugin version to `POST /api/pro/activate`.
    - The backend returns a server-signed activation certificate bound to that install, device public key, plugin version, and a monotonic `licenseGeneration`.
  - Startup trust is local and fail-closed.
    - The plugin verifies the certificate signature offline using an embedded server public key.
    - It also checks install ID, device public key, plugin version, certificate validity window, and that the certificate generation is not below the stored local `activationGenerationFloor` before unlocking features.
  - Update-time validation uses challenge-response.
    - When the installed plugin version changes, the plugin signs a server challenge with the local device private key and exchanges the stored certificate for a fresh certificate.
    - The refreshed certificate must include `refreshChallenge` equal to the exact request challenge or the plugin rejects it.
    - Same-version use remains offline.
  - Downgrade/replay resistance is generation-based.
    - The plugin stores the highest locally-accepted `licenseGeneration` as `activationGenerationFloor`.
    - Any later certificate with a lower generation is rejected even if its signature is otherwise valid.
  - After successfully activating Pro, the plugin triggers similarity startup maintenance so vectors/topics can enqueue immediately (no restart required).
  - On first-ever Pro activation, Epochgram enables Track changes and turns on the “Tracked changes” filter so tracked entries are visible immediately.
  - Pro capabilities are feature-scoped inside the signed certificate; recurring `repeat:` expansion now requires the dedicated `recurring` feature instead of piggybacking on Track changes.
  - When Pro later becomes inactive on a device, Epochgram does not rewrite synced Pro settings back to Free values.
    - Instead, it keeps synced settings intact and applies per-feature runtime gating based on the locally verified certificate.
    - The inactive device still forces local timeline/view preferences to a non-Pro state so Pro-only UI stays disabled until re-activation.

## Persistence Flow (Verified)
- `persist()`:
  - Ensures index is loaded (unless `skipEnsure`).
  - Serializes index via `this.indexer.toJSON()`.
  - Saves sync-safe plugin settings via `saveData({ settings })`.
  - Saves device-local Pro activation state separately in local storage.
  - Writes the index to `epochgram-index.json` in a disk-normalized form (epoch entries and AI summary fields are not persisted there).
  - Writes `epochgram-summaries.json` containing:
    - `epochsByDate`: extracted epoch entries
    - `aiSummaries`: extracted non-epoch AI summaries (keyed by `file|date|groupType`)
      - Each record stores summary text + input hash, plus a required visibility marker `v` (`0|1`) that controls whether that AI summary is allowed to display in the timeline/UI.
  - Epoch entries are identified by `file` starting with `epoch://` (not by `source`).
  - When loading `epochgram-summaries.json`, Epochgram only accepts epoch entries whose `file` starts with `epoch://` and whose `epochBucket` is a supported bucket (no bucket inference from the path).
  - After index rebuild/refresh, Epochgram reapplies saved `aiSummaries` from `epochgram-summaries.json` to the fresh in-memory index before refreshing views, so settings-driven index refreshes keep previously generated AI summaries visible.

MiniSearch cache (Verified)
- Timeline search uses an in-memory MiniSearch index.
- After a successful index rebuild/refresh (or other MiniSearch mutations), Epochgram may write `${configDir}/epochgram-search.json` when the cache is dirty.
- On startup, Epochgram attempts to load the cache; if missing/unreadable, it falls back to a lightweight hydration from already-loaded index state.
- During normal operation, incremental indexing (create/modify/rename/delete) updates the MiniSearch index and bumps `__timelineSearchIndexVersion` so any active timeline search filter re-evaluates immediately.
- During active note editing, normal user-note `modify` work is coalesced through a short deferred queue instead of reprocessing on every raw event; repeated `editor-change`, `vault.modify`, and active-file metadata-cache `changed` events for the same path collapse into one later `processFile` run.
- Edit-driven index persistence is also deferred: after a successful deferred edit flush, Epochgram schedules a short delayed `persist()` rather than writing `data.json` / `epochgram-index.json` immediately on each keystroke.
- Tokenization note: the timeline search index intentionally drops most 1-character alphabetic tokens (keeps 1-character numeric tokens). Unquoted search queries apply the same rule so queries like `Rawdat A.` do not accidentally require an unindexable `A` token.

### Reset Flow (Verified)
- `clearEpochJsonFilesAndRebuild()` (see `plugin/persistence.ts`):
  - Deletes `epochgram-index.json`, `epochgram-semantics.json`, `epochgram-topics.json`, and `epochgram-summaries.json` if present.
  - Clears in-memory similarity/index caches.
  - Rebuilds the index from scratch.

### Settings Reset (Verified)
- The Settings tab “Rebuild” button opens a checkbox modal; defaults to **no options selected**.
- The Settings tab “Reset” button opens a checkbox modal to select reset actions; defaults to **no options selected**.
- On Pro desktop, the **AI summaries** rebuild option is available even when Auto summarize (`summarizeAI`) is OFF; the toggle only controls automatic enqueue behavior, not manual rebuild permission.

Rebuild ordering (Verified)
- When both **AI summaries** and **Epochs** are selected in the rebuild modal, the rebuild flow enqueues AI summary jobs first.
- Epoch regeneration then runs as a **bucket cascade** from **day → … → year**, starting only once the AI bridge becomes idle.
- This preserves dependency order so higher-level epochs are generated from fresh lower-level epochs (and fresh AI summaries).
  - Options include: Settings, Data files, Search, Reviews, Semantics, Topics, Tracked changes, AI summaries, Epochs.
  - Settings:
    - Resets plugin settings back to `DEFAULT_SETTINGS` (and, when “keep license” is selected, keeps the local Pro activation state so Pro stays active on that device).
    - If Pro is active after license refresh, applies Pro similarity defaults.
    - Resets `viewPreferences` to first-load defaults (tracked-changes filter follows Pro state; Epochs view stays session-only).
    - Clears the persisted timeline search query back to the default empty string.
  - Data files:
    - Deletes `epochgram-index.json`, `epochgram-semantics.json`, `epochgram-topics.json`, and `epochgram-summaries.json` and rebuilds the index.
    - Forces similarity startup maintenance to run again after rebuild.
    - Clears runtime in-memory state that can otherwise survive a disk wipe (semantic/topic queues, inherited mark cache, any planned follow-up work, and any queued/in-flight AI bridge work).
  - Semantics:
    - Clears the vectors store and resets in-memory similarity state.
    - Forces similarity startup maintenance to run again so vectors can re-enqueue.
  - Topics:
    - Clears the topics store and resets in-memory topic similarity state.
    - Forces similarity startup maintenance to run again so topics can re-enqueue.
  - Tracked changes:
    - Clears tracked entries and also clears tracked snapshot/baseline state so changes don’t immediately reappear.
  - AI summaries:
    - Clears per-entry AI summary fields and also clears any already-applied AI summaries on the current in-memory aggregated index.
    - Cancels queued AI work (throttled enqueues, reduce follow-ups, and the AI bridge queue if running).
  - Epochs:
    - Clears extracted epoch entries and cancels queued epoch generation work (including any queued AI bridge work).
  - Search:
    - Clears the timeline MiniSearch index (memory + cache).
    - Clears the persisted timeline search query and clears any active search filter in open Epochgram panes.
    - Bumps the search index version so any open search UI re-evaluates immediately.
    - Cancels any scheduled cache-save timer to avoid stale post-reset writes.
  - For non-Data-files resets, Epochgram persists and refreshes open Epochgram panes.

## Tracked Changes (Verified)
- Tracked-change detection compares a per-file **baseline snapshot** to the current file contents and emits `source: "tracked"` entries for added/modified/removed fragments.
- When Track changes is enabled, edit-time tracked reprocessing is scheduled through the same short deferred queue as normal note modifies; Epochgram no longer performs the full tracked diff synchronously on every `editor-change` callback.
- Snapshot normalization is applied before diffing:
  - Normalizes line endings to `\n` (handles `CRLF`, `CR`-only, and Unicode separators).
  - Strips a leading BOM and normalizes Unicode to NFC.
  - Strips the leading YAML frontmatter block (`--- ... ---`) so frontmatter-only edits do not create tracked-change entries.
- Tracked entries are typically bucketed under the current day key (`formatDate(today())`).
  - When a device has not indexed a file for at least a day (last `trackedSnapshotDate` is before today) and the file’s `stat.mtime` indicates the change happened on an earlier day, Epochgram buckets those tracked entries under the file’s mtime day instead. This avoids Obsidian Sync-delivered edits appearing as “today” on the device that was offline.

## UI/View Integration (Verified)
- View type constant: `ui/epoch-view-mode.ts` exports `VIEW_TYPE_EPOCH = "epochgram-view"`.
- View registered in `plugin/lifecycle.ts` via `registerView(VIEW_TYPE_EPOCH, ...)`.
- Ribbon icon: `epochgram-logo` → Epochgram”.

Timeline dense mode (Verified)
- Dense bars are only rendered when `scale <= SUMMARY_MIN_SCALE`.
- **Global dense mode:** only considers viewport-rendered days (`renderIndices`). If the proxy row count exceeds `SUMMARY_DENSE_GLOBAL_THRESHOLD`, those days switch to dense bars.
- Dense bar height (zoom-out): a single bar whose thickness is scaled by density (4 entries per unit), based on placeholder stroke thickness, clamped to day spacing.
- Dense bars increase opacity and thickness (height only) on hover (same color).
- Clicking a dense bar opens the underlying record (no auto-zoom).
- In global dense mode, hover transitions are applied instantly (no easing) to keep interactions responsive.
- While zooming (wheel Ctrl/Cmd or Shift zoom, or pinch zoom), hover is suppressed and cleared until the user moves the pointer again (so incidental pointer jitter does not immediately re-trigger hover/preview). Click/drag/open suppression is time-based via a short `suppressClickUntil` window established by wheel gestures; it does not require pointer movement to re-enable clicks.
- Ctrl/Cmd+Wheel zoom animates at a constant rate (no easing). Reversing wheel direction during an in-flight zoom retargets from the current scale so the zoom reverses immediately.
- While using scroll navigation (Alt/Option+Wheel or Alt/Option+Up/Down) in normal view, hover is temporarily suppressed against incidental pointer jitter so the navigation target stays focused. Each step re-centers the target at the focus anchor (even if already visible). When navigation reaches the start/end in no-wrap mode, further navigation keeps the boundary target focused if hover was lost.
- Manual panning/scrolling (wheel pan, mouse-drag pan, touch pan) resets the stored scroll-nav target so the next scroll-nav step re-anchors from the current viewport/context. Wheel pan uses a constant-speed animation; reversing wheel direction interrupts the in-flight wheel-pan animation and re-anchors from the current offset. Any left-click during an in-flight wheel/inertia motion cancels the motion and consumes the click (so it stops scrolling without opening a record).
- Refreshing the timeline index (including rebuild/refresh flows) and changing timeline view state (filters/settings/view toggles) also resets the stored scroll-nav target so navigation re-anchors from the updated viewport/context.
- Active-file sync now preserves existing scroll-nav anchors when the newly active file path is not present in the indexed timeline (for example, non-indexed attachments/non-md leaves), so Shift+Wheel anchor zoom can still lock to the current timeline target.
- Enabling attachments in the timeline view also forces a semantic-related refresh for the active file so newly added embeds/links can immediately participate in related-highlights after the view filter changes.
- Jumping back to Today (e.g. double-click on empty space to scroll to Today) resets the stored scroll-nav target as well.
- If a scroll-nav group has only a single navigable record, scroll-nav highlights the **date marker/label** rather than the record.
- In semantic related/similar navigation mode, scroll navigation steps per **date** (unique day targets) and highlights only the date marker/label (not individual records).
- When in Epochs view, scroll navigation steps across **days that have any visible epochs** at the current zoom bucket (date-level stepping; ignores active-file similarity groups).
- Alt/Option+Wheel, Alt/Option+Up/Down, and quick two-finger tap trigger scroll navigation in Epochs view as well as normal view.
- If the current navigation anchor is color-marked (explicitly or via inherited marks), scroll navigation can include other files in the same mark color group; semantic-related expansion is also constrained to that same color group.

Touch interactions (Verified)
- Touch long-press can open context menus for both summary entries and date labels (see `ui/epoch-canvas-events/touch.ts`).
- Date label hit-testing uses extra touch-only padding so long-press is easier on mobile (see `ui/epoch-canvas-constants.ts:DATE_TOUCH_HIT_PAD`).
- Mobile right-swipe sidebar collapse explicitly cancels in-flight timeline view motion (inertia / wheel-pan / wheel-zoom / animated pan) before collapsing, so the hidden panel does not continue animating.
- Once the right-swipe hide gesture is recognized on mobile (`dx > 0` and predominantly horizontal), the active touch sequence is locked to swipe-hide and does not transition into timeline pan/scroll.
- When the timeline canvas is resized to hidden (`0x0`, e.g. panel collapsed), Epochgram force-stops in-flight view motion and cancels any pending canvas animation frame so motion cannot continue while hidden.
- When the view is in motion (inertia / animated pan/zoom), a 1-finger touch is treated as “stop momentum” only: the gesture consumes tap/long-press actions so it does not open records, open date labels, toggle Epochs view, or open context menus.
- While stopping momentum, touch hover feedback is suppressed (no hover/preview flash). The consumed tap still arms the double-tap window so a second tap can trigger the intended double-tap action.
- Deferred “date label tap opens after a short delay” is canceled as soon as a pan starts, and is also gated against in-flight view motion.

Timeline zoom-in sampling (Verified)
- When `scale > SUMMARY_MIN_SCALE`, Epochgram does **not** render dense bars.
- Under dense conditions (global threshold or per-day overflow), it switches to a **compact** summary list:
  - Renders the first $N$ rows that fit vertically (based on the computed max row slots at the current zoom).
  - If there are more records than visible slots, the last visible record’s text is annotated with a `+0..9` prefix (example: `+789`).
    - The prefix count includes the last visible record.
    - The prefix is applied to both the title and the wrapped text so it stays visible under wrapping/truncation.
    - If any hidden records (entries with `reviewState: "hidden"`) under `+n` are marked / inherited-marked / semantic-related (or the active file), the `+n` badge uses that same accent color.
    - If the hidden portion contains the currently opened file, the `+n` badge prefix is rendered in bold as well.
    - Clicking the `+n`-prefixed record does not auto-zoom.
  - Additionally, at zoom-in, if a day is too narrow to render even an ellipsis (`needsDenseByWidth`), it falls back to compact mode rather than rendering placeholder strokes.

Timeline compact-mode virtualization (Verified)
- At extreme zoom where compact mode can render *all* rows (no `+n`) but the day has very large entry counts, rendering and hit-testing can become too slow if it processes every row.
- In that case, Epochgram virtualizes compact mode:
  - Only viewport-visible rows (plus a small buffer) are measured/rendered.
  - Only viewport-visible rows get hit rects (hover/click stays responsive).
  - Hover behavior (font growth + row expansion) still matches normal mode, but only for rows inside the viewport slice.

Timeline partially-clipped day virtualization (Verified)
- When `scale > SUMMARY_MIN_SCALE` and a day has very large entry counts, Epochgram may virtualize text measurement when the day is only partially visible in the viewport.
- It computes an approximate per-column visible row index range and skips expensive text measurement for rows outside that slice.
- To keep hover/shift behavior consistent with normal mode, the currently hovered row (and its immediate above/below neighbors in the same column) are always measured even if they fall outside the slice.
- In this mode, hover-driven reflow is disabled (rows do not shift/resize) to avoid large, confusing movement while only a portion of the day is visible.

Timeline zoom-out placeholders (Verified)
- When `scale < SUMMARY_MIN_SCALE`, normal (non-dense) summaries do not render text; each entry row renders as a short horizontal placeholder stroke. This is why zoomed-out days with a few entries appear as a few “lines”.
- When `scale > SUMMARY_MIN_SCALE`, placeholder strokes are not used; the zoom-in fallback is compact mode (when dense conditions apply).

Timeline zoom-out sampling (Verified)
- At extreme zoom-out, the renderer may downsample the set of day indices it iterates for performance.
- Even when downsampling, it still includes all day indices that have any visible entries so records never disappear solely due to sampling.

Timeline file deletion confirmation (Verified)
- Deleting an entry's underlying file from the timeline respects Obsidian's core `Files and links > Trash > Confirm file deletion` setting (`promptDelete`).
- When enabled, Epochgram shows a confirm modal with a “Don’t ask again” checkbox that disables `promptDelete`.

## Text Rendering (Verified)
- Epochgram “drop cap” lead splitting uses stop-word/punctuation boundaries by default (including sentence-ending `.` when it looks like an end-of-sentence boundary).
- Epochgram rendering opts into a 6-word fallback only if no boundary is found via punctuation or stop-words.

## Workers / Background (Partially Verified)
  - Verified: file paths are set in `plugin/lifecycle.ts`, and workers are terminated in `plugin/view/leaf-actions.ts:onViewUnload()` (invoked from `plugin/lifecycle.ts:onunload()`).
  - Verified: similarity worker protocol includes `ping`, `primeWasm`, `loadModel`, `loadZeroShot`, `embedPooled`, `zeroShotScoreBatch`, `zeroShotScoreLabels`.
    - Pointers: `plugin/similarity-embed.worker/handler.ts:installSimilarityEmbedWorkerHandler` and `plugin/similarity/worker-rpc.ts`.

- Verified: ORT WASM loading is handled by the worker via `vendor/onnxruntime-web/` paths.
  - The plugin no longer inlines/transfers `.wasm` binaries from `main.js` (see `plugin/similarity/worker-ort.ts:primeOrtWasmForWorker`).
  - The worker config probes/selects a WASM base (see `plugin/similarity-embed.worker/wasm.ts`) and supports both `vendor/onnxruntime-web/` and plugin-root fallbacks.
  - Note: `primeWasm` is currently supported by the worker handler but is not used by the plugin-side priming function.

- Topic (zero-shot) classification uses a short structured excerpt (headings + highlights; falls back to a short body snippet), capped at ~450 chars to keep inference fast.

## Progress Notices (Verified)
- Indexing and similarity background tasks emit Obsidian `Notice` progress updates.
- These are throttled with a short grace period (~10s on mobile, ~1s on desktop) so fast operations don't show progress.
  - Desktop: ~1s between progress notices
  - Mobile: ~10s between progress notices
- While the active Markdown editor has focus, similarity progress notices are suppressed.

## Desktop Progress UI (Verified)
- On desktop, long-running task progress is shown in the Obsidian status bar (minimal text) instead of repeated `Notice`s.
- Mobile continues to use throttled `Notice` progress.
- On desktop, a single short `Notice` is shown when a task starts (or is queued) *only if it lasts longer than ~1s*, before status-bar progress updates begin.
- Accessibility: the status-bar progress element uses `aria-label` only (no `title`) and aggregates all active progress texts with newline separators. The element is clickable to request cancellation for the currently active progress kind.
- AI bridge work shows combined progress in the shared desktop progress indicator (e.g. `AI… 4/21`).
  - Progress uses live totals: processed (`done+errors`) over all in-flight/queued work, plus any deferred planned epoch work.
  - After all AI work completes, the next batch restarts from zero processed (e.g. `0/N`) rather than carrying over previous batch counts.
  - The denominator is snapshotted per run (does not grow mid-run as new work is enqueued), including cascaded epoch runs where year totals depend on lower buckets.
  - The button text does not include queued/connected/disconnected wording.

- Similarity vector updates (“Semantics…”) snapshot the pending-file batch per run so the denominator does not increase mid-run; newly enqueued files start a new batch.
- Topic (zero-shot) similarity updates (“Topics…”) also snapshot the pending-file batch per run so the denominator does not increase mid-run; newly enqueued files start a new batch.
