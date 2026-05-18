# Interfaces

## Obsidian Integrations (Verified)
- Custom view type: `epochgram-view` (see `ui/epoch-view-mode.ts`).
- View registration: `plugin/lifecycle.ts` registers `EpochView` for `epochgram-view`.
- Obsidian protocol handler: `obsidian://epochgram?key=<CLAIM_KEY>` (also accepts `claimKey=`) opens the Epochgram settings tab and triggers Pro activation.
- Startup behavior:
  - After layout is ready, the plugin ensures an `epochgram-view` leaf exists (without stealing focus).
  - Desktop and mobile: it may auto-open Epochgram after layout is ready when `settings.openEpochViewOnStartup !== false`.
  - Opening Epochgram always targets the right/sidebar leaf and falls back to a tab leaf only when a right leaf is unavailable.
  - When the view opens, the timeline snaps to an open Markdown file’s best matching record (prefers the most recently active Markdown leaf when available); otherwise it snaps to Today.
    - Snapping targets the **newest** visible non-recurring record for that file; if only recurring records are visible, it snaps to the **oldest** recurring record. Cursor line does not affect which record is chosen.
  - For a short, bounded startup window, Epochgram will also try to refocus to a *newly opened* default note (e.g., Daily note / New note created by other plugins) if it appears after the initial snap.
  - When the active Markdown file changes (primarily via the `file-open` event), the timeline auto-scrolls to keep that file’s best matching record visible.
    - On mobile, this follow-focus scroll can be computed even while the view is collapsed/hidden (using the last known viewport size), so opening the timeline later shows it already positioned.
  - Re-activating an already-open editor leaf for the same file updates highlights but does not auto-scroll the timeline.
  - After interacting with the timeline (click/tap/double-click), Epochgram suppresses that auto-scroll briefly to avoid snapping away from the user’s current viewport.
  - Daily notes from the timeline:
    - Single click/tap on a date label opens the first available daily note for that date (base note first, then ` (n)` variants).
    - Double-click / double-tap on a date label always creates a new daily note for that date using the next available ` (n)` variant name.
    - If Daily Notes `template` is configured and readable, created content comes from that template with core placeholder resolution (`{{title}}`, `{{date}}`, `{{time}}`, `{{yesterday}}`, `{{tomorrow}}`, optional `:format`).
    - If no template is configured (or it cannot be read), created content falls back to YAML frontmatter with the configured date property (default: `date: YYYY-MM-DD`).
    - Date label context menu (right-click / long-press) shows a menu title with the next filename that will be created, then a separator, then “Create daily note”.
    - Empty-area long-press toggles Normal/Epochs view.
      - On mobile, entering Epochs view is allowed when synced epoch entries already exist (even when epoch generation is desktop-only).
  - Anchor entry drag-and-drop (Verified):
    - Desktop: drag an anchor *note* anchor entry (`cdate` / `namedate` / `dateprop`) onto a different day.
      - Draggable entries are anchor-note rows that render with no summary icon.
      - Pinned rows on Today are draggable only when the file is actually anchored on Today (synthetic pinned-today clones are not draggable).
    - Mobile: long-press an anchor entry to show the context menu; dragging only begins once the finger moves (then drag onto a different day).
    - While dragging, the timeline auto-scrolls when the pointer/finger is near the top/bottom edges of the viewport.
    - On drop, Epochgram writes/upserts YAML frontmatter with the configured date property (default: `date: YYYY-MM-DD`) for the note (moving the note’s anchor to that date via `dateprop`).
    - If the dragged note is a Daily Note (per Obsidian Daily Notes settings), Epochgram also renames the note to the target date’s daily-note path (using a variant suffix when needed).
      - If the dragged note is anchored by a filename date (single date or range), Epochgram updates only the *first* date in the filename to match the drop date.
    - Dropping outside the timeline canvas cancels the operation (no file rename; no `date` update).
  - Epoch entries in Epochs view:
    - Single click/tap on an epoch entry opens a related *real* record from within the epoch’s date range.
    - Repeated clicks/taps on the same epoch cycle through all related records in priority order; switching to a different epoch resets that cycle.
    - Selection order prefers the **newest** eligible day in the range; within a day it prefers `cdate`/`namedate`/`dateprop` over `content` over `tracked`, and skips attachments when possible.
  - Many UI popups attempt to prevent unintended scroll jumps:
    - Modals/suggest popups try to restore prior focus with `preventScroll` on close (see `ui/modals/*`).
    - Topic editing entrypoints temporarily suppress Epochgram’s external auto-scroll so active-file updates don’t snap the timeline (see `ui/menus/summary-menu/topic-menu.ts`).
  - Timeline search control: the view renders a bottom-center search control that opens a modal search input; the query filters visible entries for the current view session (not persisted). Search spans filename/path, dates (including epoch ranges), summaries, AI summaries, topics/terms, Obsidian tags, and YAML frontmatter fields (including `date`).
    - Query language supports fuzzy text, quoted exact phrases (`"exact phrase"`), and date ranges (e.g. `YYYY-MM-DD..YYYY-MM-DD` or numeric one-token dash ranges like `YYYY.MM.DD-YYYY.MM.DD` / `DD.MM.YYYY-DD.MM.YYYY`).
    - Full-file text search uses an in-memory MiniSearch index built during indexing.
    - Search suggestions show up to 7 record suggestions.
      - Uses MiniSearch relevance when text tokens are present.
      - Falls back to scanning timeline records so record-only fields (summaries/AI summaries/topics/tags/aliases) still produce suggestions.
	  - In Epochs view, suggestions include epoch records in the current zoom bucket, and can also include normal (non-epoch) record matches.
      - Epoch suggestions display as `YYYY-MM-DD - YYYY-MM-DD ⸱ <summary>` when a summary exists.
      - Record suggestions render with a primary title line (note name) and a smaller metadata line (folder path without filename and summary).
      - Selecting a suggestion focuses and opens that specific record.
      - The suggestions list always ends with a `(Filter <query>)` action for non-empty input, which applies the current query without opening a file.
    - For empty input, suggestions prefer recently opened files (when available); otherwise suggestions show the most recent records. The list ends with a `(Clear)` item.
    - `Enter` selects the highlighted suggestion (opens only; does not apply the query).
    - `Alt+Enter` applies the current query without opening a file (`Option+Enter` on macOS).
    - Selecting a match scrolls the timeline to that match and opens the record.
  - Selecting a search suggestion scrolls the timeline to the chosen (or best matching) record.
