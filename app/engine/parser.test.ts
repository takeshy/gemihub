import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkflowYaml, serializeWorkflow, getNextNodes } from "./parser.ts";
import type { Workflow, WorkflowNode } from "./types.ts";

// ---------------------------------------------------------------------------
// Helper: build a Workflow object programmatically
// ---------------------------------------------------------------------------
function buildWorkflow(
  nodes: { id: string; type: WorkflowNode["type"]; properties?: Record<string, string> }[],
  edges: { from: string; to: string; label?: string }[],
  startNode?: string
): Workflow {
  const nodeMap = new Map<string, WorkflowNode>();
  for (const n of nodes) {
    nodeMap.set(n.id, { id: n.id, type: n.type, properties: n.properties ?? {} });
  }
  return {
    nodes: nodeMap,
    edges,
    startNode: startNode ?? nodes[0]?.id ?? null,
  };
}

// ===================================================================
// parseWorkflowYaml — basic
// ===================================================================

test("parse minimal workflow", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: hello
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.startNode, "a");
  assert.equal(wf.nodes.size, 1);
  const node = wf.nodes.get("a")!;
  assert.equal(node.type, "variable");
  assert.equal(node.properties.name, "x");
  assert.equal(node.properties.value, "hello");
});

test("parse implicit next (sequential nodes)", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
  - id: b
    type: variable
    name: y
    value: "2"
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.edges.length, 1);
  assert.equal(wf.edges[0].from, "a");
  assert.equal(wf.edges[0].to, "b");
});

test("parse explicit next", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
    next: c
  - id: b
    type: variable
    name: y
    value: "2"
  - id: c
    type: variable
    name: z
    value: "3"
`;
  const wf = parseWorkflowYaml(yaml);
  const fromA = wf.edges.filter((e) => e.from === "a");
  assert.equal(fromA.length, 1);
  assert.equal(fromA[0].to, "c");
});

test("parse if node edges", () => {
  const yaml = `
name: test
nodes:
  - id: check
    type: if
    condition: "{{x}} > 0"
    trueNext: yes
    falseNext: no
  - id: yes
    type: variable
    name: r
    value: positive
  - id: no
    type: variable
    name: r
    value: non-positive
`;
  const wf = parseWorkflowYaml(yaml);
  const fromCheck = wf.edges.filter((e) => e.from === "check");
  assert.equal(fromCheck.length, 2);
  assert.ok(fromCheck.some((e) => e.to === "yes" && e.label === "true"));
  assert.ok(fromCheck.some((e) => e.to === "no" && e.label === "false"));
});

test("parse while node edges", () => {
  const yaml = `
name: test
nodes:
  - id: loop
    type: while
    condition: "{{i}} < 10"
    trueNext: body
    falseNext: done
  - id: body
    type: variable
    name: i
    value: "1"
    next: loop
  - id: done
    type: variable
    name: result
    value: finished
`;
  const wf = parseWorkflowYaml(yaml);
  const fromLoop = wf.edges.filter((e) => e.from === "loop");
  assert.equal(fromLoop.length, 2);
  assert.ok(fromLoop.some((e) => e.to === "body" && e.label === "true"));
  assert.ok(fromLoop.some((e) => e.to === "done" && e.label === "false"));
  // body -> loop (back-edge to while)
  const fromBody = wf.edges.filter((e) => e.from === "body");
  assert.equal(fromBody.length, 1);
  assert.equal(fromBody[0].to, "loop");
});

test("parse next: end creates explicit terminator edge", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
    next: end
  - id: b
    type: variable
    name: y
    value: "2"
`;
  const wf = parseWorkflowYaml(yaml);
  const fromA = wf.edges.filter((e) => e.from === "a");
  assert.equal(fromA.length, 1);
  assert.equal(fromA[0].to, "end");
  assert.deepEqual(getNextNodes(wf, "a"), []);
});

test("parse drive-delete node type", () => {
  const yaml = `
name: test
nodes:
  - id: cleanup
    type: drive-delete
    path: "notes/old-file.md"
`;
  const wf = parseWorkflowYaml(yaml);
  const node = wf.nodes.get("cleanup");
  assert.ok(node);
  assert.equal(node!.type, "drive-delete");
  assert.equal(node!.properties.path, "notes/old-file.md");
});

// ===================================================================
// parseWorkflowYaml — DAG convergence (the bug that was fixed)
// ===================================================================

