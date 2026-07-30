# Domain Model

## Dates and Entries (Verified)
- Date parsing is implemented in `indexer/extractor.ts` using a strict chrono configuration.
- Content/filename date extraction only accepts dates with an explicit year; month/day inputs without a year are ignored to avoid “current-year” inference.
- Date ranges are supported for both content parsing and filename-derived parsing and expand inclusively to one entry per day.
  - Supported connectors include `to`, `until`, `through`, `till`, `thru`, `between … and …`, `A - B` (hyphen/en-dash/em-dash), and `A .. B` / `A ... B` (whitespace-tolerant).
- The index stores entries with a `source` discriminator (see `indexer/types.ts`):
  - `"cdate" | "namedate" | "dateprop" | "content" | "tracked" | "epoch"`

Frontmatter date property (Verified)
- Epochgram extracts an optional anchor date from a configurable YAML frontmatter property (default: `date`) (preferring Obsidian’s metadata cache when available, with a file-content YAML fallback).
- Users can change a note’s anchor date from the timeline by dragging an iconless anchor-note entry to a different day, which writes/upserts `<date property>: YYYY-MM-DD` in frontmatter (attachments, parsed/range-day entries, and pinned-today rows are not draggable). When the note’s anchor is derived from its filename (Daily Note format or a filename date), Epochgram also attempts to rename the note so the filename’s anchor date matches the dropped date.
- For Daily Note filenames that include time tokens, drag-and-drop renaming keeps the existing time/subsecond parts and changes only the date parts.
- This anchor is stored as source `dateprop` and has higher priority than `cdate` but lower than `namedate`.
- `dateprop` is treated as a first-class anchor entry (like `cdate` / `namedate`) across AI summary and epoch workflows, including for start/end block-range targeting.
- Content-date extraction skips scanning the raw YAML block for the anchor `date:` key and does not index `date:` as a parsed/content date; other frontmatter keys may still emit `fromFrontmatter: true` parsed/content entries.
- Frontmatter-derived parsed/content entries are flagged with `fromFrontmatter: true`.
- Parsed/content extraction from YAML frontmatter is controlled by `settings.parseDatesInFrontmatter` (default `false`).
  - When `false`, body-parsed content dates still index normally, but frontmatter-derived parsed/content dates are not emitted.
  - When `true`, frontmatter-derived parsed/content dates are emitted and continue to be flagged with `fromFrontmatter: true`.
  - Raw YAML frontmatter remains the source of truth for top-level scalar keys; metadata-cache fallback token parsing supplements only nested paths so cache-normalized scalar values cannot introduce phantom parsed dates.
- Frontmatter suppression flags (Verified):
  - `notracked: <any>` suppresses tracked-change indexing for the file (no tracked entries are indexed or shown on the timeline).
  - `noparsed: <any>` suppresses parsed content-date indexing for the file (content-derived entries are not indexed or shown on the timeline).
  - `noindex: <any>` excludes the file from Epochgram indexing entirely (the file is removed from the timeline index and search cache).
- Explicit UI frontmatter overrides (Verified):
  - `pin:` / `pin: today` pins the file to Today and takes priority over the saved index pin state.
  - `pin: date` renders a date-tied pin label only while that anchor date is inside the current viewport.
  - `pin: dock` renders the same date-tied pin label and keeps a docked semitransparent label visible when that anchor date is outside the current viewport.
  - `mark: #hex` stores an explicit mark color and takes priority over the saved index mark state.
  - Removing one of these frontmatter keys removes the explicit override on the next index pass.
- For content-derived entries (`source: "content"`), the normal UI summary strips embedded date literals (e.g. `2026-03-05`, `07/01/2025`, `March 8, 2025`) so the summary doesn’t redundantly repeat the row’s date.
- If stripping date literals would make a content-derived summary empty (for date-only lines), Epochgram falls back to the original trimmed line/body text so parsed content-date records are not dropped during aggregation.

Frontmatter recurring schedule `repeat` (Verified)
- A note may define a recurring schedule in YAML frontmatter using `repeat: <string>`.
- Recurring occurrence expansion is controlled by the signed Pro feature `recurring`; without that feature, the schedule may be parsed but no `recurring: true` occurrences are emitted into the timeline index.
- When Pro access changes (activate/deactivate), the index re-aggregates synthetic entries so recurring occurrences appear/disappear immediately without requiring an Obsidian reload.
- Accepted friendly formats (case-insensitive; commas optional whitespace):
  - `every day`
  - `every <n> days`
  - `every week on <weekday>[,<weekday>...]`
  - `every <n> weeks on <weekday>[,<weekday>...]`
  - `every month on <day>` (1..31 or -1..-31; negative counts from end of month)
  - `every year on <MM-DD>`
- Optional modifiers (can appear anywhere in the string):
  - `from <YYYY-MM-DD>` (defaults to the note’s anchor date in priority order: filename date `namedate` > YAML `date` (`dateprop`) > file creation date `cdate`; does not fall back to “today”)
  - `until <YYYY-MM-DD>`
  - `count <n>`
