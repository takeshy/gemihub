import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { propose } from "../server/ai.ts";
import { sample, shopSchema } from "../server/domain.ts";
import { setOpenAiClient, setProviderResolver } from "../server/llm.ts";

test("shop proposals use a manageable generation schema and preserve existing settings", async t => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "test-model";
  setProviderResolver(async () => "openai");
  t.after(() => { setOpenAiClient(undefined); setProviderResolver(async () => "vertex"); });
  const current = structuredClone(sample);
  current.pages = [{ id: "faq", slug: "faq", title: "FAQ", navigationLabel: "FAQ", body: "Questions", layout: "standard", imageUrl: "" }];
  current.rules.payment = { enabled: true, refundTiers: [{ hoursBefore: 72, percent: 100 }, { hoursBefore: 0, percent: 0 }] };
  const next = structuredClone(current);
  next.hours.closedWeekdays = [2, 3];
  let calls = 0;
  setOpenAiClient({ responses: { create: async (body: { text: { format: { schema: object } } }) => {
    calls++;
    const schema = body.text.format.schema;
    // Regression for the full proposal schema rejected by Vertex: nested array bounds
    // must not reach the grammar compiler, while item types and other constraints stay.
    const encoded = JSON.stringify(schema);
    assert.doesNotMatch(encoded, /"(?:minItems|maxItems)":/);
    assert.match(encoded, /At most 50 items\./);
    assert.match(encoded, /At least 1 items\./);
    assert.match(encoded, /"minimum":15/);
    assert.match(encoded, /"pattern":/);
    return { output_text: JSON.stringify({ config: next }), output: [] };
  } } } as unknown as OpenAI);
  const result = await propose("水曜日も休みにしてください", current, "owner@example.com");
  assert.equal(calls, 1);
  assert.deepEqual(result.config, next);
  assert.deepEqual(current.hours.closedWeekdays, [2]);
  assert.ok(result.summary.length);
  const menusSchema = shopSchema.toJSONSchema().properties!.menus;
  assert.ok(menusSchema && typeof menusSchema === "object");
  assert.equal(menusSchema.maxItems, 50, "domain validation schema retains its limits");
});

test("relaxed generation cannot bypass array limits or shop validation", async t => {
  process.env.OPENAI_API_KEY = "test";
  process.env.OPENAI_MODEL = "test-model";
  setProviderResolver(async () => "openai");
  t.after(() => { setOpenAiClient(undefined); setProviderResolver(async () => "vertex"); });
  const invalid = [
    { ...structuredClone(sample), menus: [] },
    { ...structuredClone(sample), staff: [] },
    { ...structuredClone(sample), menus: Array.from({ length: 51 }, (_, i) => ({ ...sample.menus[0], id: `menu-${i}` })) },
    { ...structuredClone(sample), rules: { ...sample.rules, payment: { enabled: true, refundTiers: [] } } },
    { ...structuredClone(sample), hours: { ...sample.hours, end: "09:00" } },
  ];
  for (const config of invalid) {
    setOpenAiClient({ responses: { create: async () => ({ output_text: JSON.stringify({ config }), output: [] }) } } as unknown as OpenAI);
    await assert.rejects(propose("変更してください", sample, "owner@example.com"), error => error instanceof Error && error.name === "ZodError");
  }
});
