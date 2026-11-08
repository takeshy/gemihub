import assert from "node:assert/strict";
import { test } from "node:test";
import type OpenAI from "openai";
import { generateJson, generateWithTools, setOpenAiClient, setProviderResolver, withAiDeadline, currentAiSignal } from "../server/llm.ts";
import { proposeVisualAppearance } from "../server/visual.ts";
import { sample } from "../server/domain.ts";
import { standardTheme } from "../shared/theme-editing.ts";
import { sharedThemeCss } from "../shared/theme-styles.ts";

test("a stalled icon edit retries once in time for rendered review", { timeout: 5000 }, async t => {
  const key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test";process.env.OPENAI_MODEL = "test-model";
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL = model;
    setOpenAiClient(undefined);setProviderResolver(async () => "vertex");
  });
  setProviderResolver(async () => "openai");
  const signals: AbortSignal[] = [];
  setOpenAiClient({ responses: { create: async (_body: unknown, options: { signal: AbortSignal }) => {
    signals.push(options.signal);
    if (signals.length === 1) return new Promise(() => {});
    return { output_text: JSON.stringify({ cssEdits: [{ field: "css", selector: ".icon", declarations: [{ property: "color", value: "#008000" }] }] }), output: [] };
  } } } as unknown as OpenAI);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const before = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme: { ...standardTheme, css: ".icon{color:red}" } } };
  const pending = withAiDeadline(120000, async () => {
    const result = await proposeVisualAppearance(before, "Make the icon green", [], { target: "component:icons" });
    assert.equal(currentAiSignal()!.aborted, false, "the operation still has time for review");
    return result;
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(signals.length, 1);
  t.mock.timers.tick(30001);
  const result = await pending;
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  assert.match(sharedThemeCss(result.config.appearance!.theme!), /#008000/);
  assert.deepEqual({ ...result.config, appearance: before.appearance }, before);
});

test("model deadlines recover from providers that ignore cancellation and stop after one retry", { timeout: 5000 }, async t => {
  const key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model";
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = model;
  });
  setProviderResolver(async () => "openai");
  t.after(() => { setOpenAiClient(undefined); setProviderResolver(async () => "vertex"); });
  const input = { system: "Return JSON", contents: [], schema: { type: "object" }, timeoutMs: 10 };
  const signals: AbortSignal[] = [];
  setOpenAiClient({ responses: { create: async (_body: unknown, options: { signal: AbortSignal; maxRetries: number }) => {
    assert.equal(options.maxRetries, 0);
    signals.push(options.signal);
    if (signals.length === 1) return new Promise(() => {});
    return { output_text: '{"ok":true}', output: [] };
  } } } as unknown as OpenAI);
  assert.equal(await generateJson(input), '{"ok":true}');
  assert.equal(signals.length, 2);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);

  for (const generate of [() => generateJson(input), () => generateWithTools({ ...input, tools: [] })]) {
    signals.length = 0;
    setOpenAiClient({ responses: { create: async (_body: unknown, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return new Promise(() => {});
    } } } as unknown as OpenAI);
    await assert.rejects(generate(), (error: Error & { status?: number }) => error.status === 504);
    assert.equal(signals.length, 2);
    assert.equal(signals.every(signal => signal.aborted), true);
  }
});

test("model deadlines preserve ordinary provider errors without retrying", async t => {
  const key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test"; process.env.OPENAI_MODEL = "test-model";
  t.after(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
    if (model === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = model;
  });
  setProviderResolver(async () => "openai");
  t.after(() => { setOpenAiClient(undefined); setProviderResolver(async () => "vertex"); });
  let calls = 0;
  const error = new Error("Provider unavailable");
  setOpenAiClient({ responses: { create: async () => { calls++; throw error; } } } as unknown as OpenAI);
  await assert.rejects(generateJson({ system: "", contents: [], schema: {}, timeoutMs: 1000 }), error);
  assert.equal(calls, 1);
});

test("a visual operation budget aborts unbounded model calls and is shared across stages", { timeout: 5000 }, async t => {
  const key=process.env.OPENAI_API_KEY,model=process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY="test";process.env.OPENAI_MODEL="test-model";
  t.after(()=>{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model;setOpenAiClient(undefined);setProviderResolver(async()=>"vertex");});
  setProviderResolver(async()=>"openai");
  const signals:AbortSignal[]=[];
  setOpenAiClient({responses:{create:async(_body:unknown,options:{signal:AbortSignal;maxRetries:number})=>{assert.equal(options.maxRetries,0);signals.push(options.signal);return new Promise(()=>{});}}} as unknown as OpenAI);
  await assert.rejects(withAiDeadline(25,()=>generateJson({system:"",contents:[],schema:{}})),{status:504});
  assert.equal(signals.length,1,"a missing per-call timeout must not enable SDK retries beyond the operation budget");assert.equal(signals[0].aborted,true);
  let aborted=false,stages=0;
  await assert.rejects(withAiDeadline(40,async()=>{
    currentAiSignal()!.addEventListener("abort",()=>{aborted=true;},{once:true});
    for(let index=0;index<10;index++){await new Promise(resolve=>setTimeout(resolve,15));stages++;if(currentAiSignal()!.aborted)break;}
  }),{status:504});
  assert.equal(aborted,true);assert.ok(stages<10);
  let nested:AbortSignal|undefined;
  await assert.rejects(withAiDeadline(15,()=>withAiDeadline(100,async()=>{nested=currentAiSignal();return new Promise(()=>{});})),{status:504});
  assert.equal(nested?.aborted,true,"a nested stage cannot extend the parent budget");
  assert.equal(await withAiDeadline(100,async()=>"complete"),"complete");assert.equal(currentAiSignal(),undefined,"the budget does not leak into unrelated requests");
});
