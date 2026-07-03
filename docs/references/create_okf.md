---
name: okf
description: Author and maintain Open Knowledge Format (OKF) knowledge bundles — directories of markdown files with YAML frontmatter that capture curated domain knowledge (metrics, tables, datasets, playbooks, glossaries). Use when the user asks to create, generate, or update an OKF bundle, a knowledge bundle, or curated domain context for chat. Once authored, the bundle can be registered as an OKF knowledge source in supported LLM Hub ecosystem hosts.
---

# OKF Authoring

Create well-formed **Open Knowledge Format (OKF) v0.1** bundles in the vault. OKF
is a vendor-neutral knowledge format: a directory of markdown files, each file a
single *concept*, with YAML frontmatter and a markdown body. There is no schema
registry and no required tooling — "if you can `cat` a file, you can read OKF".

Reference spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf (`SPEC.md`).

## When to use

Use this skill when the user wants to:
- Turn a domain (e.g. a BigQuery dataset, a product area, a set of metrics) into a curated knowledge bundle.
- Create or extend an OKF bundle, or add concepts/index/log files to one.
- Produce curated context that can be selected in chat as an OKF knowledge source.

## Authoring workflow

1. **Confirm the target directory.** Ask for (or propose) a vault-relative bundle
   root under `Knowledge/`, e.g. `Knowledge/sales-okf`. All OKF bundle files go
   under that directory. If the user provides only a bundle name, create it as
   `Knowledge/<bundle-name>`. Always create a bundle subdirectory under
   `Knowledge/`; do not create bundle files directly in `Knowledge/` itself
   (for example, never use `Knowledge/index.md` as the bundle index).
2. **Gather scope.** Identify the domain and any source material (table schemas,
   docs, definitions). Ask the user for sources if the knowledge isn't already available.
3. **Plan the concepts.** List the concepts and how to group them into
   subdirectories (e.g. `tables/`, `datasets/`, `metrics/`, `playbooks/`,
   `references/`). Each concept becomes one `.md` file.
4. **Write each concept file** with the `create_note` tool — pass the file
   `name` (e.g. `orders.md`) and the `folder` (e.g. `Knowledge/sales-okf/tables`).
   Follow the frontmatter and body rules below.
5. **Write `index.md`** at the bundle root (and optionally per subdirectory) for
   progressive disclosure.
6. **Optionally write `log.md`** to record what was created/updated.
7. **Tell the user to register the bundle**: Settings → *Knowledge sources* →
   enable *OKF*, set the OKF directory to the bundle root, then select the
   discovered OKF bundle in chat from the OKF selector.

## Bundle structure

```text
Knowledge/sales-okf/
├── index.md                 # Optional. Directory listing (no frontmatter).
├── log.md                   # Optional. Chronological change history.
├── metrics/
│   ├── index.md
│   └── mrr.md
├── tables/
│   ├── index.md
│   └── orders.md
└── playbooks/
    └── investigate-revenue-drop.md
```

- A **concept ID** is the file path minus `.md` (e.g. `tables/orders`).
- `index.md` and `log.md` are **reserved filenames** — never use them for concepts.

## Concept frontmatter

Every non-reserved `.md` file MUST start with a YAML frontmatter block whose only
**required** field is a non-empty `type`.

```yaml
---
type: BigQuery Table          # REQUIRED. Short, descriptive, self-explanatory.
title: Customer Orders        # Recommended. Human-readable display name.
description: One row per completed customer order across all channels.  # Recommended. One sentence.
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders  # Optional. Canonical URI of the underlying asset.
tags: [sales, orders, revenue]   # Optional. Cross-cutting categorization.
timestamp: 2026-06-29T10:00:00Z  # Optional. ISO 8601 last-modified time.
---
```

Rules:
- `type` is free-form (no central registry). Pick descriptive values such as
  `BigQuery Table`, `BigQuery Dataset`, `Metric`, `Playbook`, `Reference`, `Glossary`.
- Use `resource` only for concepts bound to a real asset; omit it for abstract
  concepts (metrics, playbooks, processes).
