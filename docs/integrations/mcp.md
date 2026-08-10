---
type: Guide
title: MCP (Model Context Protocol)
description: MCP server integration; server tools are discovered dynamically and exposed to chat as mcp_{server}_{tool}.
tags:
  - mcp
---
# MCP (Model Context Protocol)

Integration with external MCP servers for extending Gemini's tool capabilities.

## Features

- **Dynamic Tool Discovery**: Automatically fetches tool definitions from MCP servers
- **Chat Integration**: MCP tools available alongside Drive tools during Gemini chat
- **Workflow Integration**: Dedicated `mcp` workflow node for direct server calls
- **MCP Apps**: Render rich UI from MCP tool results in sandboxed iframes
- **OAuth Support**: RFC 9728 discovery, dynamic client registration, PKCE, token refresh
- **Client Caching**: Persistent MCP client instances per server to reuse sessions
- **SSRF Protection**: URL validation blocks private IP ranges and metadata endpoints

---

## Protocol

GemiHub uses the **Streamable HTTP transport** variant of MCP.

| Parameter | Value |
|-----------|-------|
| Transport | HTTP POST (JSON-RPC 2.0) |
| Protocol Version | `2026-07-28` |
| Session Management | None for 2026; `Mcp-Session-Id` for negotiated legacy servers |
| Session Close | None for 2026; HTTP DELETE for negotiated legacy sessions |
| Response Formats | `application/json` or `text/event-stream` (auto-detected) |
| Version Header | `MCP-Protocol-Version: 2026-07-28` on 2026 requests; negotiated version on legacy requests |
| Routing Headers | `Mcp-Method` on every request; `Mcp-Name` when applicable |
| Request Timeout | 30s (standard), 10s (notifications), 60s (workflow tool calls) |

### Lifecycle

```
1. server/discover → Negotiate the newest mutually supported revision
2. tools/list      → Server returns available tools (pagination via cursor supported)
3. tools/call      → Execute a tool (repeatable)
4. resources/read  → Fetch UI resource (optional)
```

The 2026 revision removes the `initialize` / `notifications/initialized`
handshake and session-affinity headers. GemiHub also does not advertise or call
the deprecated Roots, Sampling, or MCP Logging capabilities. Operational logs
remain in the application's normal logging infrastructure.

Every 2026 request carries the protocol version and client declaration in
`params._meta`, along with the required Streamable HTTP routing headers. If
`server/discover` is unavailable or reports only an older revision, GemiHub
falls back to the legacy `initialize` / `notifications/initialized` lifecycle
and retains its session ID until the client is closed.

Tool `inputSchema` values are retained as JSON Schema objects, including a
`$schema` declaration and JSON Schema 2020-12 keywords. Tool results preserve
both content blocks and `structuredContent`. MCP Apps continue to be discovered
through UI resource metadata and rendered using the Apps iframe bridge described
below.

---

## Configuration

MCP servers are configured in **Settings > MCP Servers**.

### Server Config

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Display name for the server |
| URL | Yes | HTTP endpoint (HTTPS required in production) |
| Headers | No | Custom headers as JSON (e.g., `{"Authorization": "Bearer ..."}`) |
| OAuth | No | Auto-discovered or manually configured OAuth settings |

### Test Connection

The "Test" button calls `POST /api/settings/mcp-test` which:
1. Validates the URL for SSRF protection
2. Negotiates the protocol revision, using `server/discover` for 2026 servers
   and the legacy initialization lifecycle when necessary
3. Calls `tools/list`
4. Returns tool definitions (cached in server config)

If the server returns 401, OAuth discovery is triggered automatically.

---

## OAuth Authentication

Supports servers requiring OAuth 2.0 authentication per RFC 9728.

### Discovery Flow

```
1. POST to server → 401 Unauthorized
2. Parse WWW-Authenticate header for resource_metadata URL → fetch metadata
   (fallback: GET /.well-known/oauth-protected-resource from server origin)
3. Fetch /.well-known/oauth-authorization-server from auth server origin
   (fallback: GET authorization_servers[0] URL directly as metadata)
4. Attempt dynamic client registration (if registration_endpoint available)
5. Fall back to clientId "gemihub" if registration fails
```

All OAuth discovery URLs are validated for SSRF protection before fetching.

### Authorization Flow