- Raw RRULE strings are also accepted, e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR`.
- Occurrences are indexed as synthetic content-derived entries with `fromFrontmatter: true`.
- Recurring occurrences are shown only when parsed content dates are enabled (`showParsed === true` / `showContentDates === true`).
- Recurring occurrences are treated as “virtual”: they are excluded from disk serialization to avoid bloating the persisted index.
- Per-occurrence hide/show for recurring synthetic entries is supported by persisting a per-file list of hidden date keys (`recurHiddenDates`) in `epochgram-index.json`.

### Obsidian exclusions (Verified)
- Epochgram reads Obsidian ignore/exclusion filters and uses them to skip indexing and UI actions.
- Filter sources (see `plugin/exclusions.ts`):
  - `userIgnoreFilters`
  - `file.excludedFolders`
  - `file.excludedFiles`
- Matching behavior:
  - Patterns are compiled to regex; invalid patterns fall back to an escaped literal-regex.
  - Matching is attempted against both the full path and the leaf filename.
- File explorer actions are suppressed for excluded paths (see `plugin/view/file-menu.ts`). For non-excluded folders, Epochgram adds folder-level Review/Draft/Hide actions that operate on indexed descendant files.
- Exported HTML files named `epochgram-*.html` are indexed as non-text: they are searchable by filename/path only (export HTML content is ignored).

### Daily notes (Verified)
- Epochgram always reads `format` and `folder` from Obsidian core **Daily Notes** plugin settings (when enabled).
- For timeline-created daily notes, Epochgram also reads Daily Notes `template` (Template file location). If configured and the template exists, it creates the note from that template and resolves core placeholders (`{{title}}`, `{{date}}`, `{{time}}`, `{{yesterday}}`, `{{tomorrow}}`, including optional `:format`).
- If the Daily Notes plugin is disabled/unavailable, Epochgram falls back to `YYYY-MM-DD` and `/` (vault root).
- If the Daily Notes `format` contains `/` (e.g. `YYYY/MM/DD`), Epochgram treats it as nested folders under the Daily Notes `folder` and creates missing parent folders on demand.
- If the Daily Notes `format` includes time tokens, timeline creation uses the current local clock time for filename formatting while preserving the selected day.
- If no Daily Notes template is configured (or the template cannot be read), timeline-created daily notes fall back to frontmatter-only content using the configured YAML date key (`<date property>: YYYY-MM-DD`).
- Filename-derived dates (`namedate`) try parsing using the Daily Notes `format` first, then fall back to general parsing.
- The floating date overlay displays only the leaf segment when the Daily Notes `format` contains `/` (e.g. `YYYY/MM/YYYY-MM-DD` displays as `YYYY-MM-DD`).

Timeline date marker interactions (Verified)
- Single click/tap on a date marker opens the daily note **only if it exists** (no fallback).
- Double-click/double-tap on a date marker creates the daily note if missing (even if other records exist for that date), then opens it.

### Date-format rules (Verified)
- When Obsidian `moment` is available (normal plugin runtime), any *full-date* Moment format is accepted (including week/weekday/day-of-year/time tokens and literals/prefixes like `note_YYYY-MM-DD`).
- When parsing a filename, Epochgram extracts only the calendar date and normalizes it to the internal `YYYY-MM-DD` key (time components are ignored for indexing).
- Date parsing paths that accept raw date-like text normalize ISO-like timestamp inputs by using only the date prefix before `T` (e.g. `2020-08-21T10:30:00.123`, `2020-08-21T10:30:00.123Z`, `2020-08-21T10:30:00.123+03:00`, and compact forms like `20200821T103000+0300` all normalize to `2020-08-21`).
- Date-property (`dateprop`) and recurrence (`repeat`/`recur`) anchor extraction for indexing reads raw YAML frontmatter lines from current file content (instead of trusting metadata cache first), so frontmatter removal is reflected immediately and on full rebuild.
- In non-Obsidian environments (tests/Node), only `YYYY`/`YY` + `MM` + `DD` (+ literals) are supported.

## Per-file UI-facing state (Verified)
Per-file UI-facing state includes:
- Review state is stored per-record:
  - Per-entry `reviewState: "reviewed"` is persisted on the underlying stored entry; Draft is the implicit default when no `reviewState` is present.
  - Synthetic recurring occurrences are virtual; per-occurrence reviewed state is persisted as date keys in `recurReviewedDates`.
  - Meaningful file create/modify clears reviewed state carry-forward only for tracked-change entries on the same tracked change day bucket; non-tracked reviewed entries continue to carry forward when their entry identity still matches after reprocessing.
  - `draft` renders italic in the timeline summaries (unless `settings.simpleMode === true`).
- Hidden can be applied either:
  - Per-entry/per-day via an entry-level `reviewState: "hidden"` override; the Hide/Show action applies it to all entries from that note for the selected day.
    - For recurring synthetic occurrences, per-occurrence hidden overrides are persisted as date keys in `recurHiddenDates`.
- Pinned:
  - `pin:` / `pin: today` emit a synthetic pinned-today entry on Today when the anchor date differs from Today; that synthetic row stores `originalDate` set to the anchor date.
  - `pin: date` and `pin: dock` do not emit synthetic Today rows; they keep the note anchored on its real date and only affect date-label rendering.
  - When the local day changes while Epochgram remains open, synthetic pinned-today entries are refreshed so they move to the new Today date.
- Marked with a mark color index (see `ui/mark-colors.ts` and usage in `plugin/view.ts` and `indexer/indexer-class.ts`).
- Pin and mark UI actions update YAML frontmatter so the explicit override becomes the source of truth for the note.

## View Preferences (Verified)
Persisted (stored in `settings.timelineFilters`):
- `showAttachments` (controls visibility of non-Markdown files; all files other than `.md` are treated as attachments for timeline filtering)
- `showTrackedChanges`
- `showParsed: boolean`
  - `false`: hide parsed content-derived dates
  - `true`: show parsed content-derived dates

Session-only (not persisted):
- `showDraftsOnly: boolean`
  - `false`: show Draft + Reviewed (exclude Hidden)
  - `true`: show Draft only
- `showEpochsView` (epochs view toggle)

Epoch range focus (Verified)
- The timeline can hold a session-only epoch range focus (`focusedEpochRange`) after exiting epochs view (used to highlight/filter to an epoch’s date range).
- If `settings.generateEpochs === false`, Epochgram clears/disables this epoch range focus so the timeline is not stuck in an epoch-filtered state (even if existing epoch entries still exist in the index).

Epochs view gating (Verified)
- The epochs view toggle/filter is disabled when `settings.generateEpochs === false`, even if the index already contains epoch entries.

Epochs view + filters (Verified)
- In epochs view, the same filters apply when deciding whether an epoch entry is shown.
  - Review filter (`showDraftsOnly`): when enabled, epochs remain visible only if their date range contains at least one draft record.
  - `showTrackedChanges`, parsed-content filter (via `showParsed` / `showContentDates`), and `showAttachments`: an epoch remains visible as long as its date range contains at least one record that passes the current filter set.
  - Recurring occurrences are considered visible only when parsed content dates are enabled (`showContentDates === true`).
- In epochs view, when the timeline search includes actual search terms/phrases, an epoch can remain visible if it either:
  - has at least one child record in its date range that is visible under the current filter set (including the search query), or
  - the epoch entry itself matches the query via its epoch metadata (summary, bucket, AI summary, etc).
- In epochs view, timeline search does not match on the internal `epoch://...` filename (to avoid misleading matches for queries like "epoch").
- In epochs view, inherited epoch mark coloring also respects the active filters.
  - If an epoch’s inherited mark color would be derived only from records currently filtered out (e.g. tracked changes hidden), the epoch is not color-marked.

