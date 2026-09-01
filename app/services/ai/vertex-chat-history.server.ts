import {
  ProjectAccessError,
  requireProjectAccess,
} from "~/services/project-acl.server";
import {
  listChatHistoriesForTenant,
  loadChatForTenant,
  saveChatForTenant,
  deleteChatForTenant,
} from "~/services/chat-history-tenant.server";
import { getSettingsForTenant } from "~/services/user-settings-tenant.server";
import { getEncryptionParams } from "~/types/settings";
import type { ChatHistory } from "~/types/chat";

// ---------------------------------------------------------------------------
// GET — list chats, or load a single chat with ?id=xxx
// ---------------------------------------------------------------------------

export async function vertexLoader(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  if (!projectId) {
    return Response.json({ error: "Missing projectId" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireProjectAccess(request, projectId, "viewer");
  } catch (err) {
    if (err instanceof ProjectAccessError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const chatId = url.searchParams.get("id");
  if (chatId) {
    const result = await loadChatForTenant(ctx, chatId);
    if (!result) {
      return Response.json({ error: "Chat not found" }, { status: 404 });
    }
    return Response.json(result);
  }

  const histories = await listChatHistoriesForTenant(ctx);
  return Response.json(histories);
}

// ---------------------------------------------------------------------------
// POST / DELETE — save or delete chat history
// ---------------------------------------------------------------------------

export async function vertexAction(request: Request) {
  if (request.method === "POST") {
    const body = await request.json();
    const { projectId, chatHistory } = body as {
      projectId?: string;
      chatHistory?: ChatHistory;
    };
    if (!projectId) {
      return Response.json({ error: "Missing projectId" }, { status: 400 });
    }
    if (!chatHistory?.id || !chatHistory.messages) {
      return Response.json({ error: "Invalid chat history data" }, { status: 400 });
    }

    let ctx;
    try {
      ctx = await requireProjectAccess(request, projectId, "editor");
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    let encryption;
    let maxSavedChatHistories = 100;
    try {
      const settings = await getSettingsForTenant(ctx);
      maxSavedChatHistories = settings.maxSavedChatHistories ?? 100;
      encryption = getEncryptionParams(settings, "chat");
      if (encryption) {
        chatHistory.isEncrypted = true;
      }
    } catch {
      if (chatHistory.isEncrypted) {
        return Response.json(
          { error: "Failed to load encryption settings for encrypted chat" },
          { status: 500 },
        );
      }
    }

    const fileId = await saveChatForTenant(ctx, chatHistory, encryption);
    if (maxSavedChatHistories > 0) {
      const histories = await listChatHistoriesForTenant(ctx);
      await Promise.all(
        histories
          .slice(maxSavedChatHistories)
          .map((history) => deleteChatForTenant(ctx, history.id)),
      );
    }
    return Response.json({ success: true, fileId });
  }

  if (request.method === "DELETE") {
    const body = await request.json();
    const { projectId, chatId } = body as { projectId?: string; chatId?: string };
    if (!projectId) {
      return Response.json({ error: "Missing projectId" }, { status: 400 });
    }
    if (!chatId) {
      return Response.json({ error: "chatId is required" }, { status: 400 });
    }

    let ctx;
    try {
      ctx = await requireProjectAccess(request, projectId, "editor");
    } catch (err) {
      if (err instanceof ProjectAccessError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    await deleteChatForTenant(ctx, chatId);
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