1. Generate PKCE code verifier and challenge
2. Open popup window with PKCE parameters and the RFC 8707 `resource` indicator
3. User authorizes in popup
4. Callback exchanges authorization code for tokens via `POST /api/settings/mcp-oauth-token`
5. Tokens stored in server config (`oauthTokens`)
6. Mobile fallback: If popup is blocked, store pending state in `sessionStorage`, redirect to authorization URL in same tab, and resume on callback return via `/settings?mcp-oauth-return=1`

### Token Management

| Feature | Description |
|---------|-------------|
| Auto-inject | Bearer token added to requests via `Authorization` header |
| Expiry check | 5-minute buffer before expiration |
| Auto-refresh | Refresh token and discovered `resource` used to obtain a new access token |
| Storage | Tokens persisted in `settings.json` on Drive |

---

## Chat Integration

### Tool Selection

In the chat input tool dropdown, each MCP server appears as a checkbox. Users enable/disable servers per chat session. Selection is persisted to `localStorage` as MCP server IDs.

Enabled MCP servers installed by Agent Plugins are selected once by default
when this behavior is first introduced. Install and update automatically call
`tools/list`; failed discovery can be retried from **Settings > MCP Servers**.

### Tool Naming

MCP tools are exposed to Gemini with prefixed names:

```
mcp_{sanitizedServerId}_{sanitizedToolName}
```

`sanitizedServerId` is derived from each server's unique ID (or normalized/sanitized fallback when migrating legacy configs). Sanitization: lowercase, replace non-alphanumeric with `_`, collapse consecutive `_` into one, strip leading/trailing `_`.

Example: Server ID `brave_search_ab12cd`, tool `web_search` → `mcp_brave_search_ab12cd_web_search`

### Execution Flow

```
Gemini calls mcp_server_tool(args)
  → api.chat.tsx: executeToolCall dispatches to executeMcpTool()
    → mcp-tools.server.ts: find server by prefix, call with original tool name
      → McpClient.callToolWithUi(toolName, args)
        → JSON-RPC tools/call to MCP server
        → Extract text content → return to Gemini as tool result
        → If resourceUri present → fetch UI resource
          → Send mcp_app SSE chunk to client
            → ChatPanel stores the MCP App on the new assistant message
              → McpAppRenderer displays it in a sandboxed iframe
```

### Incompatibilities

- MCP tools are disabled when **Web Search** mode is active
- MCP tools are disabled when **Gemma models** are selected (no function calling support)
- MCP tools are disabled when **Flash-Lite models** are selected with a **custom RAG** setting
- MCP tool dropdown is locked when drive tool mode is locked

---

## MCP Apps (Rich UI)

When an MCP tool returns UI metadata (`_meta.ui.resourceUri`), the result is rendered as an interactive MCP App.

The app payload is attached to and persisted with the newly generated assistant
message. Previously saved messages are not retroactively populated after a
deployment; run the MCP tool again to create a new message with the card.

### Resource Loading

1. Server-side: `McpClient.readResource(uri)` fetches HTML content during tool execution
2. Client-side fallback: `POST /api/mcp/resource-read` proxy if server-side fetch is not available
3. Content can be `text` (HTML string) or `blob` (Base64-encoded)

### Iframe Sandbox

MCP App HTML is rendered in a sandboxed iframe:

```html
<iframe sandbox="allow-scripts allow-forms" srcDoc="...">
```

**Allowed**: JavaScript execution, form submission
**Blocked**: Navigation, popups, same-origin access

### Iframe Communication (postMessage)

**Parent → Iframe** (on load):
```json
{ "jsonrpc": "2.0", "method": "toolResult", "params": { "content": [...], "isError": false } }
```