- Ribbon icon: `epochgram-logo` → Epochgram” (see `plugin/lifecycle.ts`).
- Hover link source registered under `this.manifest.id` (see `plugin/lifecycle.ts`).
- File context menu items (see `plugin/view.ts`):
  - “Epochgram: Edit summary…” edits the configured YAML frontmatter description property (default: `description`) for the file, then clears any stored per-file manual summary overrides and cached AI summaries so the frontmatter description becomes the visible source of truth.
  - “Epochgram: Pin” / “Epochgram: Unpin”
  - Review state (Simple mode off):
    - Shows only the actions that differ from the file’s current effective state (Draft vs Reviewed)
    - When the file is fully hidden, both “Epochgram: Draft” and “Epochgram: Review” are shown
  - Visibility:
    - Single “Epochgram: Show” / “Epochgram: Hide” toggle (Simple mode on/off)
    - Toggles file hidden state only (preserves per-date review state)
  - Marking:
    - Normal UI: “Epochgram: Mark” (submenu for mark colors and clear)
    - Simple mode (`settings.simpleMode === true`): “Epochgram: Mark / Unmark” (single toggle)
    - Recolor/clear on an inherited-colored item targets its cached inherited source *and* inherited reason group, even if some other note is currently active.
    - When marking a different item while a note is active:
      - if the clicked file is similar/related to the active note, the active note becomes the explicit seed (ancestor)
      - if the clicked file is not similar/related to the active note, the clicked file becomes the explicit seed
    - When no file is active:
      - the clicked file becomes the explicit seed
    - Otherwise, actions apply to the resolved ancestor (typically the resolved inherited source).

- Settings UI (Verified):
  - Pro activation/settings group is rendered at the top of settings (without a visible section title).
  - General settings include `Anchor by mdate`, `Anchor date property`, and `Summary property` inputs.
  - General settings are grouped into:
    - an untitled top group: `Open on startup`, `Enable animation`, `Record width limit`.
    - `Indexer`: `Track changes` (Pro-gated/blurred when unavailable), `Anchor by mdate`, `Anchor date property`, `Summary property`, `Parse dates from other properties`, `Filename length`, `Summary length`, `Similarity` group, `Generative AI` group (desktop-only), and `Index` actions.
  - The bottom of the settings tab shows a compact metadata footer line in the format `v.<version>-<buildTimestamp>` (`YYYYMMDDHHmmss`).
  - These two inputs now commit/apply only on input blur (focus lost) or explicit reset, instead of applying on every keystroke.


- Timeline/summary entry context menu items (see `ui/menus/summary-menu.ts`):
  - The menu title shows the entry’s filename plus folder path.
  - Simple mode (`settings.simpleMode === true`) hides “Edit summary” and “Summarize AI”.
  - “Edit summary” edits the configured YAML frontmatter description property (default: `description`) for the file, then clears any cached AI summary fields for that file so that property becomes the visible summary source across that file’s records.
  - Review state:
    - Normal UI: direct actions (no submenu)
      - Shows **two** items (excluding the current state), placed next to “Mark…”
      - Actions vary by current state:
        - Draft → Review, Hide
        - Reviewed → Draft, Hide
        - Hidden → Review, Draft
      - Review/Draft apply to the selected record and also un-hide it if needed.
      - Hide applies only to the selected record.
    - Simple mode (`settings.simpleMode === true`): single “Show” / “Hide” toggle
      - “Show” maps to Draft when un-hiding.
  - Epoch entries (see `ui/menus/summary-menu/epoch-menu.ts`):
	- The menu title shows the epoch range (e.g. `Epoch YYYY-MM-DD - YYYY-MM-DD`).
  - “Regenerate…” (desktop-only; Pro + `settings.generateEpochs === true`): force-queues epoch regeneration for **only the selected epoch**

