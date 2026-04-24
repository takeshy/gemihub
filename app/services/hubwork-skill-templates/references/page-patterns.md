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

## Register Page Template

Self-registration flow: user lands on the page UNAUTHENTICATED, fills in their email plus any profile fields the site requires (name, phone, etc.), and submits. `gemihub.post("register", body)` hands the submission to a workflow that writes the row and sends a confirmation email. Register pages MUST NOT call `gemihub.auth.require()` / `gemihub.auth.me()` — the user has no session yet; any auth check will redirect to /login and blank the page.

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Register</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md px-4">
    <div class="bg-white rounded-lg shadow-md p-8">
      <h1 class="text-2xl font-bold text-center mb-6">Create account</h1>
      <form id="register-form" class="space-y-4">
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label for="name" class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input id="name" name="name" type="text" required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <!-- Add additional profile fields here, matching the sheet columns -->
        <button type="submit" id="submit-btn"
          class="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 font-medium">
          Send confirmation email
        </button>
      </form>
      <div id="message" class="mt-4 text-center text-sm hidden"></div>
    </div>
  </div>
  <script src="/__gemihub/api.js"></script>
  <script>
    // NO gemihub.auth.require() / gemihub.auth.me() — this page is for
    // brand-new visitors. An auth check here redirects to /login and blanks
    // the page (IDE preview sets me() to null on register pages so this
    // mistake shows up as an obvious /login redirect).
    document.getElementById("register-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("submit-btn");
      const msg = document.getElementById("message");
      btn.disabled = true;
      btn.textContent = "Sending...";
      msg.classList.add("hidden");
      try {
        const body = {
          email: document.getElementById("email").value,
          name: document.getElementById("name").value,
          // Add the other profile fields here
        };
        await gemihub.post("register", body);
        msg.textContent = "Confirmation email sent. Please check your inbox to complete registration.";
        msg.className = "mt-4 text-center text-sm text-green-600";
        document.getElementById("register-form").classList.add("hidden");
      } catch (err) {
        msg.textContent = err?.response?.error || "An error occurred. Please try again.";
        msg.className = "mt-4 text-center text-sm text-red-600";
      } finally {
        btn.disabled = false;
        btn.textContent = "Send confirmation email";
      }
    });
  </script>
</body>
</html>
```

The endpoint path MUST be literally `register` (or `register/<sub-path>`) so the IDE preview can detect the page via its POST target and stub out `gemihub.auth.me()`. A workflow at `web/api/register.yaml` handles the submission — see the **API Workflow Template (Public Register)** section below.

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
    filter: '{"email": "{{auth.email:json}}"}'
    saveTo: result

  - id: respond
    type: set
    name: __response
    value: "{{result}}"
```

## API Workflow Template (Public Register)

Paired with the Register Page Template. The trigger is **public** (no `requireAuth`) because the user has no session yet. Email duplicates short-circuit to a silent success response — this prevents account-enumeration (leaking whether an email is already registered). The welcome/confirmation email is sent AFTER the write so it can reference the just-created row.

```yaml
# web/api/register.yaml — PUBLIC endpoint (no requireAuth)
nodes:
  - id: existing
    type: sheet-read
    sheet: accounts
    filter: '{"email": "{{request.body.email:json}}"}'
    saveTo: existing

  - id: check_dup
    comment: "Silent success on duplicate — never reveal whether an email is already registered"
    type: if
    condition: "{{existing.length}} > 0"
    trueNext: respond
    falseNext: prepare

  - id: prepare
    type: script
    saveTo: prepared
    code: |
      return {
        created_at: new Date().toISOString(),
      };

  - id: write
    type: sheet-write
    sheet: accounts
    data: '[{"email": "{{request.body.email:json}}", "name": "{{request.body.name:json}}", "created_at": "{{prepared.created_at}}"}]'

  - id: welcome
    type: gmail-send
    to: "{{request.body.email}}"
    subject: "Registration complete"
    body: |
      {{request.body.name}} さん、ご登録ありがとうございます。

      このメールは自動送信されています。心当たりのない場合は破棄してください。

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

Add one row per additional profile field the Register Page Template collects (match the column names exactly — use `get_spreadsheet_schema` to confirm). Every user-derived placeholder inside the JSON string literals is `:json`-escaped.

**For verified registration** (user must click an email link BEFORE the row is written), use Hubwork's built-in platform flow instead — configure it via `accountType.register` on the settings side rather than a user-written workflow. User-written `register.yaml` workflows handle the immediate-registration case above.

## API Workflow Template (Write)

```yaml
trigger:
  requireAuth: ACCOUNT_TYPE

