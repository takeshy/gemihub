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
```

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
    const events = await gemihub.get("interview/events", {
      start: "2025-04-01T00:00:00+09:00",
      end: "2025-04-01T23:59:59+09:00"
    });

    // 6. Submit via POST API
    document.getElementById("booking-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await gemihub.post("interview/book", {
          name: "山田 太郎",
          start: "2025-04-01T10:00:00Z",
          end: "2025-04-01T10:30:00Z",
          datetime: "2025-04-01 10:00"
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
    timeMin: "{{query.start}}"
    timeMax: "{{query.end}}"
    saveTo: events

  - id: respond
    comment: "取得した予定リストをAPIのレスポンスとして返す"
    type: set
    name: __response
    value: "{{events}}"
```

## POST API Endpoint (`web/api/interview/book.yaml`)

Creates a calendar event, records in a sheet, and sends confirmation email. Side effects (write, email) use POST.

```yaml
trigger:
  requireAuth: partner

nodes:
  - id: create_event
    comment: "Googleカレンダーに事前面談の予定を登録する"
    type: calendar-create
    calendarId: primary
    summary: "{{body.name}} 事前予約"
    start: "{{body.start}}"
    end: "{{body.end}}"

  - id: write_sheet
    comment: "スプレッドシート(meetingsシート)に予約情報を記録する"
    type: sheet-write
    sheet: meetings
    data: '[{"contact_email": "{{auth.email}}", "subject": "{{body.name}} 事前予約", "start_at": "{{body.start}}"}]'

  - id: send_mail
    comment: "予約者へ予約完了の通知メールを送信する"
    type: gmail-send
    to: "{{auth.email}}"
    subject: "事前面談の予約完了のお知らせ"
    body: |
      {{body.name}} 様

      事前面談の予約を承りました。

      ■ 予約日時: {{body.datetime}}

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
  "partner": {
    "email": "test-partner@example.com",
    "name": "山田 パートナー",
    "profile": {
      "contact_name": "山田 太郎",
      "company_name": "株式会社パートナーズ"
    }
  }
}
```