### Inherited mark caches (Verified)
The plugin caches inherited mark display state on the plugin instance:
- `__epochInheritedMarkIndexByPath`: Map of path → mark color index
- `__epochInheritedMarkSourceByPath`: Map of path → source/ancestor path
- `__epochInheritedMarkReasonByPath`: Map of path → reason string (`embedding` (semantic vectors) | `topic` | `title` | `link` | `tag` | `unknown`)
- `__epochInheritedMarkComputedAt`: number timestamp; updated on recompute and used as a signature for UI cache invalidation.

Inherited mark selection is deterministic and uses reason priority:
`link` > `tag` > `title` > `topic` > `embedding`.

Recompute behavior (Verified)
- After the index is loaded (e.g., on plugin/app startup), Epochgram schedules a background inherited-mark recompute so inherited colors populate without requiring a manual mark change.

## Commands (Verified)
Commands are registered in `plugin/lifecycle.ts` and are listed in `.github/context/COMMANDS.md`.

## Persistence / Files (Verified)
The plugin reads/writes:
- Obsidian plugin data via `loadData()` / `saveData()` (payload contains sync-safe `settings` only).
- Local storage for device-bound Pro activation state (`installId`, `devicePublicKey`, signed activation certificate envelope, local witness, `activationGenerationFloor`, activation timestamps/status fields, masked claim-key preview) so Obsidian Sync does not clone one device identity onto another.
  - The masked claim-key preview is preserved across startup validation failures (so settings can still show a stored key), but failed manual activation attempts do not persist a newly entered key.
- Activation certificate interface details:
  - certificates must carry a positive `licenseGeneration` claim;
  - certificates may scope access with signed feature names including `trackChanges`, `recurring`, `summarizeAI`, `generateEpochs`, `aiBridge`, and `similarity`;
  - certificates returned by `POST /api/pro/validate` must also carry `refreshChallenge` matching the request challenge exactly;
  - the plugin rejects certificates below the stored `activationGenerationFloor`, even if their signatures verify.
- Index JSON file: `${vault.configDir}/epochgram-index.json` (does not persist epoch entries or AI summary fields).
- Timeline search cache: `${configDir}/epochgram-search.json` (deterministic cache used to restore full-text timeline search quickly on startup; written only when the cache is dirty/changed).
  - Search index updates are mutation-aware: `upsert`/`removeById` no-ops do not mark cache dirty, preventing startup no-op events from rewriting `epochgram-search.json`.

Index no-op detection (Verified)
- Per-file index data may include `indexedMtimeMs` + `indexedSize` for the last indexed file stat, used to skip reprocessing when deferred resync detects spurious/no-op file events (prevents unnecessary `epochgram-index.json` rewrites on startup).
- For deferred resync, Epochgram also uses a per-file `contentHash` no-op check for text files (desktop + mobile) to avoid rewrites when content is unchanged.
- Metadata-cache `changed` events for the active file defer a normal resync (not forced), so startup metadata refresh does not bypass no-op guards.
- Disk normalization for `epochgram-index.json` sorts key order (top-level `files`, nested `trackedDates`, and date keys) so `JSON.stringify` output is deterministic and doesn't flap due to iteration order.
- When persisting the index, Epochgram compares the new serialized payload with the current on-disk file and skips the write if identical.

Managed-file reload notice (Verified)
- When managed Epochgram files trigger external reload polling (`epochgram-index.json`, plugin `data.json`, vectors/topics files), Epochgram shows a short notice with the reload reason (for example, managed file modified/created/deleted/renamed).

Note: `epochgram-index.json` does not persist a per-file `mdate` anchor field; the file-stat anchor is `cdate` (and it can also persist other derived anchors like `namedDate` and optional `dateProp`).
- Similarity-related JSON files:
  - `${vault.configDir}/epochgram-semantics.json` (semantic vectors)
  - `${vault.configDir}/epochgram-topics.json` (topic classifications; includes a top-level `model` field storing the zero-shot model ID used for classification)
- Epoch summaries JSON file:
  - `${vault.configDir}/epochgram-summaries.json` (stores both epoch entries and non-epoch AI summaries)

Note: Disabling similarity signals via thresholds does not delete these files; it only affects whether/how the plugin uses the stored vectors/topics.

## Internal “method modules” (Verified)
`EpochPlugin` behavior is composed via `Object.assign(EpochPlugin.prototype, ...)` in `main.ts`.
Method modules live under `plugin/*` (e.g. `plugin/persistence.ts`, `plugin/view.ts`, `plugin/lifecycle.ts`).