test("DAG convergence: multiple nodes pointing to same target (back-reference in YAML order)", () => {
  // display-greeting appears BEFORE set-morning in YAML order,
  // but set-morning has next: display-greeting. This is a valid DAG, not a loop.
  const yaml = `
name: Greeting
nodes:
  - id: check
    type: if
    condition: "{{hour}} < 12"
    trueNext: set-morning
    falseNext: set-evening
  - id: set-evening
    type: variable
    name: greeting
    value: Good evening
    next: display
  - id: display
    type: dialog
    title: Greeting
    message: "{{greeting}}"
  - id: set-morning
    type: variable
    name: greeting
    value: Good morning
    next: display
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.nodes.size, 4);

  // Both set-evening and set-morning point to display
  const toDisplay = wf.edges.filter((e) => e.to === "display");
  assert.equal(toDisplay.length, 2);
  assert.ok(toDisplay.some((e) => e.from === "set-evening"));
  assert.ok(toDisplay.some((e) => e.from === "set-morning"));
});

test("DAG convergence: real-world greeting workflow from user report", () => {
  const yaml = `
name: Greeting
nodes:
  - id: get-current-time
    type: command
    prompt: 'Please tell me the current time.'
    model: gemini-3-flash-preview
    saveTo: time_json
  - id: parse-time
    type: json
    source: '{{time_json}}'
    path: $
    saveTo: t
  - id: check-early-night
    type: if
    condition: '{{t.hour}} < 4'
    trueNext: set-night
    falseNext: check-morning
  - id: set-night
    type: variable
    name: greeting
    value: Good evening
    next: display-greeting
  - id: check-morning
    type: if
    condition: '{{t.hour}} < 11'
    trueNext: set-morning
    falseNext: check-afternoon
  - id: display-greeting
    type: dialog
    title: Greeting
    message: '{{greeting}}. The current time is {{t.time}}.'
  - id: set-morning
    type: variable
    name: greeting
    value: 'Good morning!'
    next: display-greeting
  - id: check-afternoon
    type: if
    condition: '{{t.hour}} < 18'
    trueNext: set-afternoon
    falseNext: set-night
  - id: set-afternoon
    type: variable
    name: greeting
    value: Good afternoon
    next: display-greeting
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.nodes.size, 9);
  assert.equal(wf.startNode, "get-current-time");

  // display-greeting is referenced by set-night, set-morning, set-afternoon
  const toDisplay = wf.edges.filter((e) => e.to === "display-greeting");
  assert.equal(toDisplay.length, 3);

  // set-night at index 3, display-greeting at index 5, set-morning at index 6
  // set-morning -> display-greeting is a back-reference in YAML order but valid DAG
  const setMorning = wf.nodes.get("set-morning")!;
  assert.equal(setMorning.properties.value, "Good morning!");
});

// ===================================================================
// parseWorkflowYaml — error cases
// ===================================================================

test("error: invalid YAML", () => {
  assert.throws(() => parseWorkflowYaml("not: [valid: yaml: {{"), { message: /.*/ });
});

test("error: missing nodes array", () => {
  assert.throws(() => parseWorkflowYaml("name: test\n"), {
    message: /missing nodes array/,
  });
});

test("error: empty nodes array", () => {
  assert.throws(() => parseWorkflowYaml("name: test\nnodes: []\n"), {
    message: /no nodes/,
  });
});

test("error: if node missing trueNext", () => {
  const yaml = `
name: test
nodes:
  - id: check
    type: if
    condition: "{{x}} > 0"
  - id: a
    type: variable
    name: x
    value: "1"
`;
  assert.throws(() => parseWorkflowYaml(yaml), {
    message: /missing trueNext/,
  });
});

test("error: invalid edge reference to non-existent node", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
    next: nonexistent
`;
  assert.throws(() => parseWorkflowYaml(yaml), {
    message: /Invalid edge reference/,
  });
});

test("skip nodes with invalid type", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
  - id: b
    type: invalidtype
    name: y
    value: "2"
  - id: c
    type: variable
    name: z
    value: "3"
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.nodes.size, 2);
  assert.ok(wf.nodes.has("a"));
  assert.ok(wf.nodes.has("c"));
  assert.ok(!wf.nodes.has("b"));
});

test("duplicate node IDs get suffixed", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
  - id: a
    type: variable
    name: y
    value: "2"
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.nodes.size, 2);
  assert.ok(wf.nodes.has("a"));
  assert.ok(wf.nodes.has("a_2"));
});

test("duplicate node IDs: edges use resolved source IDs", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
  - id: a
    type: variable
    name: y
    value: "2"
    next: c
  - id: c
    type: variable
    name: z
    value: "3"
`;
  const wf = parseWorkflowYaml(yaml);
  assert.ok(wf.edges.some((e) => e.from === "a" && e.to === "a_2"));
  assert.ok(wf.edges.some((e) => e.from === "a_2" && e.to === "c"));
});

