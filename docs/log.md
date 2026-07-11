# Update Log

## 2026-07-11
* **Version**: `1.0.1`
* **New**: Encrypted Secret Manager dashboard widget — create, group, search, unlock, copy, and update `.encrypted` values with searchable descriptions and visible metadata (`features/dashboard.md`, `architecture/encryption.md`).
* **Update**: Encrypted files can carry optional unencrypted `description` and `publicMetadata`; workflow encryption/read nodes can write and return this metadata (`architecture/encryption.md`, `workflows/workflow_nodes.md`).
* **Update**: Kanban cards support configurable display fields and a temporary tag filter (`features/dashboard.md`).
* **i18n**: Localized the core widget palette and corrected Secret Manager search/security guidance in English and Japanese.
* **New**: Managed GemiHub OKF updates — selecting the GemiHub bundle checks a Cloud Storage `manifest.json`, prompts for confirmation, verifies ZIP and per-file SHA-256 values, then stages the update for Push (`references/OKF.md`, `architecture/infrastructure.md`).
* **Fix**: The bundle root `index.md` now carries `title: GemiHub` frontmatter, and the managed-update identity check also matches display names containing "gemihub" (case-insensitive) — legacy installs whose `index.md` predates the frontmatter no longer get permanently stuck unable to discover updates (`references/OKF.md`).

## 2026-07-09
* **New**: `.kanban` board definition files — kanban boards are now always defined by a YAML file (widget config is just `{ kanban, cardOrder }`); the config editor creates/imports the file and edits it directly, and legacy inline configs are force-converted when their settings open. `.kanban` is text/yaml everywhere (`features/dashboard.md`).
* **New**: Dedicated `.kanban` file editor with Display / Edit / Raw modes (live board / definition form side panel / YAML source), mirroring the `.base` editor (`features/dashboard.md`).
* **New**: Open button in the widget cell chrome for file-backed widgets (file/markdown, workflow, base, kanban via `WidgetDef.filePathOf`) (`features/dashboard.md`).
* **Update**: The shared file modal (`FilePreviewModal`) now embeds the full Markdown editor (preview/wysiwyg/raw, local-first saves); kanban's New Card opens this modal instead of navigating (`features/dashboard.md`).
* **Update**: Push/Pull confirmation dialog groups changed files sharing an ancestor folder into collapsible rows (`features/sync.md`).
* **Docs**: Corrected the legacy folder-widget conversion description — it is a settings-panel button, not an automatic on-load conversion (`features/dashboard.md`).

## 2026-07-08
* **Update**: Removed the dashboard's separate edit mode — drag/resize/settings/delete are now always available via hover-revealed cell chrome (`features/dashboard.md`).
* **New**: Per-widget maximize/restore button in the cell chrome, ported from obsidian-gemini-helper (`features/dashboard.md`).
* **Fix**: Hubwork/Firestore is now gated on credential availability — self-hosted/dev environments without Google Cloud ADC no longer crash the server when an unmatched URL hits the hubwork catch-all route (`architecture/premium.md`).

## 2026-07-04
* **Update**: OKF bundle selection moved from the RAG settings tab to a per-chat selector above the chat input; settings now only configure the OKF parent folder (`references/OKF.md`, `integrations/rag.md`).
* **Cleanup**: Removed the `create_okf.md` authoring guide (only used for the initial conversion) and the Japanese mirror docs (`*_ja.md`).
* **Fix**: Repaired relative links broken by the directory move (`rag.md`, `skill.md`, `utils.md`, `premium.md`, `dashboard.md`).
* **Update**: Replaced placeholder frontmatter descriptions with informative one-sentence summaries and synced all `index.md` entries.

## 2026-07-03
* **Reorganization**: Grouped files into logical OKF subdirectories (`features`, `integrations`, `workflows`, `architecture`, `references`).
* **Update**: Restructured `index.md` files without frontmatter to comply with `create_okf.md` guidelines.
