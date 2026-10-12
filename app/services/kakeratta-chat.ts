/** Collect the existing chat endpoint's SSE answer, including split frames. */
export async function collectKakerattaAnswer(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.ok || !response.body) throw new Error("GemiHub could not generate an answer");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let complete = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("Kakeratta turn stopped");
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error("Kakeratta turn stopped");
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const chunk = JSON.parse(line.slice(6)) as { type: string; content?: string; error?: string };
          if (chunk.type === "error" || chunk.type === "requires_action" || chunk.type === "mcp_approval") throw new Error("GemiHub generation failed");
          if (chunk.type === "text") answer += chunk.content ?? "";
          if (chunk.type === "done") complete = true;
        }
      }
      if (done) break;
    }
    if (!complete || !answer.trim()) throw new Error("GemiHub returned an incomplete answer");
    return answer;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
