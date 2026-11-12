import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";

type Call = { provider: string; model: string; stage: string; timeoutMs?: number };
type Event = Call & { event: "ai_model_call"; id: string; at: string; state: "started" | "finished" | "failed"; durationMs?: number; status?: number };
async function writeEvent(event: Event) {
  if (process.env.NODE_TEST_CONTEXT) return;
  const line = JSON.stringify(event);
  console.info(line);
  // Local watch-mode restarts discard in-memory progress and terminal history.
  if (process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true") {
    await mkdir("tmp", { recursive: true });
    await appendFile("tmp/ai-requests.ndjson", line + "\n", { mode: 0o600 });
  }
}

/** Only diagnostic metadata is accepted: never log prompts, images or credentials. */
export async function observedAiCall<T>(call: Call, run: () => Promise<T>, write = writeEvent): Promise<T> {
  const { provider, model, stage, timeoutMs } = call;
  const base = { event: "ai_model_call" as const, id: randomUUID(), provider, model, stage, timeoutMs };
  const started = Date.now();
  const log = async (state: Event["state"], status?: number) => {
    try { await write({ ...base, at: new Date().toISOString(), state, ...(state !== "started" ? { durationMs: Date.now() - started, status } : {}) }); }
    catch { /* Diagnostics must not prevent a model call or hide its result. */ }
  };
  await log("started");
  try {
    const result = await run();
    await log("finished");
    return result;
  } catch (error) {
    const status = Number((error as { status?: number } | null)?.status);
    await log("failed", Number.isFinite(status) && status >= 100 && status <= 599 ? status : undefined);
    throw error;
  }
}