nodes:
  - id: write_data
    type: sheet-write
    sheet: SheetName
    data: '[{"email": "{{auth.email:json}}", "title": "{{request.body.title:json}}", "content": "{{request.body.content:json}}"}]'

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

## API Workflow Template (Write + Email Confirmation)

Use this pattern for any POST endpoint that records a dated event (bookings, orders, reservations) and sends a user-facing confirmation email. The `script` node generates the ID, storage timestamp, and a locale-formatted display string in one place; the `gmail-send` body reads the formatted string so the recipient sees `April 15, 2025 at 2:00 PM` instead of `2025-04-15T14:00:00Z`.

```yaml
trigger:
  requireAuth: ACCOUNT_TYPE

nodes:
  - id: prepare
    comment: "Generate id, now (for storage), and a human-readable date (for email)"
    type: script
    saveTo: prepared
    code: |
      const start = "{{request.body.start:json}}";
      const end = "{{request.body.end:json}}";
      return {
        id: utils.randomUUID(),
        now: new Date().toISOString(),
        displayRange:
          new Date(start).toLocaleString("en-US", {
            dateStyle: "long", timeStyle: "short", timeZone: "UTC",
          }) + " – " +
          new Date(end).toLocaleString("en-US", {
            timeStyle: "short", timeZone: "UTC",
          }),
      };

  - id: write_sheet
    comment: "Storage columns use raw ISO; id/created_at come from the script node"
    type: sheet-write
    sheet: SheetName
    data: '[{"id": "{{prepared.id}}", "account_email": "{{auth.email:json}}", "scheduled_at": "{{request.body.start}}", "created_at": "{{prepared.now}}"}]'

  - id: send_mail
    comment: "Body uses prepared.displayRange — NEVER raw {{request.body.start}}"
    type: gmail-send
    to: "{{auth.email}}"
    subject: "Booking confirmed"
    body: |
      Your booking is scheduled for {{prepared.displayRange}}.

      Thank you.

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

Rules when adapting this template:
- `data:` stays a **single-quoted JSON string** (not a YAML mapping) — the runtime `JSON.parse`s it.
- The `script` node's `saveTo` object is accessed via dot notation (`{{prepared.id}}`). The template engine auto-parses JSON strings, so no `json` node is needed.
- Keep raw ISO in sheet columns (so filters/sorts work) and only use the formatted field in user-facing fields (`gmail-send body`, `dialog message`, any `__response` shown directly).
- For calendar integration, add a `calendar-create` node between `prepare` and `write_sheet` (see `references/sample-interview.md`).

## API Workflow Template (Read Own Records via `auth.<key>` — no `sheet-read` needed)

When a logged-in user should only see their own rows in a sheet, configure a `data:` source on the account type in `settings.json` and the runtime exposes the pre-filtered rows as `{{auth.<key>}}` on every authenticated request. No `sheet-read` node, no forgettable `"{{auth.email}}"` filter, no way for an author to accidentally leak another user's data.

**Configure once** (hand-edit `settings.json` under `hubwork.accounts.<TYPE>`):

```json
{
  "identity": { "sheet": "accounts", "emailColumn": "email" },
  "data": {
    "meetings": {
      "sheet": "meetings",
      "matchBy": "user_email",
      "fields": ["id", "title", "scheduled_at", "status", "created_at"],
      "shape": "array",
      "sort": "-scheduled_at",
      "limit": 100
    }
  }
}
```

Each key under `data:` becomes one `{{auth.<key>}}` variable scoped to the authenticated user. `sheet` / `matchBy` select the sheet and the column that must equal the user's email; `fields` limits what's exposed; `shape: "array"` returns a list, `"object"` returns the first match only; `sort` takes a column name, prefix `-` for descending; `limit` caps the result.

**Use in the workflow** — list endpoint shrinks to a single `set` node:

```yaml
trigger:
  requireAuth: ACCOUNT_TYPE

nodes:
  - id: respond
    type: set
    name: __response
    value: "{{auth.meetings}}"
