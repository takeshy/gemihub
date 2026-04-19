# Sample: Interview Booking System

A complete example of a partner-facing booking system with authentication, calendar integration, and email notification. Use this as a reference when building similar features.

## File Structure

```
web/
  login/partner.html              → /login/partner (login page — see page-patterns.md Login template)
  partner/interview.html          → /partner/interview (protected booking page)
  api/interview/events.yaml       → GET /__gemihub/api/interview/events (calendar API)
  api/interview/book.yaml         → POST /__gemihub/api/interview/book (booking API)
  __gemihub/auth/me.json          → IDE preview mock data
  __gemihub/schema.md             → Spreadsheet schema (updated to add meetings sheet)
```

## Schema Update (before creating pages)

This sample uses a `meetings` sheet. Before building, update `web/__gemihub/schema.md` to add it:

```markdown
## accounts
- email: string (e.g. "taro@example.com")
- name: string (e.g. "山田 太郎")
- created_at: datetime (e.g. "2025-04-01T10:00:00+09:00")
- logined_at: datetime (e.g. "2025-04-10T09:30:00+09:00")

## meetings
- id: string (e.g. "550e8400-e29b-41d4-a716-446655440000")
- account_email: string (e.g. "taro@example.com")
- subject: string (e.g. "事前面談予約")
- start_at: datetime (e.g. "2025-04-15T14:00:00+09:00")
- created_at: datetime (e.g. "2025-04-01T10:00:00+09:00")
```

Then call `migrate_spreadsheet_schema` with the schema content to create the sheet in the spreadsheet.

## Protected Page Key Patterns (`web/partner/interview.html`)

Auth guard, data loading, form submission, and logout — the structural patterns for any protected page:

```html
<script src="/__gemihub/api.js"></script>
<script>
  (async () => {
    // 1. Auth guard — redirects to login if not authenticated
    const user = await gemihub.auth.require("partner", "/login/partner");
    if (!user) return;

    // 2. Use user data (from auth.me profile fields)
    document.getElementById("user-name").textContent = user.email;
    if (user.name) {
      document.getElementById("partner-name").value = user.name;
    }

    // 3. Logout handler
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await gemihub.auth.logout("partner");
      window.location.href = "/login/partner";
    });

    // 4. Switch from loading to content
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("content").classList.remove("hidden");

    // 5. Fetch data from GET API
    // calendar-list returns flat start/end strings — use evt.start directly, NOT evt.start.dateTime
    const events = await gemihub.get("interview/events", {
      start: "2025-04-01T00:00:00+09:00",
      end: "2025-04-01T23:59:59+09:00"
    });
    // Each event: { id, summary, start: "ISO string", end: "ISO string", ... }
    // Check conflicts: compare with new Date(evt.start) and new Date(evt.end)

    // 6. Submit via POST API
    // Only send raw ISO values. Ids, timestamps, and locale-formatted display
    // strings are generated server-side in the workflow's script node — don't
    // pre-compute them here (client clocks are untrusted; duplicating the
    // logic drifts between HTML and YAML).
    document.getElementById("booking-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await gemihub.post("interview/book", {
          name: "山田 太郎",
          start: "2025-04-01T10:00:00Z",
          end: "2025-04-01T10:30:00Z",
        });
        window.location.href = "/partner/interview-complete";
      } catch (err) {
        // error handling
      }
    });
  })();
</script>
```

## GET API Endpoint (`web/api/interview/events.yaml`)

Reads calendar events for a given time range. GET APIs are read-only.

```yaml
trigger:
  requireAuth: partner

nodes:
  - id: get_events
    comment: "カレンダーから指定期間内の予定リストを取得する"
    type: calendar-list
    calendarId: primary
    timeMin: "{{request.query.start}}"
    timeMax: "{{request.query.end}}"
    saveTo: events

  - id: respond
    comment: "取得した予定リストをAPIのレスポンスとして返す"
    type: set
    name: __response
    value: "{{events}}"
```

## GET API Endpoint (`web/api/interview/slots.yaml`) — Available Slots from Calendar

Common "pick an open 30-minute slot" pattern: read calendar, subtract busy windows, return the free slots formatted for display. The critical interpolation rule is `{{events}}` **without `:json` and without surrounding quotes** — GemiHub stores every variable as a JSON-serialized string, and JSON is a valid JS literal, so the array drops straight into the script as a bare `[{...}]` literal. Using `{{events:json}}` unquoted escapes the quotes into `\"` and crashes the script at parse time.

