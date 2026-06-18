# GemiHub Canvas Examples

## Simple Concept Map

```json
{
  "nodes": [
    {
      "id": "8a9b0c1d2e3f4a5b",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 320,
      "height": 160,
      "text": "# Main Idea\n\nCentral concept."
    },
    {
      "id": "1a2b3c4d5e6f7a8b",
      "type": "text",
      "x": 440,
      "y": -100,
      "width": 300,
      "height": 120,
      "text": "## Supporting Point A"
    },
    {
      "id": "2b3c4d5e6f7a8b9c",
      "type": "text",
      "x": 440,
      "y": 100,
      "width": 300,
      "height": 120,
      "text": "## Supporting Point B"
    }
  ],
  "edges": [
    {
      "id": "3c4d5e6f7a8b9c0d",
      "fromNode": "8a9b0c1d2e3f4a5b",
      "fromSide": "right",
      "toNode": "1a2b3c4d5e6f7a8b",
      "toSide": "left"
    },
    {
      "id": "4d5e6f7a8b9c0d1e",
      "fromNode": "8a9b0c1d2e3f4a5b",
      "fromSide": "right",
      "toNode": "2b3c4d5e6f7a8b9c",
      "toSide": "left"
    }
  ]
}
```

## Board With Groups

```json
{
  "nodes": [
    {
      "id": "5e6f7a8b9c0d1e2f",
      "type": "group",
      "x": -20,
      "y": -20,
      "width": 340,
      "height": 420,
      "label": "To Do",
      "color": "1"
    },
    {
      "id": "6f7a8b9c0d1e2f3a",
      "type": "group",
      "x": 380,
      "y": -20,
      "width": 340,
      "height": 420,
      "label": "Done",
      "color": "4"
    },
    {
      "id": "7a8b9c0d1e2f3a4b",
      "type": "text",
      "x": 20,
      "y": 60,
      "width": 260,
      "height": 120,
      "text": "## Draft\n\nWrite the first pass."
    },
    {
      "id": "8b9c0d1e2f3a4b5c",
      "type": "text",
      "x": 420,
      "y": 60,
      "width": 260,
      "height": 120,
      "text": "## Review\n\nReviewed and accepted.",
      "color": "4"
    }
  ],
  "edges": [
    {
      "id": "9c0d1e2f3a4b5c6d",
      "fromNode": "7a8b9c0d1e2f3a4b",
      "fromSide": "right",
      "toNode": "8b9c0d1e2f3a4b5c",
      "toSide": "left",
      "label": "then"
    }
  ]
}
```
