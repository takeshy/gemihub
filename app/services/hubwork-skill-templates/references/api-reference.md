# Hubwork API Reference

## Client Helper (`/__gemihub/api.js`)

Include in every HTML page that needs data or auth:

```html
<script src="/__gemihub/api.js"></script>
```

### Data API

```javascript
// GET request — returns parsed JSON
const data = await gemihub.get("path/to/endpoint", { key: "value" });

// POST request — sends JSON body, returns parsed JSON
const result = await gemihub.post("path/to/endpoint", { key: "value" });
```

Both throw on non-2xx responses. The error object has `.status` and `.response` properties.

### Auth API

```javascript
// Get current user data. Returns null if not authenticated (never throws on 401).
const user = await gemihub.auth.me("accountType");
// Returns: { type, email, ...dataFields } or null

// Send magic link email (redirect defaults to current page path)
await gemihub.auth.login("accountType", "user@example.com");
await gemihub.auth.login("accountType", "user@example.com", "/dashboard"); // custom redirect
// Returns: { ok: true }

// Destroy session cookie
await gemihub.auth.logout("accountType");

// Guard: check auth and redirect to login page if not authenticated.
// Returns user object or redirects (never resolves if redirecting).
const user = await gemihub.auth.require("accountType", "/login/path");
```

## File Routing

```
web/index.html           → /
web/about.html           → /about
web/users/[id].html      → /users/123, /users/abc
web/api/users/list.yaml  → /__gemihub/api/users/list
web/api/users/[id].yaml  → /__gemihub/api/users/123
```

## Workflow API (`/__gemihub/api/*`)

YAML files in `web/api/` are executed as workflows. The response depends on the request Content-Type:

- JSON or GET → returns `__response` variable as JSON
- Form POST → redirects to `__redirectUrl` / `body.__redirect` / Referer

### Input Variables

| Variable | Source |
|----------|--------|
| `query.*` | URL query parameters |
| `params.*` | `[param]` captures from URL pattern |
| `body.*` | POST JSON body or form fields |
| `auth.type` | Account type (only if `requireAuth` is set) |
| `auth.email` | Authenticated email (only if `requireAuth` is set) |
| `currentUser` | JSON string of user profile data |
| `request.method` | `"GET"` or `"POST"` |

### Trigger Options

```yaml
trigger:
  requireAuth: accountType    # Single type name (required for protected APIs)
  apiTimeoutSec: "30"         # Timeout in seconds (max 60)
  # Form-specific:
  honeypotField: "_hp"
  idempotencyKeyField: "submissionId"
  successRedirect: "/thanks"
  errorRedirect: "/error"
```

### Response Variables

| Variable | Effect |
|----------|--------|
| `__response` | JSON response body (parsed before sending) |
| `__statusCode` | HTTP status code (JSON mode only, default 200) |
| `__redirectUrl` | Redirect target (form mode only) |

## Account Types Configuration (settings.json)

```json
{
  "hubwork": {
    "spreadsheetId": "...",
    "accounts": {
      "typeName": {
        "identity": {
          "sheet": "SheetName",
          "emailColumn": "email"
        },
        "data": {
          "profile": {
            "sheet": "SheetName",
            "matchBy": "email",
            "fields": ["email", "name", "company"],
            "shape": "object"
          }
        }
      }
    }
  }
}
```

- `identity` — which sheet and column to check for magic link login
- `data` — optional user data sources returned by `auth.me(type)`

## Available Workflow Node Types

For API workflows, commonly used nodes:

| Node | Description |
|------|-------------|
| `sheet-read` | Read rows (filter, limit, saveTo) |
| `sheet-write` | Append rows |
| `sheet-update` | Update rows matching filter |
| `sheet-delete` | Delete rows matching filter |
| `gmail-send` | Send email (to, subject, body) |
| `set` | Set a variable value |
| `if` | Conditional branch |
| `json` | Parse/build JSON |
| `http` | HTTP request |
| `variable` | Declare a variable with default value |
