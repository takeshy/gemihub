# OKF Knowledge Sources

GemiHub can use Open Knowledge Format (OKF) bundles as chat knowledge sources.

OKF is separate from Agent Skills. Skills define reusable behavior, references, and optional workflows. OKF provides curated domain knowledge, such as concepts, metrics, datasets, glossaries, and playbooks, that should be available to chat across conversations.

## Configure OKF

1. Sync the Drive files that contain your OKF bundle.
2. Open **Settings**.
3. Go to **RAG**.
4. Set the OKF folder path, such as `Knowledge` or `Knowledge/okf`.
5. Select one or more discovered bundles and save the selection.

![OKF Settings](images/okf.png)

GemiHub reads OKF from the synced Drive file cache. The folder path is relative to the GemiHub Drive root.

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

A bundle is any folder that directly contains an `index.md` file. The bundle display name comes from `index.md` frontmatter `title`, falling back to the folder name.

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

When bundles are selected, GemiHub reads Markdown files from each selected bundle and injects a compact summary into the chat system prompt. The loader includes:

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
- Large OKF bundles are summarized with file and character limits.
- OKF files must be available in the synced Drive cache before they can be discovered.
