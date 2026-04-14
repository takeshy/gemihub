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
- Form POST → redirects to `__redirectUrl` / `request.body.__redirect` / Referer

### Input Variables

| Variable | Source |
|----------|--------|
| `request.method` | `"GET"` or `"POST"` |
| `request.query.*` | URL query parameters |
| `request.params.*` | `[param]` captures from URL pattern |
| `request.body.*` | POST JSON body or form fields |
| `auth.type` | Account type (only if `requireAuth` is set) |
| `auth.email` | Authenticated email (only if `requireAuth` is set) |
| `currentUser` | JSON string of user profile data |

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

## IDE Preview Mock Data

When previewing Hubwork pages in the IDE (localhost or gemihub.online), real Hubwork auth and API calls are not available. Place mock data JSON files in `web/__gemihub/` to enable preview.

### Auth Mock (`web/__gemihub/auth/me.json`)

Flat structure containing the user data normally returned by `auth.me()`. The optional `accountType` field restricts the mock to a specific account type (returns null/401 for other types). Omit it to allow any type.

```json
{
  "accountType": "partner",
  "email": "test@example.com",
  "profile": {
    "email": "test@example.com",
    "company_name": "テスト株式会社",
    "contact_name": "テスト太郎"
  }
}
```

`gemihub.auth.me("partner")` returns `{ type: "partner", email: "test@example.com", profile: { ... } }` in IDE mode (the `accountType` field is stripped from the response).

### API Mock (`web/__gemihub/api/{path}.json`)

Each mock file corresponds to an API endpoint. The JSON content is returned directly as the response.

```
web/__gemihub/api/users/list.json    -> mock for gemihub.get("users/list")
web/__gemihub/api/users/[id].json    -> mock for gemihub.get("users/123")
```

Supports exact path matching and `[param]` pattern matching (same rules as workflow API routing).

**Note:** Mock files are read from Google Drive. They must be pushed (synced) to Drive before they take effect in IDE preview.

## Available Workflow Node Types

For API workflows, commonly used nodes:

| Node | Description |
|------|-------------|
| `sheet-read` | Read rows (filter, limit, saveTo) |
| `sheet-write` | Append rows |
| `sheet-update` | Update rows matching filter |
| `sheet-delete` | Delete rows matching filter |
| `calendar-list` | List calendar events (calendarId, timeMin, timeMax, maxResults, query, saveTo) |
| `calendar-create` | Create calendar event (calendarId, summary, start, end, description?, location?) |
| `calendar-update` | Update calendar event (calendarId, eventId, summary?, start?, end?, description?, location?) |
| `calendar-delete` | Delete calendar event (calendarId, eventId) |
| `gmail-send` | Send email (to, subject, body) |
| `set` | Set a variable value |
| `if` | Conditional branch |
| `json` | Parse/build JSON |
| `http` | HTTP request |
| `variable` | Declare a variable with default value |

### `calendar-list` Response Format

`calendar-list` returns a JSON array of event objects. **`start` and `end` are flat ISO 8601 strings, NOT nested objects.** Use `evt.start` directly — never `evt.start.dateTime`.

```json
[
  {
    "id": "abc123",
    "summary": "Meeting",
    "description": "...",
    "start": "2025-04-01T10:00:00+09:00",
    "end": "2025-04-01T11:00:00+09:00",
    "location": "...",
    "status": "confirmed",
    "htmlLink": "https://calendar.google.com/..."
  }
]
```

**In HTML pages**, parse the response like this:

```javascript
const events = await gemihub.get("interview/events", { start: "...", end: "..." });
events.forEach(evt => {
  const startTime = new Date(evt.start);  // Direct string — NOT evt.start.dateTime
  const endTime = new Date(evt.end);      // Direct string — NOT evt.end.dateTime
});
```
