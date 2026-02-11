// Chat type definitions - ported from obsidian-gemini-helper

import type { ModelType, McpAppResult, McpAppUiResource } from "./settings";

// Generated image from Gemini
export interface GeneratedImage {
  mimeType: string;
  data: string; // Base64 encoded image data
}

// MCP App info for rendering in messages
export interface McpAppInfo {
  serverUrl: string;
  serverHeaders?: Record<string, string>;
  toolResult: McpAppResult;
  uiResource?: McpAppUiResource | null;
}

// Chat attachment
export interface Attachment {
  name: string;
  type: "image" | "pdf" | "text";
  mimeType: string;
  data: string; // Base64 encoded data
}

// Tool call
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// Tool result
export interface ToolResult {
  toolCallId: string;
  result: unknown;
}

// Chat message
export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: ModelType;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  ragUsed?: boolean;
  ragSources?: string[];
  webSearchUsed?: boolean;
  thinking?: string;
  generatedImages?: GeneratedImage[];
  mcpApps?: McpAppInfo[];
}

// Streaming chunk types
export interface StreamChunk {
  type:
    | "text"
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "error"
    | "done"
    | "rag_used"
    | "web_search_used"
    | "image_generated"
    | "mcp_app"
    | "drive_changed";
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  ragSources?: string[];
  generatedImage?: GeneratedImage;
  mcpApp?: McpAppInfo;
  changedFileId?: string;
}

// Chat history stored in Drive
export interface ChatHistory {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  isEncrypted?: boolean;
}

// Chat history list item (metadata only, for sidebar)
export interface ChatHistoryItem {
  id: string;
  fileId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isEncrypted?: boolean;
}
