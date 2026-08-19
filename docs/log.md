# Update Log

## 2026-08-19
* **Update**: The built-in `markdown` / `canvas` / `base` / `dashboard` skills are embedded in the app bundle instead of being provisioned into `skills/` on Drive — they no longer appear in the file tree or sync, and their instructions are inlined into the system prompt (`integrations/skill.md`).
* **Update**: Organization membership is granted directly from Settings > Organization (immediate add + notification email) instead of a token invitation, and members always authenticate with Google — the sign-in now requests the Gmail/Calendar scopes up front so invitation mail works without a second consent round.
* **Update**: Dashboard, Workflow, and RAG became opt-in "advanced features" — all three default to off (`dashboardEnabled` / `workflowEnabled` / `ragFeatureEnabled` in Settings > General), and the IDE home view shows a Getting Started guide while the dashboard is off. YAML files still open in the plain text editor when Workflow is off (`features/dashboard.md`, `workflows/workflow_execution.md`, `integrations/rag.md`).
* **Fix**: Organization membership is now required for project access — a leftover project member document no longer grants GCS/Vertex access after the user is removed from the org (explicitly external collaborators are unaffected), and org removal deletes the user's project memberships (`architecture/mounts.md`).
* **Fix**: Post-login `returnTo` is restricted to same-origin paths in both the Google and OIDC callbacks (open redirect).
* **Fix**: External project collaborators (no org membership) can now reach their workspace — `/api/orgs/list`, `/api/session/select`, and the workspace-switcher gate all resolve orgs through project memberships as well (`architecture/mounts.md`).
* **Update**: The Settings Organization tab is limited to accounts that can have an organization — `business`/`granted`, existing org members, or a service admin; Lite never sees it. Documented when an organization is created (Business purchase / service admin / invitation) and corrected the stale `pro` plan naming (`architecture/premium.md`).
* **Ops**: Terraform can now manage the three Firestore collection-group indexes the organization features need (`members.uid`, `invites.token`, `projects.id`) — set `manage_firestore_indexes = true` and `firestore_database_id` to the app's database (`architecture/infrastructure.md`).
* **Fix**: OIDC domain auto-enrollment requires `email_verified` — an IdP that lets an account self-assert an allow-listed address can no longer join the organization.
* **Add**: `architecture/mounts.md` — storage mounts (Drive default / GCS org project) and AI providers (genai-key / Vertex) coexistence model, route dispatch, My Drive shelf, and the `lite | business | granted` plan model.

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
* **New**: README, README_ja, and the LP screenshot gallery / feature grid now feature the Secret Manager widget; both READMEs link to gemihub.net at the top.
* **New**: Optional USD billing for Lite/Pro (`$2`/`$15` a month) alongside the existing JPY prices (`¥300`/`¥2,000`). `HubworkAccount.currency` records which Stripe Price a subscriber was actually billed with; new subscriptions pick USD vs JPY from the UI language, upgrades always keep the account's existing currency (never a resubmitted form value), and everything gracefully falls back to JPY-only when the new `STRIPE_PRICE_ID_{LITE,PRO}_USD` secrets aren't configured. The English LP now shows `$2`/`$15` (`architecture/premium.md`).
* **Fix**: `writeFileLocal` no longer resurrects an orphaned cache entry when an edit targets a `new:` placeholder id that background migration already swapped to a real Drive id — it now resolves the current id by name first. The orphan (a raw cache entry with no `CachedRemoteMeta` record) was invisible until the next migration pass, which would re-upload it as a genuine second Drive file with the same name; this is why editing a file (e.g. a dashboard, right after adding a widget) moments after creating it could produce two files, one reflecting the state at creation and one reflecting the edit (`features/sync.md` — "New-File Migration").
* **Update**: Active OKF bundles now inject only their `index.md`; the AI fetches referenced documents in full and on demand with `read_okf_document`. Markdown structure is preserved, and the tool is restricted to currently active bundles (`references/OKF.md`, `integrations/rag.md`).
* **Update**: Timeline writes now read the latest Drive file before applying an operation, update Drive immediately, and retry checksum conflicts. The Timeline header also has a manual Drive reload button (`features/dashboard.md`).

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
