# Agent Skills

Agent Skills extend the AI's capabilities by providing custom instructions, reference materials, and executable workflows. Skills are user-defined AI agent configurations stored as folders on Google Drive.

## Folder Structure

Skills are stored in the `skills/` folder within your Drive's `gemihub/` directory. Each skill is a subfolder containing a `SKILL.md` file:

```
gemihub/
  skills/
    code-review/
      SKILL.md              # Skill definition (required)
      references/            # Reference documents (optional)
        style-guide.md
        checklist.md
      workflows/             # Executable workflows (optional)
        run-lint.yaml
    meeting-notes/
      SKILL.md
      references/
        template.md
```

## SKILL.md Format

Each `SKILL.md` file has three parts: YAML frontmatter for user-facing metadata, a ```skill-capabilities fenced YAML block declaring which workflows the skill exposes, and a markdown body for instructions:

````markdown
---
name: Code Review
description: Reviews code blocks for quality and best practices
---

```skill-capabilities
workflows:
  - path: workflows/run-lint.yaml
    description: Run linting on the current file
    inputVariables: [filePath]
```

You are a code review assistant. When reviewing code:

1. Check for common bugs and anti-patterns
2. Suggest improvements for readability
3. Verify error handling is adequate
4. Reference the style guide for formatting rules
````

Frontmatter holds only Obsidian-standard metadata. Workflow / script definitions live in the `skill-capabilities` fenced block — this is the single source of truth for what the runtime exposes to the LLM. Skills that still declare `workflows:` in frontmatter keep working for backward compatibility (with a one-time migration warning), and any edit via "Modify Skill with AI" rewrites them into the new layout.

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name for the skill. Defaults to folder name |
| `description` | No | Short description shown in the skill selector. **Also the chat AI's primary cue for whether to use the skill** — write it as triggering conditions ("Use when the user asks about…"), not as a workflow summary. Lean toward over-triggering: chat LLMs tend to skip skills they could have used, so an extra "Use this skill whenever the user mentions X, Y, or Z, even if they don't explicitly ask" at the end is often warranted. |

### Workflow References

Workflows declared in the `skill-capabilities` block are registered as function-calling tools that the AI can invoke:

````markdown
```skill-capabilities
workflows:
  - path: workflows/run-lint.yaml
    description: Run linting on the current file
    inputVariables: [filePath]      # Variables the LLM must supply when invoking
```

The tool name exposed to the chat LLM is derived from the filename (`workflows/run-lint.yaml` → `run-lint`). Do not add a separate `name:` field — one file is one workflow, so duplicating the filename only creates drift.
````

Every workflow the LLM may invoke must be declared here — the `workflows/` subdirectory is **not** auto-scanned. Files without a `skill-capabilities` entry are invisible to the AI. `inputVariables` lists the variable names the workflow reads but does not initialize; it is overwritten whenever the skill is edited via "Modify Skill with AI", based on the actual workflow YAML.

## References

Place reference documents in a `references/` subfolder. The chat AI loads them on demand by calling `read_drive_file` — they are NOT injected into the system prompt automatically, so the SKILL.md body must point at them explicitly (e.g. *"see `references/api-reference.md` for the full surface"*). Use references for:

- Style guides and coding standards
- Templates and examples
- Checklists and procedures
- Domain-specific knowledge

### Progressive disclosure

Skills load in three layers, and you should design around them:

1. **`name` + `description` (frontmatter)** — Always in the chat AI's context. The only signal used to decide whether to consult the skill.
2. **SKILL.md body** — Pulled in by the chat AI's first `read_drive_file` call when it activates the skill. Keep it lean (rough target: under ~500 lines) — every line is paid for in every conversation that activates the skill.
3. **`references/` and `workflows/` files** — Loaded only when the chat AI calls `read_drive_file` on a specific file (the SKILL.md body must reference them by path). Long reference material, multi-variant docs (e.g. `references/aws.md`, `references/gcp.md`), and example libraries belong here.

### Authoring tips for effective SKILL.md bodies

- **Explain the *why*, not just `MUST` / `NEVER`.** Modern LLMs follow reasoned guidance better than walls of imperatives. Give the one-clause reason a rule exists.
- **Prefer tables to prose** for Before/After patterns and "tempting thought → counter-rule" red flags.
- **Add an `## Examples` section** with `Input:` / `Output:` pairs for skills with a deterministic transformation (commit-message format, data extraction, etc.). Skip for open-ended skills where examples would over-constrain.
- See the "Modify Skill with AI" prompt (in `app/engine/workflowSpec.ts`) for the full convention catalogue used by AI-generated skills.

