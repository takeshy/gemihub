import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replaceVariables, getNestedValue, evaluateCondition, parseCondition } from "./utils";
import type { ExecutionContext } from "../types";

function makeContext(vars: Record<string, string | number>): ExecutionContext {
  return { variables: new Map(Object.entries(vars)), logs: [] };
}

// ---------------------------------------------------------------------------
// replaceVariables
// ---------------------------------------------------------------------------

describe("replaceVariables", () => {
  it("replaces a simple variable", () => {
    const ctx = makeContext({ name: "world" });
    assert.equal(replaceVariables("Hello {{name}}!", ctx), "Hello world!");
  });

  it("returns original when variable is undefined", () => {
    const ctx = makeContext({});
    assert.equal(replaceVariables("{{missing}}", ctx), "{{missing}}");
  });

  it("replaces a numeric variable", () => {
    const ctx = makeContext({ count: 42 });
    assert.equal(replaceVariables("count={{count}}", ctx), "count=42");
  });

  it("replaces multiple variables in one template", () => {
    const ctx = makeContext({ a: "X", b: "Y" });
    assert.equal(replaceVariables("{{a}}-{{b}}", ctx), "X-Y");
  });

  // Dot-notation access into JSON
  it("resolves dot-notation path into JSON value", () => {
    const ctx = makeContext({
      obj: JSON.stringify({ name: "Alice", age: 30 }),
    });
    assert.equal(replaceVariables("{{obj.name}}", ctx), "Alice");
    assert.equal(replaceVariables("{{obj.age}}", ctx), "30");
  });

  it("resolves deeply nested path", () => {
    const ctx = makeContext({
      data: JSON.stringify({ a: { b: { c: "deep" } } }),
    });
    assert.equal(replaceVariables("{{data.a.b.c}}", ctx), "deep");
  });

  // The core bug fix: JSON values containing triple-backticks
  it("resolves dot-notation when JSON data field contains triple backticks", () => {
    const fileContent = "# Title\n\nSome text\n\n```python\nprint('hello')\n```\n\nMore text";
    const explorerData = {
      id: "abc123",
      path: "myfile.md",
      basename: "myfile.md",
      name: "myfile",
      extension: "md",
      data: fileContent,
    };
    const ctx = makeContext({
      fileData: JSON.stringify(explorerData),
    });

    assert.equal(replaceVariables("{{fileData.basename}}", ctx), "myfile.md");
    assert.equal(replaceVariables("{{fileData.name}}", ctx), "myfile");
    assert.equal(replaceVariables("{{fileData.data}}", ctx), fileContent);
  });

  it("resolves dot-notation when JSON data contains ```json code block", () => {
    const fileContent = 'Example:\n\n```json\n{"key": "value"}\n```\n\nEnd';
    const ctx = makeContext({
      fileData: JSON.stringify({ data: fileContent, basename: "doc.md" }),
    });

    assert.equal(replaceVariables("{{fileData.data}}", ctx), fileContent);
    assert.equal(replaceVariables("{{fileData.basename}}", ctx), "doc.md");
  });

  it("resolves dot-notation when JSON data contains multiple code blocks", () => {
    const fileContent = "```js\nconsole.log(1)\n```\n\n```python\nprint(2)\n```";
    const ctx = makeContext({
      fileData: JSON.stringify({ data: fileContent }),
    });

    assert.equal(replaceVariables("{{fileData.data}}", ctx), fileContent);
  });

  // Code-block fallback still works for LLM-wrapped JSON
  it("extracts JSON from code-block-wrapped LLM output", () => {
    const llmOutput = 'Here is the result:\n```json\n{"name":"Bob","score":99}\n```';
    const ctx = makeContext({ result: llmOutput });

    assert.equal(replaceVariables("{{result.name}}", ctx), "Bob");
    assert.equal(replaceVariables("{{result.score}}", ctx), "99");
  });

  it("returns original when value is not valid JSON and has no code block", () => {
    const ctx = makeContext({ text: "just plain text" });
    assert.equal(replaceVariables("{{text.field}}", ctx), "{{text.field}}");
  });

  // Array access
  it("resolves array index access", () => {
    const ctx = makeContext({
      items: JSON.stringify(["a", "b", "c"]),
    });
    assert.equal(replaceVariables("{{items[0]}}", ctx), "a");
    assert.equal(replaceVariables("{{items[2]}}", ctx), "c");
  });

  it("resolves array index with nested field", () => {
    const ctx = makeContext({
      list: JSON.stringify([{ name: "first" }, { name: "second" }]),
    });
    assert.equal(replaceVariables("{{list[0].name}}", ctx), "first");
    assert.equal(replaceVariables("{{list[1].name}}", ctx), "second");
  });

  it("resolves array index using variable", () => {
    const ctx = makeContext({
      items: JSON.stringify(["x", "y", "z"]),
      idx: 1,
    });
    assert.equal(replaceVariables("{{items[idx]}}", ctx), "y");
  });

  // :json modifier
  it("applies :json modifier to escape strings", () => {
    const ctx = makeContext({ text: 'line1\nline2\t"quoted"' });
    const result = replaceVariables("{{text:json}}", ctx);
    assert.equal(result, 'line1\\nline2\\t\\"quoted\\"');
  });

  // Iterative expansion
  it("iteratively expands nested variable references", () => {
    const ctx = makeContext({ a: "{{b}}", b: "final" });
    assert.equal(replaceVariables("{{a}}", ctx), "final");
  });

  // Object output as JSON string
  it("returns nested object as JSON string", () => {
    const ctx = makeContext({
      data: JSON.stringify({ nested: { x: 1, y: 2 } }),
    });
    assert.equal(replaceVariables("{{data.nested}}", ctx), '{"x":1,"y":2}');
  });
});

