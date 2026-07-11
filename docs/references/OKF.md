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

Active bundles are injected into the system prompt of every message sent from that chat.

### Managed GemiHub bundle updates

When the selected bundle's display name is exactly **GemiHub**, the chat checks the official Cloud Storage distribution for a newer release. The distribution is described by a GemiHub-specific `manifest.json` containing the bundle version, immutable ZIP URL, ZIP SHA-256, and per-file SHA-256 values. This JSON file is an updater extension, not part of the OKF standard; the OKF loader continues to read Markdown only.

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

When bundles are active in a chat, GemiHub reads Markdown files from each active bundle and injects a compact summary into the chat system prompt. The loader includes:

- `type`
- `title`
- `description`
- `tags`
- file path
- a short body excerpt

The loader uses conservative file and character limits so large OKF bundles do not overwhelm the model context.

## OKF With Skills

Use OKF when you want Gemini to understand a domain consistently. Use a skill when you want Gemini to follow a specific process or run an action. Use both when the AI needs domain context and repeatable behavior.

![OKF with Skills](images/okf_skill.png)

## Limitations

- OKF content is injected as prompt context, not uploaded to Gemini File Search automatically.
- Each selected bundle contributes at most 24 Markdown files and 1,400 body characters per file.
- OKF files must be available in the synced Drive cache before they can be discovered.
