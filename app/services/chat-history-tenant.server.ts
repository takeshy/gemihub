// Chat history CRUD on tenant GCS.
//
// Each chat is stored as `gemihub/history/chats/chat_{id}.json`. We reuse the
// chat id as the public identifier (in the legacy Drive world this slot held
// the opaque Drive fileId) — callers should treat it as opaque.

import {
  GcsObjectNotFoundError,
  deleteObject,
  listObjects,
  readObject,
  writeObject,
} from "./gcs-storage.server";
import type { ProjectAccessContext } from "~/types/enterprise";
import type { ChatHistory, ChatHistoryItem } from "~/types/chat";
import type { EncryptionParams } from "~/types/settings";
import { encryptFileContent, isEncryptedFile } from "./crypto.server";

const CHATS_PREFIX = "gemihub/history/chats";

function pathFor(chatId: string): string {
  return `${CHATS_PREFIX}/chat_${chatId}.json`;
}

function chatIdFromPath(relativePath: string): string | null {
  const stripped = relativePath.startsWith(`${CHATS_PREFIX}/`)
    ? relativePath.slice(CHATS_PREFIX.length + 1)
    : relativePath;
  const m = stripped.match(/^chat_(.+)\.json$/);
  return m ? m[1] : null;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function itemFromContent(chatId: string, content: string): ChatHistoryItem | null {
  if (isEncryptedFile(content)) {
    // Encrypted: we can't read the title / timestamps without the user's key,
    // so the list view only gets the id flag.
    return {
      id: chatId,
      fileId: chatId,
      title: "",
      createdAt: 0,
      updatedAt: 0,
      isEncrypted: true,
    };
  }
  try {
    const chat = JSON.parse(content) as ChatHistory;
    if (!chat.id) return null;
    return {
      id: chat.id,
      fileId: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      isEncrypted: chat.isEncrypted,
    };
  } catch {
    return null;
  }
}

export async function listChatHistoriesForTenant(
  ctx: ProjectAccessContext,
): Promise<ChatHistoryItem[]> {
  const { objects } = await listObjects(ctx, { relativePrefix: CHATS_PREFIX });
  const items: ChatHistoryItem[] = [];
  for (const obj of objects) {
    const chatId = chatIdFromPath(obj.relativePath);
    if (!chatId) continue;
    try {
      const { bytes } = await readObject(ctx, obj.relativePath);
      const item = itemFromContent(chatId, decode(bytes));
      if (item) items.push(item);
    } catch {
      // Skip unreadable / corrupt files
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export async function loadChatForTenant(
  ctx: ProjectAccessContext,
  chatId: string,
): Promise<ChatHistory | { encrypted: true; encryptedContent: string } | null> {
  try {
    const { bytes } = await readObject(ctx, pathFor(chatId));
    const content = decode(bytes);
    if (isEncryptedFile(content)) {
      return { encrypted: true, encryptedContent: content };
    }
    return JSON.parse(content) as ChatHistory;
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) return null;
    throw err;
  }
}

export async function saveChatForTenant(
  ctx: ProjectAccessContext,
  chatHistory: ChatHistory,
  encryption?: EncryptionParams,
): Promise<string> {
  let content = JSON.stringify(chatHistory, null, 2);
  if (encryption) {
    content = await encryptFileContent(
      content,
      encryption.publicKey,
      encryption.encryptedPrivateKey,
      encryption.salt,
    );
  }
  await writeObject(ctx, pathFor(chatHistory.id), content, "application/json");
  return chatHistory.id;
}

export async function deleteChatForTenant(
  ctx: ProjectAccessContext,
  chatId: string,
): Promise<void> {
  try {
    await deleteObject(ctx, pathFor(chatId));
  } catch (err) {
    if (err instanceof GcsObjectNotFoundError) return;
    throw err;
  }
}
