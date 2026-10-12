import assert from "node:assert/strict";
import test from "node:test";
import { collectKakerattaAnswer } from "./kakeratta-chat";

test("collects split SSE frames and ignores thinking/tool output", async () => {
  const raw = 'data: {"type":"thinking","content":"secret"}\n\ndata: {"type":"text","content":"{\\"type\\": "}\n\ndata: {"type":"text","content":"\\"answer\\"}"}\n\ndata: {"type":"done"}\n\n';
  const stream = new ReadableStream({ start(controller) {
    const bytes = new TextEncoder().encode(raw);
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } });
  assert.equal(await collectKakerattaAnswer(new Response(stream), new AbortController().signal), '{"type": "answer"}');
});

test("partial generation errors cannot be submitted as answers", async () => {
  const response = new Response('data: {"type":"text","content":"partial"}\n\ndata: {"type":"error","error":"provider failed"}\n\n');
  await assert.rejects(collectKakerattaAnswer(response, new AbortController().signal), /generation failed/);
});

test("abort cancels a hung response reader", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const collecting = collectKakerattaAnswer(response, controller.signal);
  controller.abort();
  await assert.rejects(collecting, /turn stopped/);
  assert.equal(cancelled, true);
});

test("an interrupted stream without done is rejected even if its text looks valid", async () => {
  await assert.rejects(collectKakerattaAnswer(new Response('data: {"type":"text","content":"{}"}\n\n'), new AbortController().signal), /incomplete answer/);
});
