import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { propose } from "../server/ai.ts";
import { sample, shopSchema } from "../server/domain.ts";
import { setOpenAiClient, setProviderResolver } from "../server/llm.ts";
import { standardTheme } from "../shared/theme-editing.ts";

test("AI shop edits repair oversized theme CSS without losing current facts or repeating the edit", async t => {
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model";
  setProviderResolver(async () => "openai");
  t.after(() => { setOpenAiClient(undefined); setProviderResolver(async () => "vertex"); });
  const current = structuredClone(sample);
  current.appearance = { accent: "sage", layout: "standard", imageUrl: "", theme: structuredClone(standardTheme) };
  const before = structuredClone(current);
  let calls = 0;
  setOpenAiClient({ responses: { create: async (body: { input: unknown }) => {
    calls++;
    if (calls > 1) assert.match(JSON.stringify(body.input), /without applying the original edit again/);
    return { output_text: JSON.stringify({ config: { ...(calls > 1 ? { header: { title: "Unrequested replacement" }, menus: [] } : {}), appearance: { theme: { css: calls === 1 ? ':root{--large:"' + "x".repeat(12000) + '"}' : '.public-nav{gap:24px}' } } } }), output: [] };
  } } } as unknown as OpenAI);
  const result = await propose("メニューの間隔を少し広げて", current, "owner@example.com");
  assert.equal(calls, 2);
  assert.equal(result.config.appearance?.theme?.css, ".public-nav{gap:24px}");
  assert.deepEqual(result.config.rules, current.rules);
  assert.deepEqual(result.config.menus, current.menus);
  assert.equal(result.config.header.title, current.header.title);
  assert.deepEqual(current, before);
});

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
    { ...structuredClone(sample), staff: Array.from({ length: 31 }, (_, i) => ({ ...sample.staff[0], id: `staff-${i}` })) },
    { ...structuredClone(sample), menus: Array.from({ length: 51 }, (_, i) => ({ ...sample.menus[0], id: `menu-${i}` })) },
    { ...structuredClone(sample), rules: { ...sample.rules, payment: { enabled: true, refundTiers: [] } } },
    { ...structuredClone(sample), hours: { ...sample.hours, end: "09:00" } },
  ];
  for (const config of invalid) {
    setOpenAiClient({ responses: { create: async () => ({ output_text: JSON.stringify({ config }), output: [] }) } } as unknown as OpenAI);
    await assert.rejects(propose("変更してください", sample, "owner@example.com"), error => error instanceof Error && error.name === "ZodError");
  }
});

test("initial GPT proposals accept interview facts without requesting full booking settings or a theme", async t => {
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model";
  setProviderResolver(async () => "openai");
  t.after(() => { setOpenAiClient(undefined); setProviderResolver(async () => "vertex"); });
  const theme = { headerHtml: '<header><slot name="title"></slot><slot name="navigation"></slot></header>', bodyHtml: '<main><slot name="content"></slot></main>', footerHtml: '<footer><slot name="content"></slot></footer>', css: 'header{background:#234;color:white;padding:24px}' };
  let calls = 0;
  setOpenAiClient({ responses: { create: async (body: { text: { format: { schema: object } } }) => {
    calls++;
    if (calls === 1) {
      assert.doesNotMatch(JSON.stringify(body.text.format.schema), /"(?:menus|staff|hours|rules|appearance|headerHtml)":/);
      // Reproduce the production response: partial config, with layout/image and
      // theme fields intended for another stage. No backend setting is supplied.
      return { output_text: JSON.stringify({ config: { name: "Wrong name", industry: "hair", appearance: { theme: { html: "unreviewed" } }, pages: [{ id: "faq", slug: "faq", title: "FAQ", navigationLabel: "FAQ", body: "## FAQ", layout: "grid" }] } }), output: [] };
    }
    return { output_text: JSON.stringify(calls === 2 ? theme : { approved: true, issues: [], imageUsage: [] }), output: [] };
  } } } as unknown as OpenAI);
  const result = await propose("A hair salon named Moon Atelier, with a FAQ", null, "owner@example.com", false, [], { country: "US", timeZone: "America/New_York" }, { shopName: "Moon Atelier" });
  assert.equal(calls, 3);assert.equal(result.config.name, "Moon Atelier");
  assert.equal(result.config.description, "");assert.equal(result.config.address, "");
  assert.equal(result.config.pages[0].layout, "standard");assert.equal(result.config.pages[0].imageUrl, "");
  assert.deepEqual(result.config.appearance!.theme, theme);assert.equal(result.themeReview!.approved, true);
  assert.equal(result.config.menus[0].price, Math.round(sample.menus[0].price / 100));
  assert.deepEqual(result.config.staff, []);assert.equal(result.config.ownerBooking, true);assert.deepEqual(result.config.rules, sample.rules);
  assert.ok(shopSchema.safeParse(result.config).success);
});