// ===================================================================
// parseWorkflowYaml — special characters in values
// ===================================================================

test("values with exclamation mark", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: greeting
    value: 'Good morning!'
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.nodes.get("a")!.properties.value, "Good morning!");
});

test("values with template syntax", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: dialog
    title: Result
    message: '{{greeting}}. Time is {{t.time}}.'
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(
    wf.nodes.get("a")!.properties.message,
    "{{greeting}}. Time is {{t.time}}."
  );
});

test("values with colons and braces (JSON-like)", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: command
    prompt: 'Output JSON: {"key": "value"}'
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(
    wf.nodes.get("a")!.properties.prompt,
    'Output JSON: {"key": "value"}'
  );
});

// ===================================================================
// serializeWorkflow
// ===================================================================

test("serialize minimal workflow", () => {
  const wf = buildWorkflow(
    [{ id: "a", type: "variable", properties: { name: "x", value: "hello" } }],
    [],
    "a"
  );
  const yaml = serializeWorkflow(wf, "test");
  assert.ok(yaml.includes("name: test"));
  assert.ok(yaml.includes("id: a"));
  assert.ok(yaml.includes("type: variable"));
  assert.ok(yaml.includes("value: hello"));
});

test("serialize: BFS-implicit edges do not emit next", () => {
  // a->b->c. BFS: a, b, c. All edges match BFS order → no explicit "next:".
  const wf = buildWorkflow(
    [
      { id: "a", type: "variable", properties: { name: "x", value: "1" } },
      { id: "b", type: "variable", properties: { name: "y", value: "2" } },
      { id: "c", type: "variable", properties: { name: "z", value: "3" } },
    ],
    [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    "a"
  );
  const yaml = serializeWorkflow(wf, "test");
  assert.ok(!yaml.includes("next:"));
});

test("serialize: DAG convergence emits explicit next for back-pointing edge", () => {
  // if -> morning -> display, if -> evening -> display.
  // BFS: if, morning, evening, display. morning->display: display is NOT next (evening is) → explicit.
  const wf = buildWorkflow(
    [
      { id: "check", type: "if", properties: { condition: "{{hour}} < 12" } },
      { id: "morning", type: "variable", properties: { name: "g", value: "AM" } },
      { id: "evening", type: "variable", properties: { name: "g", value: "PM" } },
      { id: "display", type: "dialog", properties: { title: "Hi", message: "{{g}}" } },
    ],
    [
      { from: "check", to: "morning", label: "true" },
      { from: "check", to: "evening", label: "false" },
      { from: "morning", to: "display" },
      { from: "evening", to: "display" },
    ],
    "check"
  );
  const yaml = serializeWorkflow(wf, "test");
  // morning's BFS successor is evening, but edge goes to display → explicit next
  assert.ok(yaml.includes("next: display"));
});

test("serialize omits next when it matches implicit fallthrough", () => {
  const wf = buildWorkflow(
    [
      { id: "a", type: "variable", properties: { name: "x", value: "1" } },
      { id: "b", type: "variable", properties: { name: "y", value: "2" } },
    ],
    [{ from: "a", to: "b" }],
    "a"
  );
  const yaml = serializeWorkflow(wf, "test");
  // a -> b is implicit (b follows a), so "next:" should NOT appear
  assert.ok(!yaml.includes("next:"));
});

test("serialize if node with trueNext and falseNext", () => {
  const wf = buildWorkflow(
    [
      { id: "check", type: "if", properties: { condition: "{{x}} > 0" } },
      { id: "positive", type: "variable", properties: { name: "r", value: "pos" } },
      { id: "negative", type: "variable", properties: { name: "r", value: "neg" } },
    ],
    [
      { from: "check", to: "positive", label: "true" },
      { from: "check", to: "negative", label: "false" },
    ],
    "check"
  );
  const yaml = serializeWorkflow(wf, "test");
  assert.ok(yaml.includes("trueNext: positive"));
  // BFS: check, positive, negative. falseNext=negative matches BFS-next of positive,
  // but falseNext is for check, and nextNodeId for check is positive. negative !== positive → emitted.
  assert.ok(yaml.includes("falseNext: negative"));
});

test("serialize keeps implicit auto-fallthrough for non-conditional nodes", () => {
  const wf = buildWorkflow(
    [
      { id: "a", type: "variable", properties: { name: "x", value: "1" } },
      { id: "b", type: "variable", properties: { name: "y", value: "2" } },
    ],
    [],
    "a"
  );

  const yaml = serializeWorkflow(wf, "auto");
  assert.ok(!yaml.includes("next: end"));

  const wf2 = parseWorkflowYaml(yaml);
  assert.ok(wf2.edges.some((e) => e.from === "a" && e.to === "b"));
});

test("serialize keeps implicit if false fallthrough when false edge is absent", () => {
  const wf = buildWorkflow(
    [
      { id: "check", type: "if", properties: { condition: "{{x}} > 0" } },
      { id: "fallthrough", type: "variable", properties: { name: "r", value: "default" } },
      { id: "yes", type: "variable", properties: { name: "r", value: "positive" } },
    ],
    [{ from: "check", to: "yes", label: "true" }],
    "check"
  );

  const yaml = serializeWorkflow(wf, "auto-if");
  assert.ok(!yaml.includes("falseNext: end"));

  const wf2 = parseWorkflowYaml(yaml);
  assert.ok(wf2.edges.some((e) => e.from === "check" && e.to === "yes" && e.label === "true"));
  assert.ok(wf2.edges.some((e) => e.from === "check" && e.to === "fallthrough" && e.label === "false"));
});

// ===================================================================
// Round-trip: serialize → parse (the core invariant)
// ===================================================================

test("round-trip: simple linear workflow", () => {
  const yaml = `
name: linear
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
  - id: b
    type: variable
    name: y
    value: "2"
  - id: c
    type: variable
    name: z
    value: "3"
`;
  const wf1 = parseWorkflowYaml(yaml);
  const serialized = serializeWorkflow(wf1, "linear");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, wf1.nodes.size);
  assert.equal(wf2.startNode, wf1.startNode);
  assert.equal(wf2.edges.length, wf1.edges.length);
});

