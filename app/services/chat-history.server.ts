// Chat history CRUD via Google Drive

import {
  listFiles,
  readFile,
  createFile,
  updateFile,
  deleteFile,
  getHistoryFolderId,
  ensureSubFolder,
} from "./google-drive.server";
import {
  readHistoryMeta,
  rebuildHistoryMeta,
  upsertHistoryMetaEntry,
  removeHistoryMetaEntry,
} from "./history-meta.server";
import type { ChatHistory, ChatHistoryItem } from "~/types/chat";
import type { EncryptionParams } from "~/types/settings";
import { encryptFileContent } from "./crypto.server";

const CHATS_FOLDER = "chats";

/**
 * Ensure the chats subfolder exists under history/
 */
async function ensureChatsFolderId(
  accessToken: string,
  rootFolderId: string
): Promise<string> {
  const historyFolderId = await getHistoryFolderId(accessToken, rootFolderId);
  return ensureSubFolder(accessToken, historyFolderId, CHATS_FOLDER);
}

/** Extract ChatHistoryItem metadata from a parsed chat file */
function extractChatItem(
  fileId: string,
  content: unknown
): ChatHistoryItem | null {
  const chat = content as ChatHistory;
  if (!chat.id) return null;
  return {
    id: chat.id,
    fileId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    isEncrypted: chat.isEncrypted,
  };
}

/**
 * List all chat histories (metadata only)
 */
export async function listChatHistories(
  accessToken: string,
  rootFolderId: string
): Promise<ChatHistoryItem[]> {
  const chatsFolderId = await ensureChatsFolderId(accessToken, rootFolderId);

  // Try reading from _meta.json first
  let meta = await readHistoryMeta<ChatHistoryItem>(accessToken, chatsFolderId);
  if (!meta) {
    // Rebuild from individual files (first time or missing _meta.json)
    meta = await rebuildHistoryMeta<ChatHistoryItem>(
      accessToken,
      chatsFolderId,
      extractChatItem
    );
  }

  const items = Object.values(meta.items);

  // Sort by updatedAt descending
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

/**
 * Load a specific chat
 */
export async function loadChat(
  accessToken: string,
  chatFileId: string
): Promise<ChatHistory> {
  const content = await readFile(accessToken, chatFileId);
  return JSON.parse(content) as ChatHistory;
}

/**
 * Save a chat (create or update)
 */
export async function saveChat(
  accessToken: string,
  rootFolderId: string,
  chatHistory: ChatHistory,
  encryption?: EncryptionParams
): Promise<string> {
  const chatsFolderId = await ensureChatsFolderId(accessToken, rootFolderId);
  let content = JSON.stringify(chatHistory, null, 2);
  if (encryption) {
    content = await encryptFileContent(
      content,
      encryption.publicKey,
      encryption.encryptedPrivateKey,
      encryption.salt
    );
  }
  const fileName = `chat_${chatHistory.id}.json`;

  // Check if file already exists
  const files = await listFiles(accessToken, chatsFolderId);
  const existing = files.find((f) => f.name === fileName);

  let fileId: string;
  if (existing) {
    await updateFile(accessToken, existing.id, content, "application/json");
    fileId = existing.id;
  } else {
    const file = await createFile(accessToken, fileName, content, chatsFolderId, "application/json");
    fileId = file.id;
  }

  // Update _meta.json (best-effort)
  try {
    const item: ChatHistoryItem = {
      id: chatHistory.id,
      fileId,
      title: chatHistory.title,
      createdAt: chatHistory.createdAt,
      updatedAt: chatHistory.updatedAt,
      isEncrypted: chatHistory.isEncrypted,
    };
    await upsertHistoryMetaEntry(accessToken, chatsFolderId, fileId, item);
  } catch (err) {
    console.error("[chat-history] Failed to update _meta.json:", err);
  }

  return fileId;
}

/**
 * Delete a chat
 */
export async function deleteChat(
  accessToken: string,
  rootFolderId: string,
  chatFileId: string
): Promise<void> {
  await deleteFile(accessToken, chatFileId);

  // Update _meta.json (best-effort)
  try {
    const chatsFolderId = await ensureChatsFolderId(accessToken, rootFolderId);
    await removeHistoryMetaEntry(accessToken, chatsFolderId, chatFileId);
  } catch (err) {
    console.error("[chat-history] Failed to update _meta.json after delete:", err);
  }
}
