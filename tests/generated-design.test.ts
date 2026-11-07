import assert from "node:assert/strict";
import { test } from "node:test";
import postcss from "postcss";
import { z } from "zod";
import { compactGeneratedStyles, generateValidatedDesign } from "../server/generated-design.ts";
import { presentationCssLimit } from "../shared/presentation.ts";

const schema = z.object({ appearance: z.object({ theme: z.object({ css: z.string().max(presentationCssLimit) }) }), name: z.string() });
const value = (css: string) => ({ appearance: { theme: { css } }, name: "Keep the shop name" });
const input = { system: "Revise only the requested appearance.", contents: [{ role: "user", parts: [{ text: "Keep the logo and make the menu readable." }, { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] }], schema: schema.toJSONSchema() };
const oversized = ':root{--long:"' + "x".repeat(presentationCssLimit) + '"}';

test("oversized generated CSS compacts without changing selectors, values, custom properties or cascade order", () => {
  const css = `/* ${"formatting ".repeat(1300)} */
  :root { --space:  12px  ; --message: "a ; b /* literal text */"; }
  .card .title, .other > span { width: calc(100% - var(--space)); content: "keep  two spaces"; color: red !important; }
  @media (max-width: 600px) { .card { display: grid; gap: 10px; } }
  @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }`;
  const before = value(css);
  const after = schema.parse(compactGeneratedStyles(before));
  const structure = (css: string) => {
    const nodes: unknown[] = [];
    postcss.parse(css).walk(node => {
      if (node.type === "rule") nodes.push([node.type, node.selector]);
      if (node.type === "atrule") nodes.push([node.type, node.name, node.params]);
      if (node.type === "decl") nodes.push([node.type, node.prop, node.value, node.important]);
    });
    return nodes;
  };
  assert.ok(after.appearance.theme.css.length < presentationCssLimit);
  assert.deepEqual(structure(after.appearance.theme.css), structure(css));
  assert.equal(before.appearance.theme.css, css, "the input remains unchanged");
  const short = value('.x { content: "keep whitespace"; }');
  assert.deepEqual(compactGeneratedStyles(short), short);
});

test("format-only oversize is fixed without another model call", async () => {
  let calls = 0;
  const result = await generateValidatedDesign(input, data => schema.parse(data), async () => {
    calls++;
    return JSON.stringify(value(`/* ${"padding".repeat(2000)} */ .x { color: red; }`));
  });
  assert.equal(calls, 1);
  assert.equal(result.appearance.theme.css, ".x{color:red;}");
});

test("a CSS size failure repairs the previous response with the original request and images", async () => {
  let calls = 0;
  const result = await generateValidatedDesign(input, data => schema.parse(data), async request => {
    calls++;
    assert.deepEqual(request.contents[0], input.contents[0]);
    assert.match(request.system, /12000 characters/);
    if (calls === 1) return JSON.stringify(value(oversized));
    assert.equal(request.contents.length, 2);
    const repair = JSON.parse(request.contents[1].parts![1].text!);
    assert.equal(repair.previousResponse.name, "Keep the shop name");
    assert.equal(repair.previousResponse.appearance.theme.css, oversized);
    assert.deepEqual(repair.issues, [{ path: "appearance.theme.css", maximum: 12000 }]);
    assert.match(request.contents[1].parts![0].text!, /without applying the original edit again/);
    return JSON.stringify({ ...value(".x{color:blue}"), name: "Unrequested replacement" });
  });
  assert.equal(calls, 2);
  assert.equal(result.name, "Keep the shop name");
});

test("repeated oversize stops after two repairs with a readable retry error", async () => {
  let calls = 0;
  await assert.rejects(generateValidatedDesign(input, data => schema.parse(data), async () => {
    calls++;
    return JSON.stringify(value(oversized));
  }), error => {
    assert.equal((error as { status: number }).status, 422);
    assert.match((error as Error).message, /依頼の内容は保持/);
    assert.doesNotMatch((error as Error).message, /appearance\.theme|Too big/);
    return true;
  });
  assert.equal(calls, 3);
});

test("other validation errors remain failures without extra generation", async () => {
  let calls = 0;
  await assert.rejects(generateValidatedDesign(input, data => schema.parse(data), async () => {
    calls++;
    return JSON.stringify({ ...value(""), name: 123 });
  }), z.ZodError);
  assert.equal(calls, 1);
});
