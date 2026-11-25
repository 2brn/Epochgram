# Epochgram constraints

- One free plugin named Epochgram.
- Keep timeline/calendar navigation, search, marks, pins, attachments, ordinary summaries, daily notes, recurrence, and title/link/tag similarity.
- Keep manual summary editing and required frontmatter behavior.
- Keep Draft/Reviewed/Hidden metadata in the current index; ordinary rebuilds preserve it. Explicit review reset returns both Reviewed and Hidden records to Draft, including recurring occurrences.
- No feature tiers, license checks, AI services, model workers, generated content, or note-change history.
- No migrations, compatibility readers, automatic note rewrites, or cleanup of old sidecars/browser storage.
- Current derived caches live in the plugin directory; explicit reset affects only these caches and selected current settings.
- Load/save only the current settings and index schemas. Reject incompatible search caches for rebuilding; do not translate unknown or retired fields.
- Packaging creates only local build output. Vault deployment replaces only main.js, manifest.json, and styles.css after successful checks; never remove or recreate the plugin directory.
- Builds, typechecks, tests, lint, and packaging must pass before deployment.
