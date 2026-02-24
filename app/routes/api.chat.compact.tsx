import type { Route } from "./+types/api.chat.compact";
import { z } from "zod";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { chatStream } from "~/services/gemini-chat.server";
import type { ModelType } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";

const CompactRequestSchema = z.object({
  messages: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          timestamp: z.number(),
        })
        .passthrough()
    )
    .min(1),
  model: z.string(),
  systemPrompt: z.string().optional(),
});

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(
    request,
    tokens
  );
  const responseHeaders = setCookieHeader
    ? { "Set-Cookie": setCookieHeader }
    : undefined;

  const apiKey = validTokens.geminiApiKey;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Gemini API key not configured" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...responseHeaders },
      }
    );
  }

  const body = await request.json();
  const parsed = CompactRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "Invalid request body",
        details: parsed.error.issues,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...responseHeaders },
      }
    );
  }

  const { messages, model, systemPrompt } = parsed.data;

  const abortSignal = request.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let aborted = false;

      abortSignal.addEventListener("abort", () => {
        aborted = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      const sendChunk = (chunk: StreamChunk) => {
        if (aborted) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        } catch {
          aborted = true;
        }
      };

      try {
        const generator = chatStream(
          apiKey,
          model as ModelType,
          messages as unknown as Message[],
          systemPrompt
        );

        for await (const chunk of generator) {
          sendChunk(chunk);
        }
      } catch (error) {
        sendChunk({
          type: "error",
          error:
            error instanceof Error ? error.message : "Stream processing error",
        });
        sendChunk({ type: "done" });
      } finally {
        if (!aborted) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(responseHeaders ?? {}),
    },
  });
}
