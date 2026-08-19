/**
 * POST /api/settings/rag-sync
 *
 * Enterprise Firestore RAG sync. Reads GCS files for the current project,
 * chunks text content, generates embeddings via Vertex AI, and stores them
 * in the control-plane Firestore vector store.
 *
 * SSE progress stream (same shape as the legacy free-plan endpoint):
 *   data: { type:"progress", current, total, fileName, action, message? }
 *   data: { type:"complete", uploaded, skipped, deleted, errors, errorDetails, message }
 *   data: { type:"error", message }
 */

import { requireAuth } from "~/services/session.server";
import { requireProjectAccess } from "~/services/project-acl.server";
import { smartSyncRag } from "~/services/rag-sync-tenant.server";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";

interface Body {
  ragSettingName?: unknown;
  projectId?: unknown;
  forceRebuild?: unknown;
  chunkSize?: unknown;
  chunkOverlap?: unknown;
}

export async function tenantAction(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const tokens = await requireAuth(request);
  const body = (await request.json().catch(() => null)) as Body | null;
  const projectId =
    typeof body?.projectId === "string" && body.projectId
      ? body.projectId
      : tokens.currentProjectId;

  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }

  const ctx = await requireProjectAccess(request, projectId, "editor");

  // Resolve RAG setting
  const settings = await getSettingsForTenant(ctx);
  const ragSettingName =
    typeof body?.ragSettingName === "string" && body.ragSettingName
      ? body.ragSettingName
      : settings.selectedRagSetting ?? "gemihub";

  const ragSetting = settings.ragSettings?.[ragSettingName];
  if (!ragSetting) {
    return Response.json(
      { error: `RAG setting "${ragSettingName}" not found` },
      { status: 400 },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      try {
        const result = await smartSyncRag(ctx, {
          settingName: ragSettingName,
          targetFolders: ragSetting.targetFolders ?? [],
          excludePatterns: ragSetting.excludePatterns ?? [],
          chunkSize:
            typeof body?.chunkSize === "number" && Number.isFinite(body.chunkSize)
              ? body.chunkSize
              : ragSetting.chunkSize,
          chunkOverlap:
            typeof body?.chunkOverlap === "number" && Number.isFinite(body.chunkOverlap)
              ? body.chunkOverlap
              : ragSetting.chunkOverlap,
          forceRebuild: body?.forceRebuild === true,
          onProgress: (p) =>
            send({
              type: "progress",
              current: p.current,
              total: p.total,
              fileName: p.fileName,
              action: p.action,
              message: p.message,
            }),
        });
        if (result.errors > 0) {
          console.error("[rag-sync] completed with errors", {
            orgId: ctx.orgId,
            projectId: ctx.projectId,
            ragSettingName,
            errors: result.errors,
            errorDetails: result.errorDetails,
          });
        }

        send({
          type: "complete",
          uploaded: result.uploaded,
          skipped: result.skipped,
          deleted: result.deleted,
          errors: result.errors,
          errorDetails: result.errorDetails,
          message:
            result.errors > 0
              ? `Synced with ${result.errors} error(s): ${result.errorDetails.slice(0, 5).join(" | ")}${result.errorDetails.length > 5 ? ` | ...and ${result.errorDetails.length - 5} more` : ""}`
              : `Synced ${result.uploaded} chunks from ${result.skipped + result.uploaded} files.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: msg });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
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