## Workflows

Skill workflows use the standard GemiHub YAML workflow format (see [Workflow Node Reference](./workflow_nodes.md)). Place `.yaml` files in the `workflows/` subfolder:

```yaml
name: Run Lint
nodes:
  - id: read
    type: drive-read
    fileId: "{{fileId}}"
    saveTo: fileContent
  - id: lint
    type: command
    prompt: "Check the following for lint issues:\n{{fileContent}}"
    saveTo: result
  - id: show
    type: dialog
    title: Lint Results
    message: "{{result}}"
```

When a skill with workflows is active, the AI receives a `run_skill_workflow` tool that it can call to execute these workflows. The workflow ID format is `skillId/workflowName` (e.g., `code-review/run-lint`).

### Headless Execution

Skill workflows run in headless mode when invoked by the AI:

- Interactive prompts (`dialog`, `prompt-value`, `prompt-file`, `prompt-selection`) are skipped (return null)
- Drive events are forwarded to the chat so file changes appear in the conversation
- The AI receives the workflow's result variables as the tool result

### Returning values to the chat

When the AI invokes a skill workflow via `run_skill_workflow`, **every variable whose name does not start with `_` is automatically returned to the chat AI** as part of the tool result. You do not need to add a trailing `command` node just to "output" a result — simply `saveTo:` the value you want the chat AI to see.

A `command` node runs a separate LLM call *inside* the workflow and stores its output to a variable; it does not write directly to the chat. If the user needs a specific variable rendered verbatim in the chat reply, put that instruction in the SKILL.md instructions body, for example:

> After the workflow completes, output the value of `ogpMarkdown` to the user verbatim, with no additional commentary.

The chat-side AI, guided by those instructions, will include the variable in its response.

### Error recovery

If a skill workflow fails during a chat, the failing tool call shows an **Open workflow** button. Clicking it opens the workflow file *and* switches the right sidebar to the Workflow / skill tab so you can edit the flow and re-run. A hint line below also points you at "Modify skill with AI" → referencing the execution history for the failing step.

---

## Using Skills in Chat

### Setup

1. Create the `skills/` folder structure on Drive and sync (Push/Pull)

### Activating Skills

Skills appear in the chat input area when available:

1. Click the **Sparkles** icon button next to the input controls
2. Select skills from the dropdown to activate them
3. Active skills show as purple chips above the input that can be removed by clicking **x**

When skills are active:

- Skill instructions and references are injected into the system prompt
- If skills have workflows, the `run_skill_workflow` tool becomes available
- Multiple skills can be active simultaneously

### Slash Command

You can activate a skill by typing `/folder-name` in the chat input:

- **`/folder-name`** — Activates the skill. The AI proactively uses the skill's instructions and workflows.
- Autocomplete shows available skills (marked with `[Skill]`) as you type `/`. Selecting from autocomplete activates the skill immediately.

The folder name (not the skill display name) is used as the command — e.g., a skill at `skills/weekly-report/` is invoked with `/weekly-report`.

### Example: Creating a Skill

1. Create a folder: `gemihub/skills/summarizer/`
2. Create `gemihub/skills/summarizer/SKILL.md`:

```markdown
---
name: Summarizer
description: Summarizes documents in bullet-point format
---

When asked to summarize, follow these rules:

- Use concise bullet points
- Group related items under headings
- Include key dates and action items
- Keep summaries under 500 words
```

3. Push/Pull to sync files with Drive
4. Open the chat, click the Sparkles icon to activate the "Summarizer" skill
5. Ask the AI to summarize a file — it will follow the skill's instructions

---

## Example Skills

### Writing Style Guide (Instructions + References)

A skill that enforces consistent writing style using a reference document.

#### Folder structure

```
skills/
  writing-style/
    SKILL.md
    references/
      style-guide.md
```

#### `SKILL.md`

```markdown
---
name: Writing Style
description: Enforces consistent tone and formatting for blog posts
---

You are a writing assistant. Always follow the style guide in the references.

When reviewing or writing text:

1. Use the voice and tone specified in the style guide
2. Follow the formatting rules (headings, lists, emphasis)
3. Apply the vocabulary preferences (preferred/avoided words)
4. Point out any style violations when reviewing existing text
```

#### `references/style-guide.md`