```

Deep dot access works too (e.g. `{{auth.meetings[0].title}}` for the latest row's title) because the runtime stores the combined `auth` object as a JSON blob that the template resolver lazily parses. Use `"object"` shape when you only want one row (`{{auth.profile.company}}`), `"array"` when you want every matching row.

Use this instead of a `sheet-read` whenever the only filter is "records for the authenticated user". Drop back to `sheet-read` for admin views (no per-user filter) or when you need query-time filtering by other columns.

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

## Public Contact Form Page Template (`web/contact.html`)

問い合わせフォーム。公開ページで **未ログインのまま送信できる** (`gemihub.auth.require()` を使わない)。送信先の workflow は `web/api/contact.yaml` で、`inquiries` シートに行を追加 + 運営者に通知メール + 任意で自動返信メールを送る (下の **API Workflow Template (Public Contact Form)** 参照)。返信は **IDE の admin プレビュー** で `admin/inquiries.html` (一覧 + インライン詳細 + 返信フォームを 1 ページに統合) から行う (詳細は `references/admin-patterns.md`)。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>お問い合わせ</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md px-4">
    <div class="bg-white rounded-lg shadow-md p-8">
      <h1 class="text-2xl font-bold text-center mb-6">お問い合わせ</h1>
      <form id="contact-form" class="space-y-4">
        <div>
          <label for="name" class="block text-sm font-medium text-gray-700 mb-1">お名前</label>
          <input id="name" name="name" type="text" required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
          <input id="email" name="email" type="email" required placeholder="you@example.com"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label for="subject" class="block text-sm font-medium text-gray-700 mb-1">件名</label>
          <input id="subject" name="subject" type="text" required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
        </div>
        <div>
          <label for="message" class="block text-sm font-medium text-gray-700 mb-1">本文</label>
          <textarea id="message" name="message" rows="6" required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
        </div>
        <!-- honeypot: ボットは埋めがち、人間は見えない。workflow 側の script ノードで拒否 -->
        <input type="text" name="_hp" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true">
        <!-- idempotency key: フォーム初期化時に一意な値を入れる。同じフォームインスタンスから再送されても workflow 側の sheet-read で既存行が見つかって silent success する -->
        <input type="hidden" name="submissionId" id="submissionId">
        <button type="submit" id="submit-btn"
          class="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 font-medium">
          送信
        </button>
      </form>
      <div id="message-box" class="mt-4 text-center text-sm hidden"></div>
    </div>
  </div>
  <script src="/__gemihub/api.js"></script>
  <script>
    // NO gemihub.auth.require() — 公開フォーム。訪問者はログインしていなくてよい。
    // submissionId はフォーム初期化時に一意に採番する (crypto.randomUUID が使えない旧ブラウザは Math.random にフォールバック)。
    // 同じフォームインスタンスで再送信されたら同じ id が送られるので workflow 側で重複判定される。
    document.getElementById("submissionId").value =
      (self.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    document.getElementById("contact-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("submit-btn");
      const box = document.getElementById("message-box");
      btn.disabled = true;
      btn.textContent = "送信中...";
      box.classList.add("hidden");
      try {
        await gemihub.post("contact", {
          name:    document.getElementById("name").value,
          email:   document.getElementById("email").value,
          subject: document.getElementById("subject").value,
          message: document.getElementById("message").value,
          _hp:     "",
          submissionId: document.getElementById("submissionId").value,
        });
        box.textContent = "お問い合わせを受け付けました。担当より返信いたします。";
        box.className = "mt-4 text-center text-sm text-green-600";
        document.getElementById("contact-form").classList.add("hidden");
      } catch (err) {
        box.textContent = err?.response?.error || "送信に失敗しました。時間をおいて再度お試しください。";
        box.className = "mt-4 text-center text-sm text-red-600";
      } finally {
        btn.disabled = false;
        btn.textContent = "送信";
      }
    });
  </script>
</body>
</html>
```

## API Workflow Template (Public Contact Form)

問い合わせフォームの受け口。public (no `trigger.requireAuth`)、honeypot でボット除け、`inquiries` シートに `status: "new"` で書き込み、運営者に通知メール + 問い合わせ者に自動返信を送る。運営者の返信は後から `admin/inquiries.html` (IDE プレビュー — 一覧 + インライン詳細 + 返信フォームを 1 ページに統合) で行う。

`notify_owner` の `to:` は **サイト運営者の固定メールアドレス**。スキルを使ってこのテンプレを展開する際は、ユーザーに「運営者通知を受け取るメールアドレス」を聞いてから埋めること (デフォルトで他人のアドレスを書かない)。

**重要:** ハニーポット / idempotency は workflow ノードで実装する。`trigger.honeypotField` / `trigger.idempotencyKeyField` オプションは **form POST (urlencoded / multipart)** でしか動かず、`gemihub.post()` が送る JSON リクエストには効かない。したがって JS 経由で叩く公開 API では `trigger:` にこの 2 つを書かず、下記のように `script` + `if` + `sheet-read` で同等の処理を手組みする。

