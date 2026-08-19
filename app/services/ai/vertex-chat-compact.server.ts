import { z } from "zod";
import { streamCompact } from "~/services/gemini-vertex.server";
import {
  ModelNotAllowedError,
  ProjectAccessError,
  assertModelAllowed,
  requireProjectAccess,
} from "~/services/project-acl.server";
import type { ModelType } from "~/types/settings";
import type { Message, StreamChunk } from "~/types/chat";

const CompactRequestSchema = z.object({
  projectId: z.string().min(1),
  messages: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
          timestamp: z.number(),
        })
        .passthrough(),
    )
    .min(1),
  model: z.string(),
  systemPrompt: z.string().optional(),
  enableThinking: z.boolean().optional(),
});

export async function vertexAction(request: Request) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const parsed = CompactRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const { projectId, messages, model, systemPrompt, enableThinking } = parsed.data;

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
    assertModelAllowed(ctx, model);
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof ModelNotAllowedError) {
      return Response.json(
        { error: err.message, model: err.model, allowed: err.allowed },
        { status: err.status },
      );
    }
    throw err;
  }

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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        } catch {
          aborted = true;
        }
      };

      try {
        for await (const chunk of streamCompact({
          tenant: ctx.tenant,
          model: model as ModelType,
          messages: messages as unknown as Message[],
          systemPrompt,
          enableThinking,
          billing: { orgId: ctx.orgId, uid: ctx.uid },
        })) {
          sendChunk(chunk);
        }
      } catch (err) {
        sendChunk({
          type: "error",
          error: err instanceof Error ? err.message : "Stream processing error",
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
    },
  });
}