**Iframe → Parent** (tool calls):
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "toolName", "arguments": {} } }
```

**Iframe → Parent** (context update):
```json
{ "jsonrpc": "2.0", "id": 2, "method": "context/update", "params": { ... } }
```

Tool calls from the iframe are proxied through `POST /api/mcp/tool-call` to avoid CORS. `context/update` is acknowledged with `{ ok: true }`.

### UI Controls

- **Collapse/Expand**: Toggle MCP App visibility
- **Maximize**: Full-screen overlay (5% inset, Escape to close)
- **Loading state**: Spinner while fetching resources

---

## Workflow Integration

### MCP Node

The `mcp` workflow node calls an MCP server tool directly.

| Property | Required | Description |
|----------|----------|-------------|
| `url` | Yes | MCP server URL |
| `tool` | Yes | Tool name to call |
| `args` | No | JSON string of arguments (supports `{{variable}}` substitution) |
| `headers` | No | JSON string of custom headers |
| `saveTo` | No | Variable name to store text result |
| `saveUiTo` | No | Variable name to store UI resource JSON |

### Workflow Execution

When a matching server config is found in settings, the handler uses a cached client via `getOrCreateClient()` (with OAuth support). Otherwise, a dedicated `McpClient` is created per execution:

1. Negotiate the protocol revision (cached clients do this only once)
2. Call `tools/call` via `McpClient` (60s timeout)
3. Extract text or structured content from the result
4. If `_meta.ui.resourceUri` present, call `resources/read` (30s timeout)
5. Return `McpAppInfo` for display in execution log

### Command Node

The `command` workflow node supports `mcpServers` property (comma-separated server IDs) to enable MCP tools during Gemini chat within workflows.

`command` node tool constraints are identical to `api.chat`:
- MCP tools are disabled when **Web Search** mode is active
- MCP tools are disabled when **Gemma models** are selected
- MCP tools are disabled when function tools are forced off by model/search constraints

---

## Security

### SSRF Protection

All MCP server URLs are validated before use. Blocked targets:

| Category | Blocked |
|----------|---------|
| Loopback | `127.*`, `::1`, `::`, `::0`, `localhost` |
| Default route | `0.*` |
| Private networks (IPv4) | `10.*`, `172.16-31.*`, `192.168.*` |
| Private networks (IPv6) | `fc00::/7` (`fc*`, `fd*`) |
| Link-local | `169.254.*`, `fe80:*` |
| Cloud metadata | `metadata.google.internal`, `169.254.169.254` |
| Protocol | HTTP blocked in production (HTTPS required) |

Development mode allows HTTP and localhost for testing with local MCP servers.

### Iframe Security

- `sandbox="allow-scripts allow-forms"` — no navigation, no popups, no same-origin access
- Tool calls from iframe proxied server-side (no direct MCP server access from browser)
- JSON-RPC message validation on all postMessage communication

---

## Architecture

### Data Flow

```
Settings UI                     Server                       MCP Server
┌──────────────┐         ┌──────────────────┐         ┌──────────────┐
│ Server config │         │ mcp-client.server│         │ JSON-RPC 2.0 │
│ OAuth tokens  │────────►│ mcp-tools.server │◄───────►│ tools/list   │
│ Tool cache    │         │ mcp-oauth.server │         │ tools/call   │
└──────────────┘         └──────────────────┘         │ resources/read│
                               │                       └──────────────┘
Chat / Workflow                │
┌──────────────┐         ┌─────▼──────┐
│ Tool calls    │────────►│ Proxy APIs │
│ MCP App UI   │◄────────│ tool-call  │
│ iframe        │         │ resource   │
└──────────────┘         └────────────┘
```

### Key Files

| File | Role |
|------|------|
| `app/services/mcp-client.server.ts` | MCP client — JSON-RPC communication, session management, SSE parsing |
| `app/services/mcp-tools.server.ts` | Tool discovery, naming, execution, client caching, UI resource fetching |
| `app/services/mcp-oauth.server.ts` | RFC 9728 OAuth discovery, client registration, token exchange/refresh |
| `app/services/url-validator.server.ts` | SSRF protection — URL validation for MCP endpoints |
| `app/services/mcp-proxy-server-resolver.ts` | Resolves which MCP server config to use for proxy requests |
| `app/routes/api.mcp.tool-call.tsx` | Server-side proxy for iframe tool calls |
| `app/routes/api.mcp.resource-read.tsx` | Server-side proxy for iframe resource reads |
| `app/routes/api.settings.mcp-test.tsx` | Test connection, discover tools, OAuth discovery on 401 |
| `app/routes/api.settings.mcp-oauth-token.tsx` | Exchange authorization code for OAuth tokens (PKCE) |
| `app/routes/auth.mcp-oauth-callback.tsx` | OAuth callback page — receives authorization code from popup |
| `app/components/chat/McpAppRenderer.tsx` | MCP App rendering — iframe sandbox, postMessage, maximize |
| `app/engine/handlers/mcp.ts` | Workflow MCP node handler — uses cached or dedicated McpClient per execution |

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/mcp/tool-call` | POST | Proxy tool call for iframe (CORS bypass) |
| `/api/mcp/resource-read` | POST | Proxy resource read for iframe |
| `/api/settings/mcp-test` | POST | Test server connection, list tools, OAuth discovery |
| `/api/settings/mcp-oauth-token` | POST | Exchange OAuth authorization code for tokens |
