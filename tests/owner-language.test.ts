import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { explainSystem, identifyVisual } from "../server/ai.ts";
import { conversationInstruction, research } from "../server/assistant.ts";
import { mergePageWithAI } from "../server/page-ai.ts";
import { sample, documents } from "../server/domain.ts";
import { setOpenAiClient, setProviderResolver } from "../server/llm.ts";

test("owner-facing chat, target explanations, research, page merge and voice all request beginner-friendly language", async t => {
  const old = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
  process.env.OPENAI_API_KEY = "test";process.env.OPENAI_MODEL = "test";
  t.after(() => { setOpenAiClient(undefined);setProviderResolver(async () => "vertex");for (const [key, value] of [["OPENAI_API_KEY", old.key], ["OPENAI_MODEL", old.model]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } });
  setProviderResolver(async () => "openai");
  const requests: string[] = [];
  const replies = [
    { answer: "パソコンでは、画面上部のメニューを1行に並べる案です。", ready: true, changeRequest: true },
    { ids: ["part:header"], explanation: "画面上部のメニューを1行に並べます。" },
    { answer: "パソコンではメニューを1行に並べる設定です。", sources: ["spec.md"] },
    { value: null, explanation: "どちらで変更した内容も残す案です。" },
  ];
  setOpenAiClient({ responses: { create: async (body: { instructions: string }) => {
    requests.push(body.instructions);
    return { output_text: JSON.stringify(replies.shift()), output: [] };
  } } } as unknown as OpenAI);
  const result = await explainSystem("パソコンではメニューを1行に並べたい", sample, false);
  assert.match(result.answer, /メニューを1行/);
  await identifyVisual({ mimeType: "image/png", data: "aGVsbG8=" }, [{ id: "part:header", label: "Header navigation" }], "Make the menu one line");
  await research("メニューの表示を教えて", { today: "2026-11-07", documents: documents(sample, []), records: async () => [] });
  await mergePageWithAI({ baseline: null, local: null, remote: null, kind: "page" });
  for (const instruction of [...requests, conversationInstruction(true), conversationInstruction(false)]) {
    assert.match(instruction, /beginner with no programming knowledge/);
    assert.match(instruction, /Do not show CSS selectors, class names/);
    assert.match(instruction, /does not alter the code or structured config fields/);
  }
  assert.doesNotMatch(requests[2], /回答では根拠の設定項目（例：rules\.payment\.refundTiers）/);
});
