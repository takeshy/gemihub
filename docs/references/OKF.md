---
type: Reference
title: OKF Knowledge Sources
description: "OKF knowledge sources: markdown knowledge bundles on Drive, selected per chat and injected into the system prompt."
tags:
  - okf
---
# OKF Knowledge Sources

GemiHub can use Open Knowledge Format (OKF) bundles as chat knowledge sources.

OKF is separate from Agent Skills. Skills define reusable behavior, references, and optional workflows. OKF provides curated domain knowledge, such as concepts, metrics, datasets, glossaries, and playbooks, that should be available to chat across conversations.

## Configure OKF

OKF is always enabled. The OKF folder path defaults to `Knowledge`; change it from **Settings → RAG** if your bundles live elsewhere:

1. Sync the Drive files that contain your OKF bundle.
2. Open **Settings** and go to **RAG**.
3. Set the OKF folder path (default `Knowledge`) and save — the Save button activates only when the path has changed. The bundles discovered under that folder are listed when the tab opens and after each save.

![OKF Settings](images/okf.png)

GemiHub reads OKF from the synced Drive file cache. The folder path is relative to the GemiHub Drive root.

## Select Bundles in Chat

Which bundles are active is chosen in chat, not in settings. When bundles are discovered under the configured folder, an OKF selector row (book icon) appears above the chat input, next to the skill selector:

- Click **+** to open the bundle list and check the bundles to activate.
- Active bundles are shown as chips; click **×** on a chip to deactivate it.
- The selection is per browser and persists across sessions (stored in localStorage).

Only each active bundle's `index.md` is injected into the system prompt of every message sent from that chat — see [What Gets Loaded](#what-gets-loaded) for how the rest of a bundle's documents reach the model.

### Managed GemiHub bundle updates

When the selected bundle's display name is exactly **GemiHub**, or contains "gemihub" (case-insensitive, e.g. a legacy install whose `index.md` predates the official `title: GemiHub` frontmatter and so falls back to its Drive folder name), the chat checks the official Cloud Storage distribution for a newer release. The distribution is described by a GemiHub-specific `manifest.json` containing the bundle version, immutable ZIP URL, ZIP SHA-256, and per-file SHA-256 values. This JSON file is an updater extension, not part of the OKF standard; the OKF loader continues to read Markdown only.

If an update is available, GemiHub asks before changing local files. After confirmation it downloads the ZIP through the authenticated app endpoint, verifies the archive and every listed document, and stages the official documents plus the installed `manifest.json` in the local Drive cache. Extra user-authored files are preserved. The normal Push operation sends the update to Drive, while the refreshed content is available to the next chat message immediately.

Production uses a private Cloud Storage bucket configured with `GEMIHUB_OKF_BUCKET` and optional `GEMIHUB_OKF_PREFIX`; the Cloud Run service account receives read-only object access. Self-hosted deployments without Google credentials can instead set `GEMIHUB_OKF_BASE_URL` to a public HTTPS prefix. If neither source is configured, selecting the GemiHub bundle behaves like any other OKF bundle and no update check is made.

## OKF Format

OKF is a Markdown-based knowledge bundle format. Each concept is usually a Markdown file with YAML frontmatter:

```markdown
---
type: Metric
title: Monthly recurring revenue
description: Recurring subscription revenue normalized to a monthly value.
tags:
  - revenue
  - finance
---

# Monthly recurring revenue

MRR is calculated from active paid subscriptions...
```

![OKF Sample](images/okf_sample.png)

## Bundles

A bundle is any folder that directly contains an `index.md` file. The bundle display name comes from `index.md` frontmatter `title`, falling back to the folder name. Only top-level bundle folders are listed: a subdirectory `index.md` inside a bundle (a per-directory index for progressive disclosure) belongs to the parent bundle and is not discovered as a separate bundle.

Recommended layout:

```text
Knowledge/
  index.md
  metrics/
    mrr.md
    churn-rate.md
  datasets/
    subscriptions.md
  playbooks/
    investigate-revenue-drop.md
  log.md
```

`log.md` is skipped. `index.md` is treated as an index document.

## What Gets Loaded

When a bundle is active in a chat, GemiHub injects only that bundle's **`index.md`** into the system prompt — its title, description, and full body (the table of contents), not the whole bundle. Every other document in the bundle stays out of the prompt until the model actually needs it.

To read a specific document, the model calls the `read_okf_document` tool with the `bundleId` shown next to the bundle's heading in the system prompt and a document path referenced in `index.md` (leading slashes are stripped automatically). The tool returns that one document's full content. This mirrors how a Skill's `SKILL.md` is read on demand with `read_drive_file` rather than being inlined for every skill up front — the model is expected to consult the index, then fetch only the specific documents relevant to the current question.

Because of this, a bundle's `index.md` is the single most important file: it should read like a proper table of contents (organized by topic, with an accurate one-line description and path for every document), since it's the only thing the model reliably sees without asking for more.

## OKF With Skills

Use OKF when you want Gemini to understand a domain consistently. Use a skill when you want Gemini to follow a specific process or run an action. Use both when the AI needs domain context and repeatable behavior.

![OKF with Skills](images/okf_skill.png)

## Limitations

- OKF content is injected as prompt context, not uploaded to Gemini File Search automatically.
- Only a bundle's `index.md` is inlined automatically; other documents cost a `read_okf_document` tool call each, so a poorly organized index can cause the model to miss or skip relevant documents.
- A document fetched via `read_okf_document` is capped at 20,000 body characters so an unexpectedly large Drive file can't dominate a single tool result.
- `log.md` is never returned, even if explicitly requested by path.
- OKF files must be available in the synced Drive cache before they can be discovered.