test("round-trip: branching if workflow", () => {
  const yaml = `
name: branch
nodes:
  - id: start
    type: variable
    name: x
    value: "10"
  - id: check
    type: if
    condition: "{{x}} > 5"
    trueNext: big
    falseNext: small
  - id: big
    type: variable
    name: result
    value: big
    next: end_node
  - id: small
    type: variable
    name: result
    value: small
    next: end_node
  - id: end_node
    type: dialog
    title: Done
    message: "{{result}}"
`;
  const wf1 = parseWorkflowYaml(yaml);
  const serialized = serializeWorkflow(wf1, "branch");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, wf1.nodes.size);
  assert.equal(wf2.startNode, wf1.startNode);

  // Both big and small should point to end_node
  const toEnd1 = wf1.edges.filter((e) => e.to === "end_node");
  const toEnd2 = wf2.edges.filter((e) => e.to === "end_node");
  assert.equal(toEnd2.length, toEnd1.length);
});

test("round-trip: DAG convergence (multiple branches to same target)", () => {
  const yaml = `
name: Greeting
nodes:
  - id: check
    type: if
    condition: "{{hour}} < 12"
    trueNext: morning
    falseNext: evening
  - id: morning
    type: variable
    name: greeting
    value: Good morning
    next: display
  - id: evening
    type: variable
    name: greeting
    value: Good evening
    next: display
  - id: display
    type: dialog
    title: Greeting
    message: "{{greeting}}"
`;
  const wf1 = parseWorkflowYaml(yaml);
  const serialized = serializeWorkflow(wf1, "Greeting");
  // This must not throw — it was the original bug
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, 4);
  // display should still be reachable from both morning and evening
  const toDisplay = wf2.edges.filter((e) => e.to === "display");
  assert.equal(toDisplay.length, 2);
});

