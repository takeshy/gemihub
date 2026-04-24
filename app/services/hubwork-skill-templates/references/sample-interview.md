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
- email: string (e.g. "jane@example.com")
- name: string (e.g. "Jane Doe")
- created_at: datetime (e.g. "2025-04-01T10:00:00Z")
- logined_at: datetime (e.g. "2025-04-10T09:30:00Z")

## meetings
- id: string (e.g. "550e8400-e29b-41d4-a716-446655440000")
- account_email: string (e.g. "jane@example.com")
- subject: string (e.g. "Pre-interview booking")
- start_at: datetime (e.g. "2025-04-15T14:00:00Z")
- created_at: datetime (e.g. "2025-04-01T10:00:00Z")
- status: string (e.g. "active" — values: active / cancelled / no_show)
- cancelled_at: datetime (state-change timestamp; populated when an operator cancels or marks no-show)
- cancelled_by: string (operator email, e.g. "owner@example.com")
- cancel_reason: string (optional free-text reason)
```

The `status` / `cancelled_*` / `cancel_reason` columns are written by the **admin side** (operator-facing pages under `admin/`), not by the partner-facing booking flow. They enable soft-delete cancellation and no-show tracking without losing the original row. See `references/admin-patterns.md` for the admin workflow templates and the rationale for keeping admin pages out of `web/`.

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
      start: "2025-04-01T00:00:00Z",
      end: "2025-04-01T23:59:59Z"
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
          name: "Jane Doe",
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
    comment: "Fetch events in the requested window from Google Calendar"
    type: calendar-list
    calendarId: primary
    timeMin: "{{request.query.start}}"
    timeMax: "{{request.query.end}}"
    saveTo: events

  - id: respond
    comment: "Return the event list as the API response"
    type: set
    name: __response
    value: "{{events}}"
```

## GET API Endpoint (`web/api/interview/slots.yaml`) — Available Slots from Calendar

Common "pick an open 30-minute slot" pattern: read calendar, subtract busy windows, return the free slots formatted for display. The critical interpolation rule is `{{events}}` **without `:json` and without surrounding quotes** — GemiHub stores every variable as a JSON-serialized string, and JSON is a valid JS literal, so the array drops straight into the script as a bare `[{...}]` literal. Using `{{events:json}}` unquoted escapes the quotes into `\"` and crashes the script at parse time.

Locale parameters (`"en-US"`, `"UTC"`) in the example are placeholders — pick the locale and timeZone that match the user's request when building a real workflow.

```yaml
trigger:
  requireAuth: partner

nodes:
  - id: prep_window
    comment: "Build a 7-day window starting at 09:00 tomorrow"
    type: script
    saveTo: window
    code: |
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      return { timeMin: start.toISOString(), timeMax: end.toISOString() };

  - id: get_events
    comment: "Fetch existing events in the window (they block slots)"
    type: calendar-list
    calendarId: primary
    timeMin: "{{window.timeMin}}"
    timeMax: "{{window.timeMax}}"
    saveTo: events

  - id: generate_slots
    comment: "Walk 30-minute slots, drop ones that overlap existing events"
    type: script
    saveTo: slots
    code: |
      # {{events}} is pasted bare (no :json, no surrounding quotes) — the stored JSON string doubles as a valid JS array literal
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
                displayDate: slotStart.toLocaleDateString("en-US", {
                  weekday: "short", month: "short", day: "numeric",
                }),
                displayTime: slotStart.toLocaleTimeString("en-US", {
                  hour: "2-digit", minute: "2-digit",
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

Locale parameters (`"en-US"`, `"UTC"`) in the example are placeholders — swap them for the locale and timeZone that match the user's request. The email subject and body text should also be written in the user's conversation language, not verbatim English.

```yaml
trigger:
  requireAuth: partner

nodes:
  - id: prepare
    comment: "Generate the UUID, storage timestamp, a human-readable date string, and any values that mix user input with fixed text. The template engine has no UUID / date-format helpers, so these always come from a script node. Request values are embedded safely inside JS string literals with :json + surrounding \"...\"."
    type: script
    saveTo: prepared
    code: |
      const start = "{{request.body.start:json}}";
      const end = "{{request.body.end:json}}";
      const name = "{{request.body.name:json}}";
      return {
        id: utils.randomUUID(),
        now: new Date().toISOString(),
        subject: name + " - Pre-interview booking",
        displayRange:
          new Date(start).toLocaleString("en-US", {
            dateStyle: "long", timeStyle: "short", timeZone: "UTC",
          }) + " – " +
          new Date(end).toLocaleString("en-US", {
            timeStyle: "short", timeZone: "UTC",
          }),
      };

  - id: create_event
    comment: "Create the booking on Google Calendar. Reuse prepared.subject so the calendar summary and the sheet subject stay in sync."
    type: calendar-create
    calendarId: primary
    summary: "{{prepared.subject}}"
    start: "{{request.body.start}}"
    end: "{{request.body.end}}"

  - id: write_sheet
    comment: "Append the booking to the meetings sheet. status: \"active\" is the default; admin pages flip it to cancelled / no_show via sheet-update."
    type: sheet-write
    sheet: meetings
    data: '[{"id": "{{prepared.id}}", "account_email": "{{auth.email:json}}", "subject": "{{prepared.subject:json}}", "start_at": "{{request.body.start}}", "created_at": "{{prepared.now}}", "status": "active"}]'

  - id: send_mail
    comment: "Send the booking confirmation. Use prepared.displayRange (locale-formatted) in the body — never the raw ISO string from request.body."
    type: gmail-send
    to: "{{auth.email}}"
    subject: "Pre-interview booking confirmed"
    body: |
      Hi {{request.body.name}},

      Your pre-interview booking has been confirmed.

      Date & time: {{prepared.displayRange}}

      Thank you — talk soon.

  - id: respond
    comment: "Return a success payload"
    type: set
    name: __response
    value: '{"ok": true}'
```

## Optional: Expose Own Meetings as `{{auth.meetings}}` (via `data:` config)

A common follow-up endpoint is "show the logged-in partner their own bookings." The straightforward way is a `sheet-read` filtered by `{{auth.email:json}}`, but there's a less error-prone alternative: configure a `data:` source on the account type so the runtime exposes the user's meetings as `{{auth.meetings}}` automatically.

Hand-edit the `partner` account type in `settings.json` under `hubwork.accounts`:

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

With that in place, a list endpoint is one node — the framework already filtered by the authenticated user's email so there is no way to accidentally leak another partner's rows:

```yaml
# web/api/interview/my-bookings.yaml
trigger:
  requireAuth: partner

nodes:
  - id: respond
    type: set
    name: __response
    value: "{{auth.meetings}}"
```

Contrast with the explicit `sheet-read` form, which still works and is needed for admin-style endpoints where the filter isn't "records for me":

```yaml
# Equivalent, but requires the author to remember the filter every time
- id: read_meetings
  type: sheet-read
  sheet: meetings
  filter: '{"user_email": "{{auth.email:json}}"}'
  saveTo: meetings
- id: respond
  type: set
  name: __response
  value: "{{meetings}}"
```

Use the `data:` form when "records for the authenticated user" is the full filter; reach for `sheet-read` when you need query-time filtering by other columns (status, date range), joins, or admin / cross-user access.

## IDE Preview Mock Data (`web/__gemihub/auth/me.json`)

```json
{
  "accountType": "partner",
  "email": "test-partner@example.com",
  "name": "Sample Partner",
  "profile": {
    "contact_name": "Jane Doe",
    "company_name": "Example Partners Inc."
  }
}
```
