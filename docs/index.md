# GemiHub Knowledge Bundle

Welcome to the GemiHub Open Knowledge Format bundle.

## Features

* [Chat](features/chat.md) - AI chat with Gemini streaming, function calling (Drive/MCP/Google Search/RAG), slash commands, file references, attachments, and encrypted history.
* [Dashboard](features/dashboard.md) - Grid dashboard with file/base/kanban/secret-manager/timeline/workflow/web/memo-list widgets, alignment, and interval-driven workflow auto-execution.
* [Editor](features/editor.md) - Editor system: WYSIWYG markdown editing, workflow editing, and per-file-type viewers.
* [Search](features/search.md) - Search features: local search, Drive search, RAG semantic search, and Quick Open.
* [Sync](features/sync.md) - Push/pull sync between the IndexedDB cache and Google Drive with MD5 change detection and conflict resolution.
* [Edit History](features/history.md) - Edit history: how local file edits are recorded, browsed, and restored.

## Integrations

* [MCP (Model Context Protocol)](integrations/mcp.md) - MCP server integration; server tools are discovered dynamically and exposed to chat as mcp_{server}_{tool}.
* [Plugins](integrations/plugins.md) - Plugin developer guide: GitHub Release installation, PluginAPI surface, views, slash commands, and storage.
* [RAG (Retrieval-Augmented Generation)](integrations/rag.md) - RAG (Retrieval-Augmented Generation) setup and behavior using Gemini File Search.
* [Agent Skills](integrations/skill.md) - Agent Skills: bundles of custom instructions, reference material, and workflows for the AI agent.

## Workflows

* [Workflow Execution](workflows/workflow_execution.md) - Workflow execution engine: YAML parser, local browser execution, prompt nodes, and AI workflow generation.
* [Workflow Node Reference](workflows/workflow_nodes.md) - Reference for all 25 workflow node types with their properties and outputs.

## Architecture

* [Infrastructure](architecture/infrastructure.md) - Infrastructure: Cloud Run deployment, Docker builds, and self-hosting.
* [Premium Plan](architecture/premium.md) - Premium plans: multi-tenancy with Firestore, Cloud Storage static hosting, custom domains, scheduled execution, and isolated-vm.
* [Encryption](architecture/encryption.md) - Hybrid RSA+AES encryption for individual files, dashboard-managed secrets, chat history, and workflow logs.
* [Utils](architecture/utils.md) - Utilities: context menu, trash, slash commands, and other helpers.

## References

* [OKF Knowledge Sources](references/OKF.md) - OKF knowledge sources: markdown knowledge bundles on Drive, selected per chat and injected into the system prompt.
