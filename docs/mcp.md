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
| Protocol Version | `2024-11-05` |
| Session Management | `Mcp-Session-Id` header |
| Session Close | HTTP DELETE with session header |
| Response Formats | `application/json` or `text/event-stream` (auto-detected) |
| Request Timeout | 30s (standard), 10s (notifications), 60s (workflow tool calls) |

### Lifecycle

```
1. initialize      → Server returns capabilities + serverInfo
2. notifications/initialized  → Client confirms init (notification, no response)
3. tools/list      → Server returns available tools
4. tools/call      → Execute a tool (repeatable)
5. resources/read  → Fetch UI resource (optional)
6. DELETE          → Close session
```

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
2. Initializes an MCP session
3. Lists available tools
4. Returns tool definitions (cached in server config)

If the server returns 401, OAuth discovery is triggered automatically.

---

## OAuth Authentication

Supports servers requiring OAuth 2.0 authentication per RFC 9728.

### Discovery Flow

```
1. POST to server → 401 Unauthorized
2. Parse WWW-Authenticate header for resource_metadata URL
3. Fetch /.well-known/oauth-protected-resource
4. Fetch /.well-known/oauth-authorization-server
5. Attempt dynamic client registration (if registration_endpoint available)
6. Fall back to clientId "gemihub" if registration fails
```

### Authorization Flow

1. Generate PKCE code verifier and challenge
2. Open popup window to authorization URL with PKCE parameters
3. User authorizes in popup
4. Callback exchanges authorization code for tokens via `POST /api/settings/mcp-oauth-token`
5. Tokens stored in server config (`oauthTokens`)

### Token Management

| Feature | Description |
|---------|-------------|
| Auto-inject | Bearer token added to requests via `Authorization` header |
| Expiry check | 5-minute buffer before expiration |
| Auto-refresh | Refresh token used to obtain new access token on test |
| Storage | Tokens persisted in `settings.json` on Drive |

---

## Chat Integration

### Tool Selection

In the chat input tool dropdown, each MCP server appears as a checkbox. Users enable/disable servers per chat session. Selection is persisted to `localStorage`.

### Tool Naming

MCP tools are exposed to Gemini with prefixed names:

```
mcp_{sanitizedServerName}_{sanitizedToolName}
```

Sanitization: lowercase, replace non-alphanumeric with `_`, strip leading/trailing `_`.

Example: Server "Brave Search", tool "web_search" → `mcp_brave_search_web_search`

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
            → McpAppRenderer displays in sandboxed iframe
```

### Incompatibilities

- MCP tools are disabled when **Web Search** mode is active
- MCP tools are disabled when **Gemma models** are selected (no function calling support)
- MCP tool dropdown is locked when drive tool mode is locked

---

## MCP Apps (Rich UI)

When an MCP tool returns UI metadata (`_meta.ui.resourceUri`), the result is rendered as an interactive MCP App.

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

The workflow MCP handler creates a dedicated `McpClient` per execution (not cached):

1. Initialize MCP session (handshake + `notifications/initialized`)
2. Call `tools/call` via `McpClient` (60s timeout)
3. Extract text content from result
4. If `_meta.ui.resourceUri` present, call `resources/read` (30s timeout)
5. Return `McpAppInfo` for display in execution log
6. Close session

### Command Node

The `command` workflow node supports `mcpServers` property (comma-separated server names) to enable MCP tools during Gemini chat within workflows.

---

## Security

### SSRF Protection

All MCP server URLs are validated before use. Blocked targets:

| Category | Blocked |
|----------|---------|
| Loopback | `127.*`, `::1`, `localhost` |
| Default route | `0.*` |
| Private networks (IPv4) | `10.*`, `172.16-31.*`, `192.168.*` |
| Private networks (IPv6) | `fc00:*`, `fd*` |
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
| `app/routes/api.mcp.tool-call.tsx` | Server-side proxy for iframe tool calls |
| `app/routes/api.mcp.resource-read.tsx` | Server-side proxy for iframe resource reads |
| `app/routes/api.settings.mcp-test.tsx` | Test connection, discover tools, OAuth discovery on 401 |
| `app/routes/api.settings.mcp-oauth-token.tsx` | Exchange authorization code for OAuth tokens (PKCE) |
| `app/components/chat/McpAppRenderer.tsx` | MCP App rendering — iframe sandbox, postMessage, maximize |
| `app/engine/handlers/mcp.ts` | Workflow MCP node handler — dedicated McpClient per execution |

### API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/mcp/tool-call` | POST | Proxy tool call for iframe (CORS bypass) |
| `/api/mcp/resource-read` | POST | Proxy resource read for iframe |
| `/api/settings/mcp-test` | POST | Test server connection, list tools, OAuth discovery |
| `/api/settings/mcp-oauth-token` | POST | Exchange OAuth authorization code for tokens |
