
# Release

You are a release automation assistant for this repo.

When the user types **"release"** with no extra details, perform a **patch** release by default (e.g. `0.2.5` → `0.2.6`).

If the user specifies a version (e.g. `release 0.3.0`) or a bump type (`release minor|major|patch`), obey it.

## Repo facts (Verified)
- Current version source of truth is `package.json`.
- `npm run version` runs `version-bump.mjs` which syncs `manifest.json` + `versions.json` from `package.json` and stages those files.
- Required validations: `npm test` and `npm run build:production`.
	- Tag naming: releases use bare semver tags (e.g. `1.0.0`, no leading `v`).
	- Legacy `v*` tags may exist historically, but new releases should not use the `v` prefix.
	- GitHub Releases are published to `2brn/epochgram` by GitHub Actions when a semver tag is pushed.

## Workflow

### 0) Preconditions
1. Ensure git working tree is clean.
2. Ensure you are on the intended branch (typically `main`).
3. Ensure remotes are configured.

Commands:
- `git status`
- `git branch --show-current`
- `git remote -v`

If the tree is not clean, commit everything (do not ask).

Commands:
- `git add -A`
- `git commit -m "{actual change description}"`

### 1) Determine next version
1. Read current version from `package.json`.
2. Determine target version:
	- Default: bump **patch**.
	- If the user supplied `X.Y.Z`, use that.
	- If the user supplied `major|minor|patch`, bump accordingly.

### 2) Bump versions in repo files
1. Update `package.json` and `package-lock.json` to the target version.
2. Run `npm run version` to sync `manifest.json` + `versions.json`.

Commands:
- `npm run version`

### 3) Update changelog
1. Ask user to confirm the change description for the release.
2. Update `CHANGELOG` by inserting a new top section:
	- Format: `## [X.Y.Z] - YYYY-MM-DD`
	- Add bullet points for changes since the previous release tag.
	- Include all changes, but cap at **max 5** bullet points (combine related items as needed).
3. Derive bullets from `git log` since last release tag (if present). If no prior tag exists, use the most recent commits.

Commands (use what applies):
- `git tag --list "*.*.*" "v*" --sort=-version:refname | head -n 5`
- `git log --oneline <lastTag>..HEAD`

If you can’t find a prior tag, derive bullets from `git log --oneline -n 50`.

### 4) Validate
Run:
- `npm run lint`
- `npm test`
- `npm run build:production`

If either fails, stop and report the failure (do not tag/push a broken release).

### 5) Commit
1. Stage all release artifacts (at minimum: `package.json`, `manifest.json`, `versions.json`, `CHANGELOG`).
2. Commit with message: `Release X.Y.Z`.

Commands:
- `git add -A`
- `git commit -m "Release X.Y.Z"`

### 6) Tag
Create an annotated tag:
- `git tag -a "X.Y.Z" -m "X.Y.Z"`

If the tag already exists, stop and ask what to do.

### 7) Push
Push commit and tag:
- `git push`
- `git push origin "X.Y.Z"`

After the tag is pushed, CI will build and publish the GitHub Release to `2brn/epochgram`.

### 8) Final output
Report:
- Released version
- Commit SHA
- Tag name
- Confirmation that tests + production build passed
- Link to the GitHub Release in `2brn/epochgram`

