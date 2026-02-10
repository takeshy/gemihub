import type { Route } from "./+types/api.settings.rag-sync";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { smartSync, getOrCreateStore } from "~/services/file-search.server";

// ---------------------------------------------------------------------------
// POST -- RAG sync with SSE progress
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const apiKey = validTokens.geminiApiKey;
  if (!apiKey) {
    return Response.json(
      { error: "Gemini API key not configured" },
      { status: 400, headers: responseHeaders }
    );
  }

  let ragSettingName: string | undefined;
  try {
    const body = await request.json();
    ragSettingName = (body as { ragSettingName?: string }).ragSettingName;
  } catch {
    // body may be empty when called without JSON payload
  }

  const settings = await getSettings(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  const settingName = ragSettingName || settings.selectedRagSetting;
  if (!settingName || !settings.ragSettings[settingName]) {
    return Response.json(
      { error: "RAG setting not found" },
      { status: 400, headers: responseHeaders }
    );
  }

  const ragSetting = settings.ragSettings[settingName];

  // Create SSE stream for progress reporting
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (
        type: string,
        data: Record<string, unknown>
      ) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type, ...data })}\n\n`
          )
        );
      };

      try {
        // Ensure store exists
        if (!ragSetting.storeName) {
          sendEvent("progress", {
            message: "Creating File Search store...",
            current: 0,
            total: 0,
          });
          const storeName = await getOrCreateStore(apiKey, settingName);
          ragSetting.storeName = storeName;
        }

        sendEvent("progress", {
          message: "Starting sync...",
          current: 0,
          total: 0,
        });

        const result = await smartSync(
          apiKey,
          validTokens.accessToken,
          ragSetting,
          validTokens.rootFolderId,
          (current, total, fileName, action) => {
            sendEvent("progress", {
              current,
              total,
              fileName,
              action,
              message: `${action === "upload" ? "Uploading" : action === "skip" ? "Skipping" : "Deleting"}: ${fileName}`,
            });
          }
        );

        // Update settings with sync results
        settings.ragSettings[settingName] = {
          ...ragSetting,
          files: result.newFiles,
          lastFullSync: result.lastFullSync,
          storeId: ragSetting.storeId || ragSetting.storeName,
        };

        await saveSettings(
          validTokens.accessToken,
          validTokens.rootFolderId,
          settings
        );

        const errorDetails = result.errors.length > 0
          ? "\n" + result.errors.map((e) => `  - ${e.path}: ${e.error}`).join("\n")
          : "";
        sendEvent("complete", {
          message: `Sync complete. Uploaded: ${result.uploaded.length}, Skipped: ${result.skipped.length}, Deleted: ${result.deleted.length}, Errors: ${result.errors.length}${errorDetails}`,
          uploaded: result.uploaded.length,
          skipped: result.skipped.length,
          deleted: result.deleted.length,
          errors: result.errors.length,
          errorDetails: result.errors,
          ragSetting: settings.ragSettings[settingName],
        });
      } catch (error) {
        sendEvent("error", {
          message:
            error instanceof Error ? error.message : "Sync failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  if (setCookieHeader) headers.set("Set-Cookie", setCookieHeader);

  return new Response(stream, { status: 200, headers });
}
