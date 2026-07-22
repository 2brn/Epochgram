# Whats New

Generate a compact What's New page for Epochgram using repository changes since the last release tag.

Use the current file `src/whats-new/<current-version>.md` as the structure/style template for the output shape in this repo.

## Required source data

1. Read current version from `package.json` (`version`).
2. Find the latest previous release tag (prefer bare semver tags, fallback to `v*` if needed).
3. Collect user-facing changes from git history in range `<lastTag>..HEAD`.
4. If there is no previous tag, use recent commit history (`git log --oneline -n 100`).

Use commands (adapt as needed):
- `git tag --list "*.*.*" "v*" --sort=-version:refname`
- `git log --name-only --oneline <lastTag>..HEAD`
- `git log --oneline <lastTag>..HEAD`
- `git diff --name-only <lastTag>..HEAD`
- `git show --name-only --oneline <commit>` (when details are needed)
- `git show <lastTag>:<path>` (to verify whether a behavior already existed before this release)

## Goal

Produce a concise What's New page readable in under 30 seconds.
This is not a changelog; include only changes users will notice immediately.

## Rules

- Do not include a page title.
- Do not include the plugin version line; version is added elsewhere.
- Start with one short release summary sentence.
- Immediately follow with a hero image.
- Include 2-4 major user-facing features.
- Use at most 2 images total.
- Hero image is mandatory.
- Add a second image only if it significantly improves understanding.
- Each feature must include:
  - `##` heading
  - one or two short sentences (max ~30 words)
- End with `## Other improvements` containing short bullet points only.
- Do not duplicate topics across features; each `##` section must cover a distinct user-facing change.
- Focus on visible user benefits.
- Do not include implementation details, refactors, internal architecture, APIs, or developer-only changes unless directly user-visible.
- Do not use emojis.
- Do not use marketing language, filler, or hype.
- Do not generate a footer.
- Keep output compact and tight.
- Include only changes introduced after `<lastTag>`.
- Do not mention behavior that already existed in `<lastTag>`, even if related files were touched again.
- Verify every user-facing statement against current code (HEAD) and changed files in `<lastTag>..HEAD`.

## Output template

Use this exact structure:

```md
> One short sentence summarizing the release.

![hero](images/<version>/hero.webp)

---

## Feature name

One or two short sentences explaining what changed and why it matters.

---

## Feature name

One or two short sentences explaining what changed and why it matters.

<!-- Optional second image -->
![feature](images/<version>/feature.webp)

---

## Other improvements

- Bug fixes
- Performance improvements
- Small UI improvements
```

Replace `<version>` with the current `package.json` version.

## Prioritization

When selecting features, prioritize:
1. New functionality.
2. Workflow improvements.
3. UI/UX improvements.
4. Performance improvements.
5. Bug fixes.

If there are many changes, summarize them instead of listing everything.

## Validation checklist before writing

1. Every feature maps to at least one changed file in `<lastTag>..HEAD`.
2. No feature duplicates another topic.
3. No feature describes behavior already present in `<lastTag>`.
4. Claims are user-visible and verifiable from code.

## Repo-specific output target

After generating the markdown body, update:
- `src/whats-new/<current-version>.md`

If the file already exists, replace only its content body while preserving compact formatting.
