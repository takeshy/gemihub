# Update Log

## 2026-07-11
* **Version**: `1.0.1`
* **New**: Encrypted Secret Manager dashboard widget — create, group, search, unlock, copy, and update `.encrypted` values with searchable descriptions and visible metadata (`features/dashboard.md`, `architecture/encryption.md`).
* **Update**: Encrypted files can carry optional unencrypted `description` and `publicMetadata`; workflow encryption/read nodes can write and return this metadata (`architecture/encryption.md`, `workflows/workflow_nodes.md`).
* **Update**: Kanban cards support configurable display fields and a temporary tag filter (`features/dashboard.md`).
* **i18n**: Localized the core widget palette and corrected Secret Manager search/security guidance in English and Japanese.
* **New**: Managed GemiHub OKF updates — selecting the GemiHub bundle checks a Cloud Storage `manifest.json`, prompts for confirmation, verifies ZIP and per-file SHA-256 values, then stages the update for Push (`references/OKF.md`, `architecture/infrastructure.md`).
* **Fix**: The bundle root `index.md` now carries `title: GemiHub` frontmatter, and the managed-update identity check also matches display names containing "gemihub" (case-insensitive) — legacy installs whose `index.md` predates the frontmatter no longer get permanently stuck unable to discover updates (`references/OKF.md`).
* **Update**: Secret Manager widget lists directories before files (both alphabetically, at every level), supports dragging a secret onto a directory row (or empty space, to move it to the root) to move it up to 2 directory levels deep, and adds a delete action per secret (`features/dashboard.md`).
* **Update**: Secret Manager list rows show the modified time instead of the full path, and the detail modal has an open-file icon that navigates to the underlying `.encrypted` file (`features/dashboard.md`).
* **Update**: The chat empty state (before the first message) now shows an "Ask about GemiHub" section (enables the installed GemiHub OKF help bundle and drafts a starter question without sending it) and a "Dashboards" section ("Open Dashboard" / "New Dashboard"), on both the free-plan hint screen and the paid-plan "Build a Web App" screen (`features/chat.md`).
* **Fix**: A dashboard created right after another dashboard was still migrating from a local `new:` id to Drive could appear twice — `DashboardHost` now listens for `file-id-migrated` to keep its open dashboard's fileId current and refresh the dashboard list, instead of requiring a page reload (`features/dashboard.md`).
* **Update**: Secret Manager's edit form has a Directory field (pre-filled with the secret's current directory); changing it moves the secret to that directory on save, creating it implicitly since directories are just derived from the path (`features/dashboard.md`).
* **Fix**: `createNewDashboard`/`renameDashboard` now also dispatch `tree-meta-updated` — previously only `file-modified` fired, which updates the sidebar's "modified" badges but not its file list, so a newly created or renamed dashboard didn't appear in the left file tree until an unrelated refresh or reload. The chat panel's "New Dashboard" button also now guards against a second click firing a duplicate create while the first is still in flight (`features/dashboard.md`).
* **Fix**: `writeFileLocal` no longer resurrects an orphaned cache entry when an edit targets a `new:` placeholder id that background migration already swapped to a real Drive id — it now resolves the current id by name first. The orphan (a raw cache entry with no `CachedRemoteMeta` record) was invisible until the next migration pass, which would re-upload it as a genuine second Drive file with the same name; this is why editing a file (e.g. a dashboard, right after adding a widget) moments after creating it could produce two files, one reflecting the state at creation and one reflecting the edit (`features/sync.md` — "New-File Migration").

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