- `timestamp` MUST be ISO 8601 when present.
- Producer-defined extra keys are allowed.

## Concept body

Standard markdown. Favor **structural markdown** (headings, lists, tables, fenced
code) over prose — it helps both humans and agents. These headings have
conventional meaning; use them when applicable:

| Heading       | Purpose                                              |
|---------------|------------------------------------------------------|
| `# Schema`    | Columns/fields of an asset.                          |
| `# Examples`  | Concrete usage examples, often fenced code blocks.   |
| `# Citations` | External sources backing claims (see below).         |

Example concept bound to a resource:

```markdown
---
type: BigQuery Table
title: Customer Orders
description: One row per completed customer order across all channels.
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders
tags: [sales, orders, revenue]
timestamp: 2026-06-29T10:00:00Z
---

# Schema

| Column        | Type      | Description                                          |
|---------------|-----------|------------------------------------------------------|
| `order_id`    | STRING    | Globally unique order identifier.                    |
| `customer_id` | STRING    | Foreign key into [customers](/tables/customers.md).  |
| `total_usd`   | NUMERIC   | Order total in US dollars.                           |

# Joins

Joined with [customers](/tables/customers.md) on `customer_id`.

# Citations

[1] [BigQuery table schema](https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders)
```

Example concept not bound to a resource:

```markdown
---
type: Playbook
title: Investigate a revenue drop
description: Steps to triage an unexpected drop in daily revenue.
tags: [oncall, revenue]
timestamp: 2026-06-29T10:00:00Z
---

# Trigger

Daily revenue falls more than 20% below the trailing 7-day average. See
[MRR](/metrics/mrr.md).

# Steps

1. Confirm the drop in the [orders table](/tables/orders.md).
2. Check for ingestion delays.
3. …
```

## Cross-linking

Express relationships with standard markdown links. The relationship kind is
conveyed by surrounding prose, not the link itself.

- **Bundle-relative (recommended)**: start with `/`, relative to the bundle root —
  `[customers](/tables/customers.md)`. Stable when files move within a subdirectory.
- **Relative**: `[neighbor](./other.md)`.

Broken links are tolerated (they may represent not-yet-written knowledge).

## index.md

No frontmatter. One or more sections, each a heading followed by a bullet list of
links with the linked concept's description:

```markdown
# Metrics

* [MRR](metrics/mrr.md) - Recurring subscription revenue normalized to a month.
* [Churn rate](metrics/churn-rate.md) - Percentage of customers lost in a period.

# Tables

* [Orders](tables/orders.md) - One row per completed customer order.
```

## log.md (optional)

Date-grouped entries, newest first. Date headings MUST be ISO 8601 `YYYY-MM-DD`.
The leading bold word is a convention.

```markdown
# Update Log

## 2026-06-29
* **Creation**: Established [Orders table](/tables/orders.md) and [MRR](/metrics/mrr.md).
* **Update**: Added progressive-disclosure [index](/index.md).
```

## Citations

When the body makes externally-sourced claims, list them under a final
`# Citations` heading, numbered. Links may be absolute URLs, bundle-relative
paths, or paths into a `references/` subdirectory.

```markdown
# Citations

[1] [Data quality runbook](https://wiki.example.internal/data/quality)
```

## Conformance checklist

Before finishing, verify the bundle:

- [ ] Every non-reserved `.md` file has a parseable YAML frontmatter block.
- [ ] Every frontmatter block has a non-empty `type`.
- [ ] `index.md` / `log.md` (when present) follow the formats above and are not used as concepts.
- [ ] `timestamp` values, where present, are ISO 8601.
- [ ] Cross-links use bundle-relative `/…` form where practical.

## How hosts consume the bundle

When the bundle is registered as an OKF knowledge source and selected in chat,
the host injects a compact summary into the system prompt: each concept's
`type`, `title`, `description`, `tags`, file path, and a short body excerpt.
`log.md` is skipped; `index.md` is treated as an index. Because the loader applies
conservative file/character limits, keep bundles **focused** and write **tight,
informative `description` fields and leading paragraphs** — they are what the
model sees first.