```markdown
# Blog Style Guide

## Voice & Tone
- Conversational but professional
- Active voice preferred
- Second person ("you") for tutorials, first person plural ("we") for announcements

## Formatting
- H2 for main sections, H3 for subsections
- Use bullet lists for 3+ items
- Bold for UI elements and key terms
- Code blocks with language tags

## Vocabulary
- Prefer: "use" over "utilize", "start" over "initiate", "help" over "facilitate"
- Avoid: jargon without explanation, passive constructions, filler words ("very", "really", "just")
```

---

### Daily Journal (Instructions + Workflow)

A skill that helps maintain a daily journal with a workflow to create today's entry.

#### Folder structure

```
skills/
  daily-journal/
    SKILL.md
    workflows/
      create-entry.yaml
```

#### `SKILL.md`

```markdown
---
name: Daily Journal
description: Daily journaling assistant with entry creation
workflows:
  - path: workflows/create-entry.yaml
    description: Create today's journal entry from template
---

You are a journaling assistant. Help the user reflect on their day.

When the user asks to write a journal entry:

1. Use the workflow to create today's note file first
2. Ask about highlights, challenges, and learnings
3. Format entries with the ## Highlights / ## Challenges / ## Learnings structure
4. Keep a warm, encouraging tone
5. Suggest reflection prompts if the user seems stuck
```

#### `workflows/create-entry.yaml`

```yaml
name: Create Journal Entry
nodes:
  - id: date
    type: set
    name: today
    value: "{{__date__}}"
  - id: create
    type: drive-save
    fileName: "Journal/{{today}}.md"
    content: |
      # {{today}}

      ## Highlights


      ## Challenges


      ## Learnings


      ## Tomorrow
    saveTo: result
```

Usage: Activate the skill, then ask "Create today's journal entry" — the AI calls the workflow to create the file, then helps you fill it in.

---

### Meeting Notes (Instructions + References + Workflow)

A full-featured skill combining custom instructions, a template reference, and a workflow for creating meeting notes.

#### Folder structure

```
skills/
  meeting-notes/
    SKILL.md
    references/
      template.md
    workflows/
      create-meeting.yaml
```

#### `SKILL.md`

```markdown
---
name: Meeting Notes
description: Structured meeting note-taking with template and auto-creation
workflows:
  - path: workflows/create-meeting.yaml
    description: Create a new meeting note with attendees and agenda
---

You are a meeting notes assistant. Follow the template in the references.

When helping with meeting notes:

1. Use the workflow to create the meeting note file
2. Follow the template structure exactly
3. Capture action items with owners and due dates in the format: `- [ ] [Owner] Action item (due: YYYY-MM-DD)`
4. Summarize decisions clearly and separately from discussion
5. After the meeting, offer to extract action items as tasks
```

#### `references/template.md`

```markdown
# Meeting Note Template

## Required Sections

### Header
- **Title**: Meeting topic
- **Date**: YYYY-MM-DD
- **Attendees**: List of participants

### Agenda
Numbered list of discussion topics.

### Notes
Discussion details organized by agenda item. Use sub-headings.

### Decisions
Bulleted list of decisions made. Each must be clear and actionable.

### Action Items
Checkbox list with owner and due date:
- [ ] [Owner] Description (due: YYYY-MM-DD)

### Next Steps
Brief summary of follow-ups and next meeting date if applicable.
```

#### `workflows/create-meeting.yaml`

```yaml
name: Create Meeting Note
nodes:
  - id: date
    type: set
    name: today
    value: "{{__date__}}"
  - id: gen
    type: command
    prompt: |
      Generate a meeting note markdown content.
      Today's date is {{today}}.
      The meeting topic is: {{topic}}
      Attendees: {{attendees}}

      Return ONLY the markdown content following this template structure:
      Header with date/attendees, Agenda (from topic), empty Notes/Decisions/Action Items/Next Steps sections.
    saveTo: content
  - id: create
    type: drive-save
    fileName: "Meetings/{{today}} {{topic}}.md"
    content: "{{content}}"
    saveTo: result
```

Usage: Activate the skill, then say "Create meeting notes for the design review with Alice, Bob, and Carol" — the AI calls the workflow with topic/attendees and creates a structured note.

---

## Technical Details

- Skills are discovered from the IndexedDB file cache (no network request needed after sync)
- Active skill IDs are persisted in `localStorage` (`gemihub:activeSkills`)
- Skills are automatically re-discovered when files are synced (Push/Pull)
- The `run_skill_workflow` tool is only registered when active skills have workflows
- Workflow files must be `.yaml` or `.yml` format