Timeline search tokens (Verified)
- `marked` token: matches either literal text "marked" OR entries that are color-marked (including via inherited marks).
- `!marked` token: behavior token that filters to marked entries (including inherited marks).
- `!hidden` token: behavior token that filters results to hidden entries only.
- `!similar` token: behavior token that restricts results to the active file and semantic-related files (when an active file is available).

Defaults (first load; verified in `plugin/lifecycle.ts`):
- Free: `showDraftsOnly = false`, `showAttachments = false`, `showTrackedChanges = false`, `showParsed = true`.
- Pro: `showDraftsOnly = false`, `showAttachments = false`, `showTrackedChanges = true`, `showParsed = true`.

## Settings (Partially Verified)
Settings interface starts in `settings.ts` (`export interface EpochSettings`). Verified fields include:
- `openEpochViewOnStartup: boolean` (default `true`)
- `enableAnimation: boolean` (default `true`; when `false`, disables UI animations and snaps transitions immediately)
- `searchResultsLimit: number` (default `7`; controls max record suggestions shown in timeline search modal)
- `anchorMdate: boolean` (default `true`; when enabled, cdate anchor uses file modified time instead of created time)
- `parseDatesInFrontmatter: boolean` (default `false`; controls whether YAML frontmatter contributes parsed/content date entries)
- `simpleMode: boolean` (default `false`; “Simple mode” toggle in General settings)
  - Intended scope: simplifies timeline UI only (see usages in `ui/epoch-view/*`, `ui/menus/*`, `ui/summary-rendering/*`, `ui/epoch-canvas-draw/*`).
  - Verified effects include:
    - Draft italics are suppressed in summary rows.
    - Some context-menu affordances are collapsed/hidden (e.g., mark palette submenu becomes a single toggle; review submenu becomes Show/Hide).
    - Epochs view toggle button is hidden and epochs view is forced off.
  - `whatsNewShownVersions?: string[]` (default `[]`; tracks which What's New versions were already auto-shown)
  - `whatsNewOptOut?: boolean` (default `false`; disables automatic What's New startup opening when true)

  What's New startup content (Verified)
  - Startup What's New pages are sourced from embedded markdown bundled into `main.js` via the build-time registry.
  - `whatsNewShownVersions` tracks per-version auto-display state.
  - If any newer version is already present in `whatsNewShownVersions`, older pages are not auto-shown later.
  - `whatsNewOptOut` is toggled directly from the What's New view checkbox and persisted in settings.

Pro startup validation (Verified)
- When Pro validation is attempted on startup and fails in a way that invalidates the activation (typically during plugin-update revalidation), Epochgram shows a one-time-per-session notice and keeps Pro locked until validation succeeds.


Daily notes source-of-truth (Verified)
- Epochgram always reads `folder`, `format`, and `template` from Obsidian core **Daily Notes** plugin settings (when enabled).
- If the Daily Notes plugin is disabled/unavailable, Epochgram falls back to `YYYY-MM-DD` and `/` (vault root).

Similarity settings (Partially Verified)
- Similarity behavior is controlled by settings in `settings.ts` (thresholds and per-signal toggles).
- Title matching uses Jaro–Winkler with a configurable threshold (Pro-only).
  - Special value: `similarityTitleJwThreshold = 1.0` switches title matching to same-folder matching (file name similarity is ignored).
- Advanced model overrides (Pro-only; Verified in settings + similarity config):
  - `settings.similarityEmbeddingModelId?: string` overrides the embeddings (semantics) model ID (default: `Xenova/all-MiniLM-L6-v2`).
  - `settings.similarityZeroShotModelId?: string` overrides the zero-shot (topics) model ID (default: `MoritzLaurer/deberta-v3-xsmall-zeroshot-v1.1-all-33`).
  - Selecting `(No model)` in the picker stores a sentinel value and fully disables that signal (semantics/topics), even if its threshold is > 0.
  - Canonical runtime gating helpers:
    - Embeddings: `embeddingsSimilarityEnabled(plugin)` (Pro access + threshold range + `(No model)` sentinel).
    - Topics: `isTopicSimilarityEnabled(plugin)` (Pro access + min-score range + `(No model)` sentinel).
  - Settings UI entrypoints:
    - Gear buttons next to the Semantics and Topics sliders open a SuggestModal picker to edit the model ID override.
      - The picker input is prefilled with the effective model ID (override if set; otherwise the default).
      - If the signal is set to `(No model)`, the picker input opens empty.
    - Search buttons next to those gears open Hugging Face model search pages filtered by task:
      - Semantics: `pipeline_tag=feature-extraction`
      - Topics: `pipeline_tag=zero-shot-classification`
      - Epochgram opens those search pages in the external browser (desktop and mobile).
  - When Pro is inactive, the Pro settings panel shows an “Unlock the full Epochgram Pro experience” row, then the Claim key row, then locked Pro settings blurred on a per-row basis; the “Get Pro” CTA opens `https://www.epochgram.com/pro` externally.
  - Pro activation uses a backend flow:
    - the user pastes a claim key once,
    - Epochgram sends the claim key plus `installId`, `devicePublicKey`, and plugin version to `POST /api/pro/activate`,
    - the backend returns a server-signed activation certificate whose claims include a positive `licenseGeneration`,
    - Epochgram stores that certificate as device-local state and uses `POST /api/pro/validate` only on activation-state repair or plugin-update revalidation.
    - After a successful activation, Epochgram stores only a short masked preview of the claim key for settings display (for example `EPO-ABCD-XXXX...`), not the full key.
    - If Pro is already active on the current device and the user tries to activate again from settings, Epochgram shows a confirmation modal before replacing/revalidating the current local activation.
  - Epochgram validates the activation certificate only when Pro is activated and when the installed plugin version changes.
    - Between versions, the device can keep working fully offline without periodic startup revalidation.
    - A cached activation unlocks Pro only when the stored certificate verifies locally for the current install, device public key, plugin version, and current generation floor.
    - During `/api/pro/validate`, the plugin sends a random challenge plus a device-key signature over the challenge, plugin ID, plugin version, install ID, and device public key.
    - The refreshed certificate returned by `/api/pro/validate` must contain `refreshChallenge` equal to that exact challenge; otherwise the plugin rejects it.
    - If the plugin updates and validation cannot reach the backend, cached Pro settings remain stored locally but Pro stays locked until that version validates successfully.
    - The plugin stores the highest accepted `licenseGeneration` locally as `activationGenerationFloor` and rejects any later certificate whose generation is lower.
  - While a similarity model is downloading/loading in the worker, Epochgram shows percentage progress in the desktop status bar.

Frontmatter similarity overrides (Verified)
- `nosimilar: <any>` disables similarity for the file (equivalent to `similar: []`).
- `similar: [links, tags, titles, semantics, topics]` restricts which similarity signals the file participates in (list items are optional; unknown items are ignored).
- Similarity is applied symmetrically: two files only match via signals that are allowed by **both** files (intersection).

Topics (Verified)
- Per-file explicit topics are stored as `embeddingTerm` in the index.
- Topic terms are treated as **literal strings**. Prefix characters like `!` and `#` have no special meaning.
- Zero-shot topic classification vocabulary is built from all explicit non-empty topic terms (see `plugin/similarity/topic.ts` `getTermVocabulary`).
- Topic picker `(No topic)` behavior is **non-sticky**: it clears the explicit topic term for the note (and removes any stored inferred term record) but does not permanently suppress future re-classification.
- Topic rename/removal behavior:
  - `renameTopicGroup(old, next)` renames the topic across explicit per-file topics, and (when Pro features are active) renames/removes matching inferred term-store records for the same topic.

Additional settings exist in `settings.ts` (e.g. similarity thresholds, epochs generation).
- Pointer: search `DEFAULT_SETTINGS` in `settings-model.ts` for the full set.

AI Bridge startup/open settings (Verified)
- `openAiBridgeOnStartup: boolean` (default `false`) controls whether the bridge page auto-opens on startup.
- `openAiBridgeInObsidianWebViewer: boolean` (default `false`) prefers opening the bridge in Obsidian Web viewer.
- Web viewer preference is applied regardless of backend mode.

Summary generation (Verified)
- Normal (non-AI) summaries use `summaryWordsCount` words from `indexer/summarizer.ts` (default: 5).
- When `summaryWordsCount` is set to `0`, normal (non-AI) word-based summarization is disabled; timeline entries fall back to the note title/filename instead of blank summaries.
- Timeline row summaries show the filename as a prefix, truncated to `settings.filenameWordsCount` words (default: 2; 0 disables; truncated names end with `...`).
- Summaries are sanitized to strip the Unicode replacement character (U+FFFD / "�"), which can appear due to decode errors or external summarizers.
- Summaries are flattened to remove most markdown structure and punctuation; if flattening results in an empty string, Epochgram falls back to the original (pre-flatten) summary text.
- Summary flattening treats word-like tokens using Unicode letters/numbers (not ASCII-only), so non-Latin tags/filenames (e.g., Cyrillic) are processed consistently.
- Normal (non-AI) summaries prefer a non-empty YAML frontmatter description property (default: `description`) as the summary source; otherwise they use the note’s stripped body text.
- If a note is effectively empty after stripping YAML frontmatter (e.g., frontmatter-only notes such as daily notes with just `<date property>: YYYY-MM-DD`), normal (non-AI) summaries fall back to the filename/title.
- Otherwise, if the note contains formatting markers (e.g. `==highlight==`, `**bold**`, `*italic*`, blockquotes, headers), the summary starts at the first such formatted segment and then truncates to `summaryWordsCount` words. When multiple headings exist, it prefers the first `#` heading; if none, the first `##`, then `###`, etc. When scanning for these markers, Epochgram ignores markers inside embeds/links, inline code, and raw URLs/URIs, and it avoids common false-positives like mid-word `*` (e.g. `foo*bar*baz`) and code-ish underscore tokens (e.g. `__init__`, `id=_abc_`).
- For non-markdown text files, summaries are generated from plain text (no markdown marker heuristics).
- Settings UI: slider-type settings can be reset to their defaults by double-clicking (or double-tapping) the setting label/description area (`.setting-item-info`).
- Timeline summary selection priority (Verified in `indexer/update-aggregated-entries.ts`):
  - If the file has a non-empty YAML frontmatter `description`, that description-derived summary wins.
  - Otherwise, if a valid stored AI summary exists, it is used **only** when Pro is active **and** AI summaries are allowed to be shown for that entry:
    - Auto summarize is ON (`summarizeAI === true`), or
    - the entry was explicitly marked as AI-summary-visible (`aiSummaryVisible === true`).
  - Otherwise, fall back to the normal (non-AI) summary.
- Editing summaries (Verified in `ui/menus/summary-menu.ts`): saves YAML frontmatter `description` for the file and clears stored AI summary fields for that file so the description becomes the visible summary source immediately.

AI summary context defaults (Verified)
- Built-in AI bridge defaults now live in `src/plugin/ai-bridge-page/settings/default-bridge-settings.yaml` and are validated/merged by `plugin/ai-bridge/sanitize.ts`.
- Bridge YAML supports optional `maxOutputWords` at root and per-job blocks (`reduce`, `records`, each `epochs` rule). Empty values are treated as unset; when set to a positive integer, bridge output is truncated to that exact maximum word count before submission.
- Default per-note/epoch bridge context treats the current job input as the primary source and uses the YAML placeholder rules (`{{filePath}}`, `{{fileName}}`, `{{related}}`) enforced by the bridge YAML validator.
- Stored epoch summaries are post-processed for indexing so:
  - each sentence becomes its own output line,
  - lines do not end with a trailing `.` (period), and
  - `;` acts as a line separator (without introducing blank/duplicate lines).
- AI prompt source redacts date/timestamp tokens from injected metadata (e.g. file paths) and from the related-context snippet, to reduce date leakage into summaries.
- The `{{related}}` block is optional background context only and should not override the current note when generating a summary.
- Related notes context is automatically suppressed for low-signal inputs (e.g., URL-only notes, or notes that are effectively just metadata/frontmatter).
- When included, related notes context is capped to reduce the chance it dominates output.
- Related notes context includes only likely-text files (attachments / likely-binary paths are excluded).
- Related notes context aggregates summaries across **all dates** for each related note (not just the current job’s day) and formats them as an indented grouped list:
  - `  - full/path/to/note.md:` group header + `    - fact` bullet lines
  - groups ordered by newest item in group; items within a group ordered newest-to-oldest

Frontmatter description precedence (Verified)
- If YAML frontmatter contains the configured description property (default: `description`), it is preferred as the summary base text (it wins over body-derived summary starts and AI summaries when present), including for `source: "tracked"` entries.
  - During re-aggregation, if cached file text is unavailable, anchor summaries still prefer that configured property via Obsidian’s metadata cache; other stored summaries are preserved when possible.

Filename date-range AI summary grouping (Verified)
- For filename date-range notes, the filename-derived date entries (the anchor day and all range-day “extra days”) share a single per-file AI summary job; one AI summary is generated and applied to all filename-anchored entries for that file.

Epoch (period) generation input (Verified)
- Epoch generation is controlled by Pro setting `settings.generateEpochs` (boolean):
  - `true` (enabled): uses summary text only, with priority: `aiSummary` (Pro) → normal `summary`.
    - If the most recent AI summary attempt for a record errors, epoch inputs temporarily fall back to the normal (non-AI) `summary` for that record (until a later successful AI summary clears the error state).
    - When epoch generation is enabled, Epochgram may enqueue internal per-note AI summary jobs (even if Auto summarize is off) so epoch inputs can use `aiSummary`.
      - When these per-note AI summary jobs are enqueued for epochs, they are queued newest-to-oldest.
    - These per-note AI summaries are persisted in the index (with `aiSummaryInputHash`) and are reused on subsequent epoch regenerations; forcing an epoch regeneration does **not** implicitly force-refresh the per-note summaries (they rerun only when the input hash changes).
    - Per-note AI summary job inputs use bridge-YAML tuning persisted in `settings.aiBridgeOptions`: `records.maxInputChars` (default `24000`), root `maxRelatedChars` (default `1500`), `reduce.maxChunkChars` (default `2500`), and `reduce.maxDepth` (default `4`). Oversized per-note groups are pre-chunked in the plugin and then flow through the same reduce pipeline used by epoch jobs.
    - When generating missing epochs with epoch generation enabled, Epochgram may queue per-note summaries first and then schedule the epoch cascade; it emits an immediate queued notice for this path.
  - `false` (disabled): epoch generation is disabled.
- Epoch AI job inputs are grouped by full note path:
  - Each group begins with a `full/path/note.md:` header.
  - Followed by bullet record lines.
  - Groups are separated by a blank line.
- If an anchor record (`cdate` / `namedate` / `dateprop`) is included for a given file in an epoch input, other record types for that same file are omitted (so the note appears once).
  - If multiple anchor types exist within the same period range for a file, epoch input prefers `dateprop` over `namedate` over `cdate`.
- Groups are ordered deterministically using an intent-weighted heuristic (pinned-in-period, mark presence, topic presence, inbound-link count, record count, then newest day as a tie-breaker).
- For additional coverage in larger periods, groups are emitted in a diversity-first round-robin across a computed group-key (topic → tag → directory → misc).
- Records within a group are newest-to-oldest.
- Duplicate formatted record lines are deduped within a file group.
- Rationale: improves traceability (especially for similarly-named notes) while keeping inputs deterministic and readable.
- Supported epoch buckets are: `day`, `2days`, `4days`, `week`, `2weeks`, `month`, `3months`, `6months`, `year`.
- Synthetic pinned-today entries (entries with `pinned: true` and an `originalDate` different from `date`) are excluded from epoch AI input.
- Recurring synthetic entries (virtual timeline entries emitted from frontmatter `repeat:` expansion, flagged with `recurring: true`) are excluded from epoch AI input.
- Epoch input ordering is deterministic given the same vault metadata (but is not strictly newest-first).
- Epoch generation includes **all** eligible input items for the epoch range (no “top N” truncation); attachments / non-text files are excluded.
- When epoch input is large, jobs are chunked on **line boundaries** and then reduced (summaries-of-summaries) instead of truncating/clipping the input text.
  - Initial chunk jobs are marked as reduce jobs with `reduceDepth: 0` so reduce-specific bridge settings/context are applied from the first chunk stage.
  - Reduce follow-ups are capped by bridge YAML `reduce.maxDepth` (default `4`) to bound queue fanout.
  - Epoch chunk sizing shares the same bridge YAML `reduce.maxChunkChars` value used by per-note reduce jobs.
  - Epoch jobs can now attach semantic-related note summaries in `job.related`; the same root `maxRelatedChars` cap applies to both per-note jobs and epoch jobs.
  - Any epoch bucket can respect a matching epoch-rule `maxFileChars` cap from bridge YAML when the selected `epochs[]` rule sets it (default built-in config sets `625` on the `3months-year` rule).
- Day epoch AI inputs are derived from both:
  - the aggregated index (`indexer.index` date keys/entries), and
  - the per-file extracted dates (`indexer.files` cdate/namedDate/dateProp/contentDates/trackedDates)
  This applies to both full regeneration (regen-all) and date-key-targeted rebuilds, and avoids “single branch” epoch cascades if the aggregated index is temporarily sparse.
- For non-`day` buckets, epoch inputs are built from the **underlying per-record items** within the parent range (not from other epoch summaries).
  - Rationale: avoids compounding “summaries of summaries” across buckets; large inputs are handled via chunk + reduce.
- Exception: for the `year` bucket only, if there are no eligible per-record items in the year range but there are child epoch summaries (e.g. `month`), the year input can fall back to using those child epoch summaries so the year can still generate.
- Full regeneration (`buildEpochJobs`) is able to *schedule* missing `year` buckets based on the presence of child epoch entries, even when there are no non-epoch records in that year range.
- Epoch “missing” detection treats epoch entries as present only when they are stored under their `epochStart` date key in the index.
- When epoch regeneration is scheduled as a cascade (e.g. after AI becomes idle), the cascade continues to higher buckets even if an intermediate bucket has no work to enqueue.
- When epoch regeneration is deferred because the AI bridge has queued/in-progress work, the regeneration is still scheduled to run after the bridge becomes idle; the queued-job count shown in notices is best-effort and does not gate scheduling.

AI bridge startup behavior (Verified)
- On desktop with Pro + AI enabled (`summarizeAI === true` or `generateEpochs === true`), Epochgram tries to start the local AI bridge server during plugin load.
- If `Platform.isMobile` (including mobile emulation) or Node is unavailable, AI bridge startup is skipped.
- During plugin hot reload/unload, the AI bridge server is stopped and then restarted on the next load; an already-open Chrome bridge page can typically reconnect by continuing to poll `/api/status`.
- If an existing bridge page is already open in Obsidian Web Viewer and startup auto-open is enabled, Epochgram activates that existing bridge leaf on startup.
- Chrome auto-open is controlled by `openAiBridgeOnStartup` (Pro + Desktop). When OFF, Epochgram never opens Chrome automatically (only the explicit command/status bar click can open the AI Bridge page).
  - Desktop shows a status bar entrypoint (with a hover hint) for opening the AI Bridge page only after the local bridge server has started.
    - Once shown, the status bar entrypoint is red when the bridge page is disconnected (not open / not connected).
  - Enabling `summarizeAI` or `generateEpochs` from settings starts the local AI bridge HTTP server immediately on desktop (without waiting for the first queued AI job).
  - When enabled: startup opens the bridge page immediately if no matching bridge leaf is already open.
  - When both `openAiBridgeOnStartup` and `openAiBridgeInObsidianWebViewer` are enabled, startup always prefers activating/opening the bridge inside Obsidian Web Viewer.
  - When disabled: Epochgram does not auto-open Chrome on startup (but still starts the server so an existing bridge tab can reconnect).
- When startup auto-open is enabled and Epochgram timeline auto-open is also enabled, startup activates the bridge leaf first and then activates the Epochgram view.
- When Epochgram auto-opens the bridge page, it includes `closeOnDisconnect=1` in the URL; the page will best-effort close itself if the bridge server disconnects.
- When the bridge page is not auto-opened (no `closeOnDisconnect=1`), the page stays open on disconnect and keeps retrying `/api/status` so it can recover when Obsidian restarts.
- When enabling `summarizeAI` (Auto summarize) or switching `generateEpochs` from `false` to `true` in settings, the “Generate missing …?” confirmation prompt is shown only if there is actually missing work to run.
  - The prompt count is the planned missing job count (a fast check may be used to avoid computing it when clearly zero); large periods can still chunk into multiple jobs and may schedule reduce jobs.
- Explicit user-triggered AI actions (commands, context menus, confirmation prompts) show queued notices even if a markdown editor is focused.
- When there is queued/in-progress AI work and no client is connected, Epochgram requires an explicit user action (command/status-bar click) to open the bridge page in Chrome.
- The bridge page delays auto-starting processing for ~3.5s and skips Summarizer detection during that startup grace period (to reduce Chrome crash risk if the tab is closed immediately).
- The bridge page does not perform language detection.
  - Bridge YAML language fields (`outputLanguage`, `expectedInputLanguages`, `expectedContextLanguages`) accept only `de`, `en`, `es`, `fr`, or `ja`.
  - Summary options:
    - `summaryOutputLanguage` is user-selectable (default `en`; supported: `de`, `en`, `es`, `fr`, `ja`) and is persisted in plugin settings via the bridge `/api/options` endpoint.
    - `summaryExpectedInputLanguages` is user-selectable (multi-select; supported: `de`, `en`, `es`, `fr`, `ja`).
    - `summaryExpectedContextLanguages` is user-selectable (multi-select; supported: `de`, `en`, `es`, `fr`, `ja`).
    - Summarizer `summaryType` and `summaryLength` are user-selectable (type: `tldr`, `teaser`, `key-points`, `headline`; length: `short`, `medium`, `long`; defaults: `headline` + `long`).
  - Epoch options:
    - `epochOutputLanguage` is user-selectable (default `en`; supported: `de`, `en`, `es`, `fr`, `ja`) and is persisted in plugin settings via the bridge `/api/options` endpoint.
    - `epochExpectedInputLanguages` is user-selectable (multi-select; supported: `de`, `en`, `es`, `fr`, `ja`).
    - `epochExpectedContextLanguages` is user-selectable (multi-select; supported: `de`, `en`, `es`, `fr`, `ja`).
    - Summarizer `epochType` and `epochLength` are user-selectable (type: `tldr`, `teaser`, `key-points`, `headline`; length: `short`, `medium`, `long`; defaults: `key-points` + `short`).
- The bridge page persists its options in localStorage under `epoch_ai_bridge_yaml_v1` and posts the same YAML to `/api/options`; plugin settings persist the sanitized state as `{ settingsYaml, settingsYamlFormatted, resolved }`.
- The bridge YAML surface includes root summarizer settings plus `reduce`, `records`, and `epochs[]` blocks.
  - `backend` is supported at root and inside `reduce`, `records`, and each `epochs[]` rule.
  - `backend.mode` supports `native` and `cloud`.
  - `cloud` provider supports `gemini` and `openai`.
  - `backend.maxRetries` is required and must be a positive integer (minimum `1`; default `3`), and applies to both `native` and `cloud` modes.
  - `backend.cloud.baseUrl` is required for `provider: openai` (default `https://api.openai.com/v1`) and can be changed to OpenAI-compatible local endpoints (for example LM Studio).
  - Secret placeholders in YAML are resolved via Obsidian Secret Storage with lowercase-dash IDs (`a-z`, `0-9`, `-`), for example `{{your-openai-api-key}}`.
  - Runtime inheritance is root -> per-job block, where per-job `backend` overrides root `backend`.
  - If `backend` is omitted, behavior remains native browser Summarizer.
  - Numeric tuning fields now include root `maxRelatedChars`, `records.maxInputChars`, `reduce.maxDepth`, `reduce.maxChunkChars`, and `epochs[].maxFileChars`.
- Reduce jobs use the `reduce` block.
- Per-note jobs use the `records` block.
- Epoch jobs use the first matching `epochs[]` rule for their bucket; epoch reduce stages still use the `reduce` block.
- The bridge page supports context-template placeholders (substituted before sending `context` to Chrome Summarizer).
  - Summary jobs: `{{filePath}}`, `{{fileName}}`, `{{related}}`.
  - Epoch jobs (including reduce stages): `{{related}}`.
- Context placeholders support double-brace syntax only (for example `{{filePath}}`); single-brace placeholders like `{filePath}` are rejected by YAML validation.
- Legacy placeholders `{{context}}` and `{{jobContext}}` are not supported.
- `{{bucket}}` is not supported and is rejected by YAML validation.
- `sharedContext` is passed to `Summarizer.create(...)`, while per-job `context` is passed to `summarize(..., { context })`.
- “Reset to defaults” restores the built-in bridge YAML from `src/plugin/ai-bridge-page/settings/default-bridge-settings.yaml`.
- When processing completes and the queue becomes idle, the bridge page keeps the last “Current text preview” content (it does not auto-clear on idle).
- On bridge page close, the page sends a best-effort disconnect request (`POST /api/bye`, via `fetch(..., { keepalive: true })`) so the server immediately reports `clientConnected: false` (avoids waiting for the ~15s `clientConnected` timeout).
- The bridge page clears the queue via a single canonical API call (`POST /api/clearQueue`).
  - Clearing the queue also cancels deferred/planned follow-up work (e.g., epoch regeneration scheduled to run “after AI is idle”, and any per-file throttled enqueues waiting on a cooldown timer).
- The bridge server’s `/api/status` payload can include optional epoch progress fields (`epochTotal`, `epochProcessed`, `epochRemaining`) and optional epoch token fields (`epochTotalTokens`, `epochProcessedTokens`, `epochRemainingTokens`, `epochQueuedTokens`, `epochInProgressTokens`) so the bridge page can show remaining epoch jobs/tokens across cascaded bucket hierarchies (not just the currently queued bucket).
- The server’s `clientConnected` status is driven by browser bridge activity (e.g. `GET /api/status`, `GET /api/nextJob`, `POST /api/submitResult`), not by plugin maintenance calls like `POST /api/clearQueue`.
- When there is queued/in-progress work, the plugin’s “open bridge” flow uses a short re-open throttle (~1.5s) so closing and immediately re-running generation can re-open Chrome quickly.

License/Pro transition support (Verified)
- `proActivatedOnce?: boolean` applies one-time defaults on first Pro activation.
- Pro-only synced settings are no longer rewritten when a device loses Pro access.
  - Instead, unlicensed devices keep the stored synced values and apply runtime-only gating for Pro behavior.
  - Timeline/view preferences are still forced to a non-Pro state locally while Pro is inactive, so the UI behaves as disabled until re-activation.
- Pro verification persistence is split:
  - the raw pasted claim key is used only for the immediate activation request and is not persisted.
  - a masked claim-key preview is persisted only in device-local storage for settings display; it is never written to synced plugin data.
  - device-local storage keeps only the local Pro state needed across restarts/devices: `claimKeyPreview?: string`, `installId?: string`, `devicePublicKey?: string`, `activationEnvelope?: SignedEntitlementEnvelope`, `activationWitness?: ActivationWitness`, `activationGenerationFloor?: number`, `activationStatus?: string`, `lastValidationAt?: string`, `lastValidatedAt?: string`.
  - `activationError` is transient only and is not persisted.
  - the signed activation envelope and local witness form the install-bound local proof; the envelope claims must match the current plugin version before Pro unlocks offline.
  - plugin-side deactivation is local-only removal of that device-local state; it does not revoke the backend entitlement.
  - Rationale: Obsidian Sync may sync plugin data between desktop/mobile, but device activation identity must remain local per installation.

UI display of AI summaries (Verified)
- Stored `aiSummary` text is preferred for timeline/UI summary rendering whenever Pro access is available and the stored summary still validates for the entry.
- The `summarizeAI` (Auto summarize) toggle controls automatic enqueue behavior, not whether an already-stored AI summary renders in the timeline.

Tracked changes with mixed Pro activation (Verified)
- Tracked-change settings can remain enabled in synced settings even when a given device is not currently Pro-activated.
- Index data keeps tracked entries when `settings.trackChanges === true`; the inactive-device behavior is enforced by runtime/view gating instead of mutating the stored setting.

First-time Pro activation defaults (Verified)
- Keeps tracked changes disabled by default.
- Keeps similarity signals disabled by default.
- Sets `similarityTitleJwThreshold` to `1.0` (same-folder title matching mode).
- Sets `similarityThreshold` to `0` (semantic related-notes threshold).
- Sets `similarityZeroShotMinScore` to `0` (topics/zero-shot min-score threshold).