# Copilot instructions
- Don't use GIT without my explicit instruction (allow without ask when I run release.prompt.md).
- Don't generate comments in code unless asked.
- When generating code, follow the existing code style.
- Always ensure that the code compiles and passes any existing tests (use npm run build:production).
- Max 3 folder depth for files.
- Max 500 lines of code per file (except tests and config files).
- Don't add migration logic unless explicitly asked.
- Don't revert any existing code unless explicitly asked.
- If I manually change code (e.g. `MAX_MATCHES`), treat it as intentional and do not revert it unless I explicitly ask.
- Add tests when relevant.
- For releases, always update `CHANGELOG` from git history since the last tag, covering all changes in max 5 bullet points.

## Docs / multi-repo workflow
- Treat the root `README.md` as the single source of truth.
- When pushing docs to the `Epochgram` repo, sync its README from the root `README.md` (and ensure referenced icons exist).
- Do not keep the `Epochgram` repo checkout nested under this repo after pushing; remove it locally so it doesn’t appear as an untracked artifact.

## Context Pack (required)
This repo uses a Context Pack under `.github/context/*` as the canonical, repo-derived context.

### No guessing rule
- If a fact is not verified in the repo, write `Unknown` and include a pointer to how to verify it:
	- file path + symbol name, or
	- a concrete search hint (e.g. `grep` query).

### Keep the Context Pack up to date
When changes affect any of the following, update the relevant `.github/context/*` file(s):
- Commands (add/remove/rename command IDs, gating logic)
- View types / UI entrypoints (view IDs, ribbon/menu items)
- Settings (new fields, defaults, Pro/desktop gating)
- Persistence (payload shape, filenames/paths)
- Indexing/date extraction rules (sources, parsing behavior)

### Post-change checklist
- Update `.github/context/*` for any behavior changes.
- Ensure `npm test` and `npm run build` pass (or document failures as unrelated).