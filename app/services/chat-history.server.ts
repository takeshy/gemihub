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
import type { ChatHistory, ChatHistoryItem } from "~/types/chat";

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

/**
 * List all chat histories (metadata only)
 */
export async function listChatHistories(
  accessToken: string,
  rootFolderId: string
): Promise<ChatHistoryItem[]> {
  const chatsFolderId = await ensureChatsFolderId(accessToken, rootFolderId);
  const files = await listFiles(accessToken, chatsFolderId);

  const jsonFiles = files.filter((f) => f.name.endsWith(".json"));

  // Read all chat files in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 10;
  const items: ChatHistoryItem[] = [];

  for (let i = 0; i < jsonFiles.length; i += BATCH_SIZE) {
    const batch = jsonFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const content = await readFile(accessToken, file.id);
        const chat = JSON.parse(content) as ChatHistory;
        return {
          id: chat.id,
          fileId: file.id,
          title: chat.title,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          isEncrypted: chat.isEncrypted,
        } as ChatHistoryItem;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        items.push(r.value);
      } else {
        console.error("[chat-history] Failed to load chat file:", r.reason);
      }
    }
  }

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
  chatHistory: ChatHistory
): Promise<string> {
  const chatsFolderId = await ensureChatsFolderId(accessToken, rootFolderId);
  const content = JSON.stringify(chatHistory, null, 2);
  const fileName = `chat_${chatHistory.id}.json`;

  // Check if file already exists
  const files = await listFiles(accessToken, chatsFolderId);
  const existing = files.find((f) => f.name === fileName);

  if (existing) {
    await updateFile(accessToken, existing.id, content, "application/json");
    return existing.id;
  } else {
    const file = await createFile(accessToken, fileName, content, chatsFolderId, "application/json");
    return file.id;
  }
}

/**
 * Delete a chat
 */
export async function deleteChat(
  accessToken: string,
  chatFileId: string
): Promise<void> {
  await deleteFile(accessToken, chatFileId);
}
