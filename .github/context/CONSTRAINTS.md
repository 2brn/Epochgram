# Constraints

## Repository / Agent Rules (Source of Truth)
These come from `.github/copilot-instructions.md` and should be treated as hard constraints:
- Don’t generate code comments unless asked.
- Follow the existing code style.
- Max 3 folder depth for files.
- Max 500 lines of code per file.
- Ensure code compiles and tests pass.

## Context Pack Maintenance Rules
- This Context Pack (`.github/context/*`) replaces the older `.github/epoch-context.md`.
- Do not guess:
  - If something is not verified in the repo, write `Unknown` and include a pointer:
    - a file path + symbol name, or
    - a `grep`-style search hint.
- Prefer citing concrete IDs/strings (command IDs, view types, filenames) directly from source.

## Refactor Convention (Verified)
When splitting large `*.ts` files, keep the original file as a stable entrypoint and move extracted logic into a same-stem folder (pattern used throughout the repo).

## Release Packaging Constraint (Verified)
- Distribution output includes: `main.js`, `manifest.json`, `styles.css` (optional), `README.md`, `versions.json`, `LICENSE`.
- Production packaging (`scripts/prepare-production.js`) copies those files into `production/epochgram/` and updates files in-place without clearing the folder.
- Production packaging ensures `.hotreload` exists in `production/epochgram/` (created when missing).
- README image assets are also packaged at `images/*`.
- Optional local deploy: `scripts/prepare-production.js --deploy-vault` also copies to Obsidian vault plugin folder(s) (auto-detected), e.g. `AKUPARA/.obsidian/plugins/epochgram`.
  - Auto-detection checks only `Docs/Obsidian/AKUPARA/.obsidian/plugins` across Windows drive letters `C:`–`Z:`.
  - Override path with `EPOCHGRAM_OBSIDIAN_PLUGINS_DIR` or `--vault-plugins <path>`.
  - Deploy preserves an existing `data.json` in the target plugin folder.
- Similarity / ONNX Runtime WASM:
  - To avoid large bundles (and Obsidian Mobile crashes), Epochgram does **not** inline ONNX Runtime `.wasm` binaries into `main.js`.
  - ORT WASM is loaded from the network at runtime (jsDelivr) based on `plugin/similarity-embed.worker/wasm.ts:ONNX_RUNTIME_WEB_VERSION`.

## Network / Dynamic Loading Constraint (Verified)
- Similarity workers block `http:`/`https:` fetches at runtime (see `plugin/similarity-embed.worker/runtime.ts:installNetworkFetchGuard`).