test("round-trip: complex multi-branch DAG with 3 convergent edges", () => {
  // Reproduces the exact greeting workflow from the bug report
  const yaml = `
name: Greeting
nodes:
  - id: get-time
    type: command
    prompt: Get time
    saveTo: time_json
  - id: parse
    type: json
    source: '{{time_json}}'
    path: $
    saveTo: t
  - id: check-night
    type: if
    condition: '{{t.hour}} < 4'
    trueNext: set-night
    falseNext: check-morning
  - id: set-night
    type: variable
    name: greeting
    value: Good evening
    next: display
  - id: check-morning
    type: if
    condition: '{{t.hour}} < 11'
    trueNext: set-morning
    falseNext: check-afternoon
  - id: set-morning
    type: variable
    name: greeting
    value: 'Good morning!'
    next: display
  - id: check-afternoon
    type: if
    condition: '{{t.hour}} < 18'
    trueNext: set-afternoon
    falseNext: set-night
  - id: set-afternoon
    type: variable
    name: greeting
    value: Good afternoon
    next: display
  - id: display
    type: dialog
    title: Greeting
    message: '{{greeting}}'
`;
  const wf1 = parseWorkflowYaml(yaml);

  // Simulate what the UI does: serialize then parse
  const serialized = serializeWorkflow(wf1, "Greeting");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, 9);
  assert.equal(wf2.startNode, "get-time");

  // display should have 3 incoming edges
  const toDisplay = wf2.edges.filter((e) => e.to === "display");
  assert.equal(toDisplay.length, 3);
  const sources = new Set(toDisplay.map((e) => e.from));
  assert.ok(sources.has("set-night"));
  assert.ok(sources.has("set-morning"));
  assert.ok(sources.has("set-afternoon"));

  // Values must survive the round-trip
  assert.equal(wf2.nodes.get("set-morning")!.properties.value, "Good morning!");
});

test("round-trip: while loop", () => {
  const yaml = `
name: loop
nodes:
  - id: init
    type: variable
    name: i
    value: "0"
  - id: loop
    type: while
    condition: '{{i}} < 10'
    trueNext: body
    falseNext: done
  - id: body
    type: set
    expression: '{{i}} + 1'
    saveTo: i
    next: loop
  - id: done
    type: dialog
    title: Done
    message: 'Counted to {{i}}'
`;
  const wf1 = parseWorkflowYaml(yaml);
  const serialized = serializeWorkflow(wf1, "loop");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, 4);
  // body -> loop back-edge must survive
  const bodyEdges = wf2.edges.filter((e) => e.from === "body");
  assert.equal(bodyEdges.length, 1);
  assert.equal(bodyEdges[0].to, "loop");
});

