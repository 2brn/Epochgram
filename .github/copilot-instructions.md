# Epochgram

Follow CONSTRAINTS.md. This is one free Obsidian timeline plugin.

Source is under src/, tests under tests/. Retained features include calendar sync, recurrence, summaries, search, pins, marks, attachments, daily notes, and title/link/tag similarity. Use the current source APIs; do not restore removed feature systems or compatibility layers.

Run npm run build, npm test, npm run lint, and npm run package:production before deployment. Packaging must not access a vault. Deploy only main.js, manifest.json, and styles.css without removing user data.