// ---------------------------------------------------------------------------
// getNestedValue
// ---------------------------------------------------------------------------

describe("getNestedValue", () => {
  it("gets a simple property", () => {
    assert.equal(getNestedValue({ a: 1 }, "a"), 1);
  });

  it("gets a nested property", () => {
    assert.equal(getNestedValue({ a: { b: { c: "val" } } }, "a.b.c"), "val");
  });

  it("returns undefined for missing path", () => {
    assert.equal(getNestedValue({ a: 1 }, "b"), undefined);
  });

  it("returns undefined for null intermediate", () => {
    assert.equal(getNestedValue({ a: null }, "a.b"), undefined);
  });

  it("handles array index notation", () => {
    assert.equal(getNestedValue({ items: ["x", "y"] }, "items[0]"), "x");
    assert.equal(getNestedValue({ items: ["x", "y"] }, "items[1]"), "y");
  });

  it("handles array index with variable from context", () => {
    const ctx = makeContext({ i: 1 });
    assert.equal(getNestedValue({ items: ["a", "b", "c"] }, "items[i]", ctx), "b");
  });
});

// ---------------------------------------------------------------------------
// parseCondition / evaluateCondition
// ---------------------------------------------------------------------------

describe("parseCondition", () => {
  it("parses == condition", () => {
    const result = parseCondition("x == 1");
    assert.deepEqual(result, { left: "x", operator: "==", right: "1" });
  });

  it("parses != condition", () => {
    const result = parseCondition("a != b");
    assert.deepEqual(result, { left: "a", operator: "!=", right: "b" });
  });

  it("parses contains condition", () => {
    const result = parseCondition("list contains item");
    assert.deepEqual(result, { left: "list", operator: "contains", right: "item" });
  });

  it("returns null for invalid condition", () => {
    assert.equal(parseCondition("no operator here"), null);
  });
});

describe("evaluateCondition", () => {
  it("evaluates == with numbers", () => {
    const ctx = makeContext({});
    assert.equal(evaluateCondition({ left: "5", operator: "==", right: "5" }, ctx), true);
    assert.equal(evaluateCondition({ left: "5", operator: "==", right: "6" }, ctx), false);
  });

  it("evaluates == with strings", () => {
    const ctx = makeContext({});
    assert.equal(evaluateCondition({ left: "abc", operator: "==", right: "abc" }, ctx), true);
    assert.equal(evaluateCondition({ left: "abc", operator: "==", right: "def" }, ctx), false);
  });

  it("evaluates < and > with numbers", () => {
    const ctx = makeContext({});
    assert.equal(evaluateCondition({ left: "3", operator: "<", right: "5" }, ctx), true);
    assert.equal(evaluateCondition({ left: "5", operator: ">", right: "3" }, ctx), true);
  });

  it("evaluates contains with array JSON", () => {
    const ctx = makeContext({});
    assert.equal(
      evaluateCondition({ left: '["a","b","c"]', operator: "contains", right: "b" }, ctx),
      true
    );
    assert.equal(
      evaluateCondition({ left: '["a","b","c"]', operator: "contains", right: "d" }, ctx),
      false
    );
  });

  it("evaluates contains with string", () => {
    const ctx = makeContext({});
    assert.equal(
      evaluateCondition({ left: "hello world", operator: "contains", right: "world" }, ctx),
      true
    );
  });

  it("replaces variables in condition values", () => {
    const ctx = makeContext({ x: "10", y: "10" });
    assert.equal(
      evaluateCondition({ left: "{{x}}", operator: "==", right: "{{y}}" }, ctx),
      true
    );
  });
});