test("round-trip: node property edit preserves other nodes", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: variable
    name: greeting
    value: Hello
  - id: b
    type: dialog
    title: Greeting
    message: '{{greeting}}'
`;
  const wf1 = parseWorkflowYaml(yaml);

  // Simulate editing node a's value (what WorkflowPropsPanel does)
  const nodeA = wf1.nodes.get("a")!;
  const updated: Workflow = {
    ...wf1,
    nodes: new Map(wf1.nodes),
    edges: [...wf1.edges],
  };
  updated.nodes.set("a", {
    ...nodeA,
    properties: { ...nodeA.properties, value: "Hello World!" },
  });

  const serialized = serializeWorkflow(updated, "test");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.get("a")!.properties.value, "Hello World!");
  assert.equal(wf2.nodes.get("b")!.properties.message, "{{greeting}}");
  assert.equal(wf2.edges.length, wf1.edges.length);
});

// ===================================================================
// getNextNodes
// ===================================================================

test("getNextNodes: linear node", () => {
  const wf = buildWorkflow(
    [
      { id: "a", type: "variable" },
      { id: "b", type: "variable" },
    ],
    [{ from: "a", to: "b" }]
  );
  assert.deepEqual(getNextNodes(wf, "a"), ["b"]);
});

test("getNextNodes: if node true branch", () => {
  const wf = buildWorkflow(
    [
      { id: "check", type: "if" },
      { id: "yes", type: "variable" },
      { id: "no", type: "variable" },
    ],
    [
      { from: "check", to: "yes", label: "true" },
      { from: "check", to: "no", label: "false" },
    ]
  );
  assert.deepEqual(getNextNodes(wf, "check", true), ["yes"]);
  assert.deepEqual(getNextNodes(wf, "check", false), ["no"]);
});

test("getNextNodes: non-existent node returns empty", () => {
  const wf = buildWorkflow([{ id: "a", type: "variable" }], []);
  assert.deepEqual(getNextNodes(wf, "nonexistent"), []);
});

test("getNextNodes: terminal node returns empty", () => {
  const wf = buildWorkflow([{ id: "a", type: "variable" }], []);
  assert.deepEqual(getNextNodes(wf, "a"), []);
});

// ===================================================================
// parseWorkflowYaml — options and positions
// ===================================================================

test("parse workflow with options", () => {
  const yaml = `
name: test
options:
  showProgress: true
nodes:
  - id: a
    type: variable
    name: x
    value: "1"
`;
  const wf = parseWorkflowYaml(yaml);
  assert.equal(wf.options?.showProgress, true);
});

test("round-trip preserves positions", () => {
  const wf = buildWorkflow(
    [{ id: "a", type: "variable", properties: { name: "x", value: "1" } }],
    [],
    "a"
  );
  wf.positions = { a: { x: 100, y: 200 } };

  const serialized = serializeWorkflow(wf, "test");
  const wf2 = parseWorkflowYaml(serialized);
  assert.deepEqual(wf2.positions, { a: { x: 100, y: 200 } });
});

// ===================================================================
// if falseNext implicit fallthrough
// ===================================================================

test("if node: implicit falseNext falls through to next node in list", () => {
  const yaml = `
name: test
nodes:
  - id: check
    type: if
    condition: "{{x}} > 0"
    trueNext: yes
  - id: fallthrough
    type: variable
    name: r
    value: default
  - id: yes
    type: variable
    name: r
    value: positive
`;
  const wf = parseWorkflowYaml(yaml);
  const fromCheck = wf.edges.filter((e) => e.from === "check");
  assert.equal(fromCheck.length, 2);
  assert.ok(fromCheck.some((e) => e.to === "yes" && e.label === "true"));
  assert.ok(fromCheck.some((e) => e.to === "fallthrough" && e.label === "false"));
});

// ---------------------------------------------------------------------------
// next: end terminator preservation through round-trip
// ---------------------------------------------------------------------------

test("round-trip: next: end terminator preserved when not last node", () => {
  const yaml = `
name: test
nodes:
  - id: a
    type: command
    prompt: first
  - id: b
    type: command
    prompt: second
    next: end
  - id: c
    type: command
    prompt: third
`;
  const wf1 = parseWorkflowYaml(yaml);
  // b has next: end, so terminator edge is explicit
  assert.equal(wf1.edges.filter((e) => e.from === "b" && e.to === "end").length, 1);
  // a → b edge exists
  assert.ok(wf1.edges.some((e) => e.from === "a" && e.to === "b"));

  const serialized = serializeWorkflow(wf1, "test");
  const wf2 = parseWorkflowYaml(serialized);

  // b terminator should survive round-trip
  assert.equal(wf2.edges.filter((e) => e.from === "b" && e.to === "end").length, 1);
  // a → b should still exist
  assert.ok(wf2.edges.some((e) => e.from === "a" && e.to === "b"));
  // c should have no incoming edge from b
  assert.ok(!wf2.edges.some((e) => e.from === "b" && e.to === "c"));
});

test("round-trip: while loop with falseNext to later node preserves all edges", () => {
  const yaml = `
name: batch
nodes:
  - id: init
    type: variable
    name: counter
    value: '0'
  - id: loop
    type: while
    condition: '{{counter}} < 5'
    trueNext: process
    falseNext: finish
  - id: process
    type: command
    prompt: do work
  - id: inc
    type: set
    name: counter
    value: '{{counter}} + 1'
    next: loop
  - id: finish
    type: command
    prompt: done
    next: save-result
  - id: save-result
    type: drive-file
    path: result.md
    content: '{{result}}'
    open: 'true'
    next: end
`;
  const wf1 = parseWorkflowYaml(yaml);
  assert.equal(wf1.nodes.size, 6);

  // save-result has next: end — explicit terminator edge
  assert.equal(wf1.edges.filter((e) => e.from === "save-result" && e.to === "end").length, 1);

  const serialized = serializeWorkflow(wf1, "batch");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, 6);

  // loop → process (true), loop → finish (false)
  assert.ok(wf2.edges.some((e) => e.from === "loop" && e.to === "process" && e.label === "true"));
  assert.ok(wf2.edges.some((e) => e.from === "loop" && e.to === "finish" && e.label === "false"));

  // inc → loop (explicit back-reference)
  assert.ok(wf2.edges.some((e) => e.from === "inc" && e.to === "loop"));

  // finish → save-result
  assert.ok(wf2.edges.some((e) => e.from === "finish" && e.to === "save-result"));

  // save-result keeps explicit next: end after round-trip
  assert.equal(wf2.edges.filter((e) => e.from === "save-result" && e.to === "end").length, 1);
});

test("round-trip: user-reported tag-batch workflow preserves structure", () => {
  const yaml = `
name: タグ提案バッチ
nodes:
  - id: initCounter
    type: variable
    name: counter
    value: '0'
  - id: initReport
    type: variable
    name: report
    value: '# タグ提案'
  - id: list
    type: drive-list
    folder: discussion
    limit: '5'
    sortBy: modified
    sortOrder: desc
    saveTo: listRaw
  - id: parse
    type: json
    source: listRaw
    saveTo: list
  - id: loop
    type: while
    condition: '{{counter}} < {{list.count}}'
    trueNext: read
    falseNext: finish
  - id: read
    type: drive-read
    path: '{{list.notes[counter].name}}'
    saveTo: content
  - id: tag
    type: command
    prompt: 'タグを提案: {{content}}'
    saveTo: tags
  - id: wait
    type: sleep
    duration: '500'
  - id: append
    type: set
    name: report
    value: '{{report}} ## {{list.notes[counter].name}}'
  - id: inc
    type: set
    name: counter
    value: '{{counter}} + 1'
    next: loop
  - id: finish
    type: drive-file
    path: reports/tag-suggestions.md
    content: '{{report}}'
    open: 'true'
`;
  const wf1 = parseWorkflowYaml(yaml);
  assert.equal(wf1.nodes.size, 11);

  // Key structural checks on original
  assert.ok(wf1.edges.some((e) => e.from === "loop" && e.to === "read" && e.label === "true"));
  assert.ok(wf1.edges.some((e) => e.from === "loop" && e.to === "finish" && e.label === "false"));
  assert.ok(wf1.edges.some((e) => e.from === "inc" && e.to === "loop"));
  // finish is the last node — no outgoing edge
  assert.equal(wf1.edges.filter((e) => e.from === "finish").length, 0);
  // finish has open property
  assert.equal(wf1.nodes.get("finish")!.properties.open, "true");

  // Round-trip
  const serialized = serializeWorkflow(wf1, "タグ提案バッチ");
  const wf2 = parseWorkflowYaml(serialized);

  assert.equal(wf2.nodes.size, 11);

  // All edges must be preserved
  assert.ok(wf2.edges.some((e) => e.from === "loop" && e.to === "read" && e.label === "true"));
  assert.ok(wf2.edges.some((e) => e.from === "loop" && e.to === "finish" && e.label === "false"));
  assert.ok(wf2.edges.some((e) => e.from === "inc" && e.to === "loop"));
  assert.equal(wf2.edges.filter((e) => e.from === "finish").length, 0);

  // Sequential chain: read → tag → wait → append → inc
  assert.ok(wf2.edges.some((e) => e.from === "read" && e.to === "tag"));
  assert.ok(wf2.edges.some((e) => e.from === "tag" && e.to === "wait"));
  assert.ok(wf2.edges.some((e) => e.from === "wait" && e.to === "append"));
  assert.ok(wf2.edges.some((e) => e.from === "append" && e.to === "inc"));

  // Simulate property edit: change folder value
  const listNode = wf2.nodes.get("list")!;
  const editedNode: WorkflowNode = {
    ...listNode,
    properties: { ...listNode.properties, folder: "corrected-folder" },
  };
  const wf3: Workflow = {
    ...wf2,
    nodes: new Map(wf2.nodes),
    edges: [...wf2.edges],
  };
  wf3.nodes.set("list", editedNode);

  // Second round-trip after edit
  const serialized2 = serializeWorkflow(wf3, "タグ提案バッチ");
  const wf4 = parseWorkflowYaml(serialized2);

  assert.equal(wf4.nodes.size, 11);
  assert.equal(wf4.nodes.get("list")!.properties.folder, "corrected-folder");

  // Structure must still be intact
  assert.ok(wf4.edges.some((e) => e.from === "loop" && e.to === "read" && e.label === "true"));
  assert.ok(wf4.edges.some((e) => e.from === "loop" && e.to === "finish" && e.label === "false"));
  assert.ok(wf4.edges.some((e) => e.from === "inc" && e.to === "loop"));
  assert.equal(wf4.edges.filter((e) => e.from === "finish").length, 0);
});
