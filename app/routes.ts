import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("auth/google", "routes/auth.google.tsx"),
  route("auth/google/callback", "routes/auth.google.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  route("settings", "routes/settings.tsx"),
  // API routes
  route("api/drive/files", "routes/api.drive.files.tsx"),
  route("api/drive/tree", "routes/api.drive.tree.tsx"),
  route("api/workflow/:id/execute", "routes/api.workflow.$id.execute.tsx"),
  route("api/workflow/ai-generate", "routes/api.workflow.ai-generate.tsx"),
  route("api/workflow/history", "routes/api.workflow.history.tsx"),
  route("api/prompt-response", "routes/api.prompt-response.tsx"),
  route("api/chat", "routes/api.chat.tsx"),
  route("api/chat/history", "routes/api.chat.history.tsx"),
  route("api/settings/mcp-test", "routes/api.settings.mcp-test.tsx"),
  route("api/settings/rag-sync", "routes/api.settings.rag-sync.tsx"),
  route("api/settings/encryption", "routes/api.settings.encryption.tsx"),
  route("api/settings/edit-history", "routes/api.settings.edit-history.tsx"),
  route("api/settings/edit-history-stats", "routes/api.settings.edit-history-stats.tsx"),
  route("api/settings/edit-history-prune", "routes/api.settings.edit-history-prune.tsx"),
  route("api/sync", "routes/api.sync.tsx"),
  route("api/drive/upload", "routes/api.drive.upload.tsx"),
  route("api/drive/temp", "routes/api.drive.temp.tsx"),
] satisfies RouteConfig;
