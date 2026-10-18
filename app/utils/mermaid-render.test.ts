import assert from "node:assert/strict";
import test from "node:test";
import { renderMermaid } from "./mermaid-render.ts";
import editorMermaid from "./mermaid-compat.ts";
import { parseWorkflowYaml } from "../engine/parser.ts";
import { workflowToMermaid } from "./workflow-to-mermaid.ts";

const flowchart = 'flowchart LR\n accTitle: Test diagram\n A["開始"] --> B{"確認"}\n B -->|はい| C["完了"]';

test("renders multiple diagram types concurrently with independent SVG identifiers", async () => {
  const sources = [flowchart, flowchart, "sequenceDiagram\n Alice->>Bob: Hello", "classDiagram\n Animal <|-- Duck", "stateDiagram-v2\n [*] --> Ready", "pie\n \"Done\" : 4\n \"Todo\" : 2", "mindmap\n root((Project))\n  Task"];
  const results = await Promise.all(sources.map(chart => renderMermaid({ chart, isDark: false })));
  for (const result of results) {
    assert.ok(result?.svg.includes('class="pele pele-'));
    assert.ok(result.svg.includes('data-pele-theme="light"'));
    assert.ok(result.svg.includes('viewBox="'));
  }
  const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const firstIds = new Set(ids(results[0]!.svg));
  assert.ok(firstIds.size > 0);
  assert.equal(ids(results[1]!.svg).some(id => firstIds.has(id)), false);
  assert.ok(results[0]!.svg.includes("開始"));
});

test("supports explicit dark themes, automatic editor themes, and fixed-size workflow previews", async () => {
  const dark = await renderMermaid({ chart: flowchart, isDark: true });
  assert.ok(dark?.svg.includes('data-pele-theme="dark"'));
  const fixed = await renderMermaid({ chart: flowchart, useMaxWidth: false });
  assert.ok(fixed?.svg.includes('data-pele-theme="auto"'));
  assert.equal(fixed.svg.includes("max-width:100%"), false);
  editorMermaid.initialize({ theme: "default" });
  const editor = await editorMermaid.render("editor-1", flowchart);
  assert.ok(editor.svg.includes('data-pele-theme="auto"'));
  assert.ok(editor.svg.includes("pele-flowchart"));
});

test("empty or cancelled renders produce no output", async () => {
  assert.equal(await renderMermaid({ chart: "  " }), null);
  assert.equal(await renderMermaid({ chart: "invalid" }, () => true), null);
  let checks = 0;
  assert.equal(await renderMermaid({ chart: flowchart }, () => ++checks > 1), null);
});

test("a syntax error does not block later valid diagrams", async () => {
  await assert.rejects(renderMermaid({ chart: "not a diagram" }));
  assert.ok((await renderMermaid({ chart: flowchart }))?.svg.includes("pele-flowchart"));
});

test("untrusted diagram text cannot introduce executable SVG markup or links", async () => {
  const result = await renderMermaid({ chart: 'flowchart LR\n A["<script>alert(1)</script>"] --> B["安全"]\n click A "javascript:alert(1)"' });
  assert.ok(result);
  assert.doesNotMatch(result.svg, /<script\b|\son\w+=|href="javascript:|<foreignObject\b/i);
  assert.doesNotMatch(result.svg, /<a\b/i);
});

test("renders the actual workflow converter output including branches and the END node", async () => {
  const workflow = parseWorkflowYaml(`nodes:\n  - id: start\n    type: variable\n    name: count\n    value: "1"\n    next: check\n  - id: check\n    type: if\n    condition: count > 0\n    trueNext: answer\n    falseNext: end\n  - id: answer\n    type: command\n    prompt: 日本語で回答\n    next: end\n`);
  const result = await renderMermaid({ chart: workflowToMermaid(workflow), isDark: false });
  assert.ok(result?.svg.includes("pele-flowchart"));
  assert.ok(result.svg.includes("END"));
  assert.ok(result.svg.includes("日本語"));
});