```yaml
trigger:
  requireAuth: partner

nodes:
  - id: prep_window
    comment: "翌日 09:00 から 7 日間のウィンドウを生成する"
    type: script
    saveTo: window
    code: |
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { timeMin: start.toISOString(), timeMax: end.toISOString() };

  - id: get_events
    comment: "ウィンドウ内の既存予定を取得（この予定が空きを塞ぐ）"
    type: calendar-list
    calendarId: primary
    timeMin: "{{window.timeMin}}"
    timeMax: "{{window.timeMax}}"
    saveTo: events

  - id: generate_slots
    comment: "30 分刻みのスロットを events と突き合わせて空き分だけ返す"
    type: script
    saveTo: slots
    code: |
      # {{events}} は :json なし・引用符なしで貼る（JSON 文字列がそのまま JS 配列リテラルになる）
      const events = {{events}} || [];
      const windowStart = new Date("{{window.timeMin:json}}");
      const out = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(windowStart.getTime() + d * 24 * 60 * 60 * 1000);
        for (let h = 9; h < 18; h++) {
          for (let m = 0; m < 60; m += 30) {
            const slotStart = new Date(day);
            slotStart.setHours(h, m, 0, 0);
            const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
            const conflict = events.some(evt => {
              const evStart = new Date(evt.start);
              const evEnd = new Date(evt.end);
              return slotStart < evEnd && slotEnd > evStart;
            });
            if (!conflict) {
              out.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
                displayDate: slotStart.toLocaleDateString("ja-JP", {
                  weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Tokyo",
                }),
                displayTime: slotStart.toLocaleTimeString("ja-JP", {
                  hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo",
                }),
              });
            }
          }
        }
      }
      return out;

  - id: respond
    type: set
    name: __response
    value: "{{slots}}"
```

Interpolation rules used above:
- `{{events}}` — bare, no `:json`, no quotes. Correct for iterating a JSON array/object stored by `calendar-list`, `sheet-read`, or a prior `script` node.
- `"{{window.timeMin:json}}"` — surrounding `"..."` + `:json`. Correct for embedding a single string value inside a JS string literal (`new Date("...")`, `console.log("...")`, etc.).
- NEVER `{{events:json}}` without surrounding quotes — escapes the JSON's `"` into `\"` and the script fails with a parse error.

## POST API Endpoint (`web/api/interview/book.yaml`)

Creates a calendar event, records in a sheet, and sends confirmation email. Side effects (write, email) use POST. The `meetings` sheet is created automatically on the first `sheet-write` — no manual setup needed.

```yaml
trigger:
  requireAuth: partner

nodes:
  - id: prepare
    comment: "UUID・現在時刻・ユーザー向け表示用日時文字列を生成する。UUID/タイムスタンプ/ロケール整形はテンプレートエンジンにヘルパーがないので、必ず script ノードで計算する。リクエスト値は :json 修飾子 + 囲み引用符(\"{{...:json}}\")で安全に文字列リテラルへ埋め込む"
    type: script
    saveTo: prepared
    code: |
      const start = "{{request.body.start:json}}";
      const end = "{{request.body.end:json}}";
      return {
        id: crypto.randomUUID(),
        now: new Date().toISOString(),
        displayRange:
          new Date(start).toLocaleString("ja-JP", {
            dateStyle: "long", timeStyle: "short", timeZone: "Asia/Tokyo",
          }) + " – " +
          new Date(end).toLocaleString("ja-JP", {
            timeStyle: "short", timeZone: "Asia/Tokyo",
          }),
      };

  - id: create_event
    comment: "Googleカレンダーに事前面談の予定を登録する"
    type: calendar-create
    calendarId: primary
    summary: "{{request.body.name}} 事前予約"
    start: "{{request.body.start}}"
    end: "{{request.body.end}}"

  - id: write_sheet
    comment: "スプレッドシート(meetingsシート)に予約情報を記録する。id/created_at は script ノードで生成した値を参照する"
    type: sheet-write
    sheet: meetings
    data: '[{"id": "{{prepared.id}}", "account_email": "{{auth.email}}", "subject": "{{request.body.name}} 事前予約", "start_at": "{{request.body.start}}", "created_at": "{{prepared.now}}"}]'

  - id: send_mail
    comment: "予約者へ予約完了の通知メールを送信する。日時は ISO 文字列ではなく prepared.displayRange(ロケール整形済み)を使う"
    type: gmail-send
    to: "{{auth.email}}"
    subject: "事前面談の予約完了のお知らせ"
    body: |
      {{request.body.name}} 様

      事前面談の予約を承りました。

      ■ 予約日時: {{prepared.displayRange}}

      当日はよろしくお願いいたします。

  - id: respond
    comment: "成功したことを示すレスポンスを返す"
    type: set
    name: __response
    value: '{"ok": true}'
```

## IDE Preview Mock Data (`web/__gemihub/auth/me.json`)

```json
{
  "accountType": "partner",
  "email": "test-partner@example.com",
  "name": "山田 パートナー",
  "profile": {
    "contact_name": "山田 太郎",
    "company_name": "株式会社パートナーズ"
  }
}
```
