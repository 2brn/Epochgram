# Epochgram architecture

Epochgram is one free Obsidian timeline plugin. README.md documents the current user interface; CONSTRAINTS.md defines scope and data safety.

- `src/main.ts`: plugin state and method composition.
- `src/indexer/`: date extraction, anchors, ordinary summaries, recurrence, pins, review states, and index serialization.
- `src/plugin/`: lifecycle, file events, settings, persistence, calendar sync, search, and commands.
- `src/plugin/similarity/`: direct links, shared tags, title matching, and per-file signal masks.
- `src/ui/`: calendar/timeline canvas, normal and dense records, search, menus, mark inheritance, and navigation.
- `src/search/`: local MiniSearch index.
- `tests/`: mocked Obsidian unit/regression tests.

Current stores are `index.json` and `search.json` within the plugin directory. The index also owns Draft/Reviewed/Hidden decisions and last-mutation timestamps, including per-occurrence review states. Sync merges compatible records by timestamp; content edits reset Reviewed anchors to Draft, while Hidden stays hidden. Rebuilds preserve decisions; the explicit Reviews reset returns Reviewed and Hidden records (including recurring occurrences) to Draft. Drafts-only is session state; `$hidden`/`!hidden` selects hidden records. Settings use `data.json`; `src/settings-schema.ts` allowlists current fields on load/save. Index serialization projects current fields and sources; incompatible search-cache schemas are rejected and rebuilt. No migration or cleanup of older sidecars is performed. Explicit file actions write notes; configured calendar sync creates/updates event notes.

Validate with `npm test`, `npm run lint`, and `npm run package:production` (includes typecheck/build). Packaging is local only. Deploy only `main.js`, `manifest.json`, and `styles.css`, preserving all other vault files.
