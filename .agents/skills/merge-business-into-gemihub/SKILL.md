---
name: merge-business-into-gemihub
description: Absorb code from the read-only sibling fork ../gemihub-business into this repository per the unification spec, adapting tenant-scoped Cloud Storage and Vertex AI code into the coexistence provider model (Drive + user API key stays the default; GCS + Vertex applies only inside an org project mount). Use when porting fork services/routes/components, deciding which repo's version of a file wins, renaming gemibiz identifiers, or verifying a merge phase.
---

# Merge gemihub-business into gemihub

Direction: fork → this repo. `../gemihub-business` (git remote `business`) is a
**read-only reference** — never modify it, never `git merge` it (histories are
disjoint; a merge would conflict on ~250 files). Absorb code by hand, phase by
phase, per the unification spec.

## Ground rules

1. Read [references/adaptation-map.md](references/adaptation-map.md) before
   touching AI, storage, sync, auth, settings, plans, uploads, publishing, or
   server routes. It is the reverse of the fork's
   `port-gemihub-updates/references/adaptation-map.md`.
2. Rename every `gemibiz` identifier on the way in using
   [references/rename-table.md](references/rename-table.md). Never let a
   `gemibiz` literal land in this repo.
3. Do not import the fork's known defects — check
   [references/known-defects.md](references/known-defects.md) before adopting a
   fork file it lists.
4. For fork-winning files, re-land this repo's recent Drive-side work listed in
   [references/unported-backlog.md](references/unported-backlog.md).
5. Which repo's version wins is decided per file class in the spec
   ("Which repo's version wins, file class by file class"). Fork wins for
   storage/tenancy/AI/RAG services and routes; this repo wins for the workflow
   engine, editor, dashboard, bases, plugins, billing, and infrastructure.
6. The coexistence model is non-negotiable: provider selection is per user and
   per mount (`drive` | `gcs-project`), never a build- or deploy-time switch.
   Drive + the user's own Gemini API key remains the default everywhere,
   including gemihub.net. Never remove an API-key affordance; never gate an
   ordinary user onto Vertex.
7. **No production Stripe subscribers exist** (product decision, 2026-08-19).
   Plan-data migrations (`pro` → `business` read-normalization, subscriber org
   backfill) are unnecessary; rename plan values directly.
8. Never copy secrets, tokens, environment files, lockfiles, or deployment
   identifiers between repositories. Reconcile `package.json` intentionally and
   regenerate the lockfile with npm. Do not import the fork's unused
   `@google-cloud/{billing,iam,resource-manager,service-usage}` deps.

## Porting a slice

1. Locate the fork file(s): `git -C ../gemihub-business log --follow -- <path>`
   for history; diff against this repo with
   `git diff HEAD..business/main -- <path>` (remote `business` is fetched).
2. Classify per the spec's winner table. When adopting a fork file, apply the
   rename table and the adaptation map, then re-land this repo's backlog items
   that touch it.
3. Keep stored contracts backward compatible for THIS repo's users: workflow
   node types keep their `drive-*` / `gemihub-command` names, `gemihub/`
   settings folder, `/__gemihub/api.js`, existing localStorage keys.
4. Update route registration (`app/routes.ts`), types, translations (`en` and
   `ja` in sync), and tests together with the feature.
5. i18n: never adopt the fork's global "Drive" → "Cloud Storage" rewording.
   Storage-facing labels take a `{storageName}` variable resolved from the
   active mount.

## Verify after each slice

Run `npm run precommit` (typecheck + lint + build) and `npm run test`. Then
search the diff for forbidden fork assumptions:

```bash
rg -n 'gemibiz|GEMIBIZ|gemihub\.online|/api/storage/tree\?projectId|createVertexClient\(\)|hasProFeatures|"pro"' app server.js vite.config.ts terraform
```

And for regressions on the default path:

```bash
rg -n 'requireProjectAccess|ProjectAccessContext' app/routes/api.drive.* app/services/google-drive.server.ts
```

Explain every hit or remove it. A fork-sourced change that makes a Gemini API
key mandatory, requires a project to use the app, or breaks a saved workflow
is wrong by definition.

## Provenance

When committing, record absorbed fork commits as trailers:

```text
Business-Commit: gemihub-business@<full-sha>
```
