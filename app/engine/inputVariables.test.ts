import assert from "node:assert/strict";
import test from "node:test";
import { extractInputVariables } from "./inputVariables";

test("a value-less variable node declares an input", () => {
  const yaml = `name: spanish
nodes:
  - id: input-text
    type: variable
    name: textToTranslate
  - id: translate
    type: command
    prompt: "Translate {{textToTranslate}}"
    saveTo: translationResult
`;
  assert.deepEqual(extractInputVariables(yaml), ["textToTranslate"]);
});

test("a variable node with a value initializes the variable", () => {
  const yaml = `name: w
nodes:
  - id: a
    type: variable
    name: greeting
    value: hello
  - id: b
    type: command
    prompt: "{{greeting}} {{name}}"
    saveTo: out
`;
  assert.deepEqual(extractInputVariables(yaml), ["name"]);
});

test("a value-less accumulator written by set is not an input", () => {
  const yaml = `name: w
nodes:
  - id: a
    type: variable
    name: log
  - id: b
    type: set
    name: log
    value: "{{log}} x"
`;
  assert.deepEqual(extractInputVariables(yaml), []);
});
