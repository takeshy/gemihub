# Hubwork Page Patterns

## Login Page Template

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md px-4">
    <div class="bg-white rounded-lg shadow-md p-8">
      <h1 class="text-2xl font-bold text-center mb-6">Login</h1>
      <form id="login-form" class="space-y-4">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input id="email" type="email" required placeholder="you@example.com"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <button type="submit" id="submit-btn"
          class="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 font-medium">
          Send Login Link
        </button>
      </form>
      <div id="message" class="mt-4 text-center text-sm hidden"></div>
    </div>
  </div>
  <script src="/__gemihub/api.js"></script>
  <script>
    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("submit-btn");
      const msg = document.getElementById("message");
      btn.disabled = true;
      btn.textContent = "Sending...";
      msg.classList.add("hidden");
      try {
        const params = new URLSearchParams(window.location.search);
        const redirect = params.get("redirect") || "/";
        await gemihub.auth.login("ACCOUNT_TYPE", document.getElementById("email").value, redirect);
        msg.textContent = "Login link sent. Please check your email.";
        msg.className = "mt-4 text-center text-sm text-green-600";
      } catch {
        msg.textContent = "An error occurred. Please try again.";
        msg.className = "mt-4 text-center text-sm text-red-600";
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Login Link";
      }
    });
  </script>
</body>
</html>
```

Replace `ACCOUNT_TYPE` with the actual account type name (e.g., "partner", "talent").

## Protected Page Template

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-white border-b">
    <div class="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
      <h1 class="text-xl font-bold">Dashboard</h1>
      <div class="flex items-center gap-4 text-sm">
        <span id="user-name" class="text-gray-500"></span>
        <button id="logout-btn" class="text-gray-400 hover:text-gray-600">Logout</button>
      </div>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div id="loading" class="text-center py-20 text-gray-400">Loading...</div>
    <div id="content" class="hidden">
      <!-- Page content here -->
    </div>
  </main>
  <script src="/__gemihub/api.js"></script>
  <script>
    (async () => {
      const user = await gemihub.auth.require("ACCOUNT_TYPE", "/login/ACCOUNT_TYPE");
      if (!user) return;
      document.getElementById("user-name").textContent = user.email;
      document.getElementById("logout-btn").addEventListener("click", async () => {
        await gemihub.auth.logout("ACCOUNT_TYPE");
        window.location.href = "/login/ACCOUNT_TYPE";
      });
      // Fetch data via gemihub.get() — NEVER use raw fetch() for API calls
      // gemihub.get("tickets") calls /__gemihub/api/tickets internally
      const tickets = await gemihub.get("tickets");
      // Render data...
      document.getElementById("loading").classList.add("hidden");
      document.getElementById("content").classList.remove("hidden");
    })();
  </script>
</body>
</html>
```

## API Workflow Template (Read)

```yaml
trigger:
  requireAuth: ACCOUNT_TYPE

nodes:
  - id: read_data
    type: sheet-read
    sheet: SheetName
    filter: '{"email": "{{auth.email}}"}'
    saveTo: result

  - id: respond
    type: set
    name: __response
    value: "{{result}}"
```

## API Workflow Template (Write)

```yaml
trigger:
  requireAuth: ACCOUNT_TYPE

nodes:
  - id: write_data
    type: sheet-write
    sheet: SheetName
    data: '[{"email": "{{auth.email}}", "title": "{{request.body.title}}", "content": "{{request.body.content}}"}]'

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

## Form Submission (No JS Required)

```html
<form action="/__gemihub/api/contact" method="POST">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <input type="hidden" name="__redirect" value="/thanks">
  <button type="submit">Send</button>
</form>
```

## Spec File Template (`web/__gemihub/spec.md`)

````markdown
# {Site Name}

## Overview

{1-2 sentence description of what this site does}

## Pages

| Path | Description | Auth |
|------|-------------|------|
| `/login/{type}` | Login page | - |
| `/{page}` | {description} | {type} |

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/__gemihub/api/{path}` | {description} | {type} |
| POST | `/__gemihub/api/{path}` | {description} | {type} |

## Data Sources

| Type | Name | Usage |
|------|------|-------|
| Spreadsheet | {SheetName} | {what data it stores} |

## Account Types

| Type | Description |
|------|-------------|
| {type} | {who uses this account} |
````

Fill in the placeholders based on the actual pages and APIs created. Remove sections that don't apply (e.g., remove "Account Types" if no auth is used).

## IDE Preview Mock Data

When creating pages with auth or API calls, also create mock data files for IDE preview.

### Auth mock file (`web/__gemihub/auth/me.json`)

Flat structure. The fields match what `auth.me()` returns (i.e., the `data` fields configured in settings.json for that account type). The optional `accountType` field restricts the mock to a specific account type — if omitted, the mock applies to any type requested by the page.

```json
{
  "accountType": "ACCOUNT_TYPE",
  "email": "test@example.com",
  "profile": {
    "email": "test@example.com",
    "company_name": "テスト株式会社",
    "contact_name": "テスト太郎"
  }
}
```

Replace `ACCOUNT_TYPE` with the actual type name (e.g., `"partner"`, `"customer"`).

**Note:** Mock files must be pushed (synced) to Drive before they take effect in IDE preview.

### API mock file (`web/__gemihub/api/{path}.json`)

For an API endpoint at `web/api/tickets/list.yaml`, create `web/__gemihub/api/tickets/list.json`:

```json
[
  {"id": "1", "title": "テストチケット", "status": "open", "email": "test@example.com"},
  {"id": "2", "title": "サンプルチケット", "status": "closed", "email": "test@example.com"}
]
```

For parameterized endpoints like `web/api/tickets/[id].yaml`, create `web/__gemihub/api/tickets/[id].json`:

```json
{"id": "1", "title": "テストチケット", "status": "open", "email": "test@example.com"}
```
