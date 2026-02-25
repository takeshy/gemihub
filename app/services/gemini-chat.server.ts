// Gemini chat server module - re-exports from browser-safe core.
// Existing server-side importers continue to work unchanged.

export {
  chatStream,
  chatWithToolsStream,
  generateImageStream,
  messagesToContents,
  toolsToGeminiFormat,
  getThinkingConfig,
  isDriveToolMediaResult,
  type DriveToolMediaResult,
  type FunctionCallLimitOptions,
  type ChatWithToolsOptions,
} from "./gemini-chat-core";
