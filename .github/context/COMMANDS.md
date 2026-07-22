# Commands

Commands are registered in `plugin/lifecycle.ts` (export command via `plugin/export-epochs-command.ts`).

## Core

- `open-view` — “Open timeline“
  - Always available.
  - Calls `openEpochView()`.
  - Snap priority when opening/revealing the timeline: open Markdown file (if any) → Today.

- `export-epochs` — “Export Epochs“
  - Pro only.
  - Only available when epoch entries exist in the index.
  - Writes `epochgram-<daily note date>.html` into the configured Daily Notes folder.
  - Exported `epochgram-*.html` files are indexed as non-text: searchable by filename/path only (export HTML content is ignored).
  - Exported `epochgram-*.html` files are treated as non-text for AI summaries / epochs workflows (they are never summarized).
  - Export runtime is embedded in `main.js` (does not rely on extra downloaded plugin assets).
  - If the Daily Notes date value contains path separators (e.g. from `/` literals), they are replaced with `-` in the export filename.
  - The exported HTML includes an explicit, editable theme block (`epoch-export-theme`) with Obsidian-style CSS variables (including captured `--color-*-rgb` mark colors when available) and an embedded minified JSON payload (`epoch-export-data`) in the document head.
  - The export captures the currently active Epoch view's filters (search query + toggles) and renders the export using those same filters.

- `search-timeline` — “Search timeline“
  - Always available.
  - Opens/reveals Epochgram and opens the session-only timeline search popup.
  - When the search input is empty, suggestions prefer recently opened files (when available).

- `open-ai-bridge` — “Open AI bridge“
  - Pro + Desktop.
  - Opens the local AI bridge page used by AI summaries/epochs workflows.
  - If run on mobile, shows a notice that the AI bridge is desktop-only.

- `summarize-all` — “Summarize missing”
  - Pro + Desktop.
  - If `summarizeAI` (Auto summarize) is enabled, enqueues missing AI summaries for all records (timeline-visible).
  - If `generateEpochs === true`:
    - When epoch generation is enabled, Epochgram may enqueue *internal-only* AI summaries as needed so epoch inputs can use AI summaries even when Auto summarize is OFF.
      - Epoch generation is then scheduled to run after the AI queue becomes idle.

- `summarize-current` — “Summarize current file”
  - Pro + Desktop.
  - Available when the active file exists, is indexable, and is known by the index.
  - Enqueues summary jobs for all records from the active file (`force: true`).

- `review-all` — “Review all”
  - Always available.
  - Marks all non-hidden records as Reviewed across all indexed files and index-only records present in date buckets.
  - Also marks recurring synthetic occurrences from affected files as Reviewed (preserving recurring hidden overrides).
  - Does not unhide hidden records.

Maintenance rebuild/reset flows are available in Settings → Indexer (`Index`).
- Reset does not include dedicated Marks/Pinned options; Topics reset clears both classified topic data and explicit per-file topic terms (index/store only) and does not modify note frontmatter.

## Current File Toggles
These operate on the active file and are only available when a file is active, index-ready, and the file is indexable/known.
- `toggle-mark-current-note` — “Toggle mark for current file”
  - Toggles the effective mark for the active context:
    - If the active file is explicitly marked, it clears that mark.
    - If the active file is only inherited-marked (i.e. colored via some other seed), clearing targets the resolved ancestor seed (so the whole inherited group clears).
    - If the active file is unmarked, it marks the active file as an explicit seed.
  - When marking, it picks a default mark color that avoids clashes with other marked notes when possible.
  - After a change, inherited marks are recomputed so similar/related notes update immediately.
- `toggle-pin-current-note` — “Toggle pin for current file”
  - If the active file is not pinned, it writes `pin: today`.
  - If the active file already has any explicit `pin:` mode (`today`, `date`, or `dock`), it removes the `pin:` property.

- `toggle-visibility-current-file` — “Toggle visibility for current file”
  - Toggles file-wide hidden state.
  - If the file is currently visible, it hides all records from the file.
  - If the file is currently hidden, it unhides the file (review state is unchanged).
  - Recurring synthetic occurrences for that file follow the same hide/show transition.

- File tree context menu (`file-menu`) actions:
  - Folder actions (`Epochgram: Review`, `Epochgram: Draft`, `Epochgram: Hide`) apply to all known files in the folder.
  - File actions (`Epochgram: Review`, `Epochgram: Draft`, `Epochgram: Hide`) apply to the selected file.
  - Review/Draft/Hide in file/folder menus also updates recurring synthetic occurrences for those files.

## Current File Actions
These operate on the active file and are only available when a file is active, index-ready, and the file is indexable/known.
- `summarize-current` — “Summarize current file” (Pro + Desktop)
  - Queues summary jobs for all records from the active file.
- `clear-tracked-changes-current-note` — “Clear tracked changes for current file” (Pro only)
  - Clears tracked entries for the active file and prunes `source: "tracked"` date entries for that file from the aggregated index.
