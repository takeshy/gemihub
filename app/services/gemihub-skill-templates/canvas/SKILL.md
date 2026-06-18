---
name: canvas
description: Create and edit GemiHub .canvas files using JSON Canvas nodes, edges, groups, colors, and file/link references.
---

# GemiHub Canvas Skill

Create and edit `.canvas` files for GemiHub. A canvas file is JSON with top-level `nodes` and `edges` arrays. Use this skill when the user asks for a canvas, visual map, mind map, diagram board, planning board, concept map, or `.canvas` file.

Always output valid JSON when creating or modifying a `.canvas` file.

## File Shape

```json
{
  "nodes": [],
  "edges": []
}
```

## Node Types

Every node requires:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique 16-character lowercase hex string |
| `type` | string | `text`, `file`, `link`, or `group` |
| `x` | number | Top-left x coordinate |
| `y` | number | Top-left y coordinate |
| `width` | number | Node width |
| `height` | number | Node height |
| `color` | string | Optional preset `"1"` through `"6"` or hex color |

### Text Node

```json
{
  "id": "8a9b0c1d2e3f4a5b",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 320,
  "height": 180,
  "text": "# Main Idea\n\nShort Markdown content."
}
```

Text node content is Markdown. Use `\n` inside JSON strings for line breaks.

### File Node

```json
{
  "id": "1a2b3c4d5e6f7a8b",
  "type": "file",
  "x": 400,
  "y": 0,
  "width": 320,
  "height": 180,
  "file": "notes/project.md"
}
```

Use workspace-relative paths for `file`. Optional `subpath` can point to a heading or block-like fragment.

### Link Node

```json
{
  "id": "2b3c4d5e6f7a8b9c",
  "type": "link",
  "x": 0,
  "y": 260,
  "width": 300,
  "height": 120,
  "url": "https://example.com"
}
```

### Group Node

```json
{
  "id": "3c4d5e6f7a8b9c0d",
  "type": "group",
  "x": -40,
  "y": -40,
  "width": 820,
  "height": 300,
  "label": "Phase 1",
  "color": "4"
}
```

Optional group fields: `label`, `background`, `backgroundStyle`. `backgroundStyle` is `cover`, `ratio`, or `repeat`.

## Edges

```json
{
  "id": "4d5e6f7a8b9c0d1e",
  "fromNode": "8a9b0c1d2e3f4a5b",
  "fromSide": "right",
  "toNode": "1a2b3c4d5e6f7a8b",
  "toSide": "left",
  "toEnd": "arrow",
  "label": "supports"
}
```

Edge fields:

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Unique 16-character lowercase hex string |
| `fromNode` | yes | Source node ID |
| `toNode` | yes | Target node ID |
| `fromSide` | no | `top`, `right`, `bottom`, or `left` |
| `toSide` | no | `top`, `right`, `bottom`, or `left` |
| `fromEnd` | no | `none` or `arrow` |
| `toEnd` | no | `none` or `arrow`; omitted behaves like arrow in the editor |
| `color` | no | Preset or hex color |
| `label` | no | Edge label |

## Color Presets

| Value | Color |
|-------|-------|
| `"1"` | Red |
| `"2"` | Orange |
| `"3"` | Yellow |
| `"4"` | Green |
| `"5"` | Cyan |
| `"6"` | Purple |

## Layout Guidelines

- Use integer coordinates.
- `x` increases to the right; `y` increases downward.
- Leave 40 to 120 pixels between related cards.
- Use widths around 280 to 420 for text and file nodes.
- Put group nodes behind the content they contain and make them large enough to include padding.
- Avoid overlapping nodes unless the user explicitly asks for a layered layout.

## Validation Checklist

Before writing a `.canvas` file:

1. JSON parses successfully.
2. Top-level value has `nodes` and `edges` arrays.
3. Every node and edge ID is unique.
4. Every edge references existing node IDs.
5. Every node has numeric `x`, `y`, `width`, and `height`.
6. Every node `type` is `text`, `file`, `link`, or `group`.