```yaml
# web/api/contact.yaml — PUBLIC endpoint (no requireAuth)
# JSON POST 用。honeypot と idempotency は workflow 側で判定する。
nodes:
  - id: prepare
    comment: "honeypot チェック + UUID + 送信者が付けた submissionId を保持"
    type: script
    saveTo: prepared
    code: |
      const hp = "{{request.body._hp:json}}";
      const sid = "{{request.body.submissionId:json}}";
      return {
        isBot: hp.length > 0,
        id: utils.randomUUID(),
        now: new Date().toISOString(),
        submissionId: sid || utils.randomUUID(),
      };

  - id: check_bot
    comment: "honeypot が埋まっていたら silent success で終了 (ボットに検知を悟らせない)"
    type: if
    condition: "{{prepared.isBot}} === true"
    trueNext: respond
    falseNext: dedup

  - id: dedup
    comment: "idempotency: 同じ submissionId が既にあれば再書込しない"
    type: sheet-read
    sheet: inquiries
    filter: '{"submissionId": "{{prepared.submissionId:json}}"}'
    saveTo: dupes

  - id: check_dedup
    type: if
    condition: "{{dupes.length}} > 0"
    trueNext: respond
    falseNext: write

  - id: write
    type: sheet-write
    sheet: inquiries
    data: '[{"id": "{{prepared.id}}", "submissionId": "{{prepared.submissionId:json}}", "name": "{{request.body.name:json}}", "email": "{{request.body.email:json}}", "subject": "{{request.body.subject:json}}", "message": "{{request.body.message:json}}", "status": "new", "created_at": "{{prepared.now}}"}]'

  - id: notify_owner
    comment: "運営者への通知。to: はサイト運営者のアドレスをユーザーに聞いて埋める"
    type: gmail-send
    to: "owner@example.com"
    subject: "新しいお問い合わせ: {{request.body.subject}}"
    body: |
      from: {{request.body.name}} <{{request.body.email}}>
      subject: {{request.body.subject}}

      {{request.body.message}}

      ---
      ID: {{prepared.id}}
      受信: {{prepared.now}}

  - id: auto_reply
    comment: "自動返信 (不要なら削除)。スパム抑制や運用方針で省略してよい"
    type: gmail-send
    to: "{{request.body.email}}"
    subject: "お問い合わせを受け付けました"
    body: |
      {{request.body.name}} 様

      お問い合わせありがとうございます。
      内容を確認のうえ担当よりご返信いたします。

      --- お問い合わせ内容 ---
      件名: {{request.body.subject}}

      {{request.body.message}}

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

`inquiries` シートには **`submissionId` 列が必要** (上記 `dedup` の `filter` で参照)。スキーマと運営者返信フローは `references/admin-patterns.md` にまとめてある。

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

**Language**: Translate section headings, column headers, and descriptive text to match the language the user is conversing in (same rule as the Plan step). Keep path strings, account type identifiers, sheet names, and other code-like tokens as-is.

## History File Template (`web/__gemihub/history.md`)

````markdown
# {Site Name} — History

## YYYY-MM-DD
- {short summary of what was added/changed/removed in this iteration}
- {another change}

## YYYY-MM-DD
- {previous iteration's changes}
````

Entries are reverse-chronological (newest first). When updating, PREPEND a new dated section above the existing entries — never overwrite previous history. Use the same language as `spec.md`. Use today's date in `YYYY-MM-DD` format.

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
    "company_name": "Example Corp",
    "contact_name": "Test User"
  }
}
```

Replace `ACCOUNT_TYPE` with the actual type name (e.g., `"partner"`, `"customer"`).

**Note:** Mock files must be pushed (synced) to Drive before they take effect in IDE preview.

### API mock file (`web/__gemihub/api/{path}.json`)

For an API endpoint at `web/api/tickets/list.yaml`, create `web/__gemihub/api/tickets/list.json`:

```json
[
  {"id": "1", "title": "Sample Ticket", "status": "open", "email": "test@example.com"},
  {"id": "2", "title": "Example Ticket", "status": "closed", "email": "test@example.com"}
]
```

For parameterized endpoints like `web/api/tickets/[id].yaml`, create `web/__gemihub/api/tickets/[id].json`:

```json
{"id": "1", "title": "Sample Ticket", "status": "open", "email": "test@example.com"}
```
