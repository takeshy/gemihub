import type { Route } from "./+types/api.chat.history";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import {
  listChatHistories,
  saveChat,
  deleteChat,
} from "~/services/chat-history.server";
import { getSettings } from "~/services/user-settings.server";
import { getEncryptionParams } from "~/types/settings";
import type { ChatHistory } from "~/types/chat";

// ---------------------------------------------------------------------------
// GET -- List chat histories
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  const histories = await listChatHistories(
    validTokens.accessToken,
    validTokens.rootFolderId
  );

  return Response.json(histories, { headers: responseHeaders });
}

// ---------------------------------------------------------------------------
// POST / DELETE -- Save or delete chat history
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const responseHeaders = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;

  switch (request.method) {
    case "POST": {
      const chatHistory: ChatHistory = await request.json();

      if (!chatHistory.id || !chatHistory.messages) {
        return Response.json(
          { error: "Invalid chat history data" },
          { status: 400, headers: responseHeaders }
        );
      }

      let encryption;
      try {
        const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
        encryption = getEncryptionParams(settings, "chat");
        if (encryption) {
          chatHistory.isEncrypted = true;
        }
      } catch {
        // If the chat was previously encrypted, we must not save it unencrypted
        if (chatHistory.isEncrypted) {
          return Response.json(
            { error: "Failed to load encryption settings for encrypted chat" },
            { status: 500, headers: responseHeaders }
          );
        }
      }

      const fileId = await saveChat(
        validTokens.accessToken,
        validTokens.rootFolderId,
        chatHistory,
        encryption
      );

      return Response.json({ success: true, fileId }, { headers: responseHeaders });
    }

    case "DELETE": {
      const body = await request.json();
      const { fileId } = body as { fileId: string };

      if (!fileId) {
        return Response.json(
          { error: "fileId is required" },
          { status: 400, headers: responseHeaders }
        );
      }

      await deleteChat(validTokens.accessToken, validTokens.rootFolderId, fileId);

      return Response.json({ success: true }, { headers: responseHeaders });
    }

    default:
      return Response.json(
        { error: "Method not allowed" },
        { status: 405, headers: responseHeaders }
      );
  }
}
