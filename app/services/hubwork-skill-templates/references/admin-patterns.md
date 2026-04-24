# Hubwork Admin Patterns

管理画面 (operator-facing UI) 専用のテンプレ集。**公開サイト (`web/`) とは完全に分離**し、`admin/` 配下に置く。

## Why `admin/` (not `web/admin/`)

Hubwork の公開ルーティングは `web/` プレフィックスのファイルしかサーブしない (`app/services/hubwork-page.server.ts` / `app/services/hubwork-api-resolver.server.ts`)。`admin/` 配下は **カスタムドメインから 404**。つまり管理画面は GemiHub IDE 内でのみ閲覧・操作される。

このおかげで:
- 専用の `admin` account type / マジックリンク / `requireAuth: admin` を用意する必要がない (公開されていないので盗聴されない)
- Drive 所有者 (=IDE にログインしている Google アカウント) が自動的に管理者になる
- 公開の `meetings`/`inquiries` などと同じスプレッドシートを直接読み書きできる

**絶対にやってはいけない:** `web/admin/...` に admin ページを置く — 公開ルーティングに乗って全世界から admin API が叩けるようになる。

## File Layout

```
admin/
  index.html                 → IDE 内「admin プレビュー」で開く管理トップ
  bookings.html              → 予約一覧 (active / cancelled / no_show タブ)
  inquiries.html             → 問い合わせ一覧 + 詳細/返信フォームをインライン展開
  api/
    bookings/list.yaml       → sheet-read meetings 全件
    bookings/status.yaml     → sheet-update meetings (cancel / no_show)
    inquiries/list.yaml      → sheet-read inquiries 全件
    inquiries/reply.yaml     → sheet-update inquiries + gmail-send
```

**単一ページ + インライン展開の慣習 (重要):** IDE プレビューは iframe の srcDoc で HTML を描画しているため、`location.search` / `location.pathname` の URL 状態や `[id]` パス引数は取れない。したがって admin 画面では「詳細ページを別ファイルにしない」ことを原則とし、一覧ページ内で行クリック時にモーダル or 行内展開で詳細 + 操作フォームを表示する。ID は JS の `selectedId` 変数で保持する。Hubwork 本番ドメインでは `[id].html` パターンが使えるが、admin 画面は IDE でしか動かないので使わない。

各 HTML は通常通り `<script src="/__gemihub/api.js"></script>` を読み、`gemihub.get("bookings/list")` のように呼ぶ (公開側が `gemihub.get("tickets/list")` で `web/api/tickets/list.yaml` を呼ぶのと同じ慣習 — `admin/` プレフィックスは HTML の配置で決まるので、呼び出し側には書かない)。IDE の admin プレビューがこれを `admin/api/bookings/list.yaml` のローカル実行に振り替える。

## IDE-only execution model

Admin ワークフローは Hubwork ランタイムではなく **IDE の admin プレビュー** が実行する。そのため公開側の `auth.*` 変数系は使えず、代わりに IDE が `session.*` を注入する:

| 変数 | 内容 |
|------|------|
| `{{session.email}}` | IDE にログイン中の Google アカウントのメール (=管理者) |

- **`trigger.requireAuth` を書かない** — Hubwork 側の認証機構を通さない。
- **`auth.email` / `auth.<col>` を使わない** — admin ワークフローでは未定義になる。`{{session.email}}` を使う。
- **`data:` config を使わない** — `data:` は Hubwork の「ログイン中ユーザー自身の行だけを返す」機能。admin は全行読むのが仕事なので `sheet-read` を直接叩く。

## Soft Delete 運用規約

予約キャンセル・無断キャンセル・問い合わせのアーカイブは **ハード削除 (`sheet-delete`) しない**。監査ログを残すため `sheet-update` で `status` 列を書き換える。

`meetings` に足す列:

```markdown
## meetings
- id: string
- account_email: string
- subject: string
- start_at: datetime
- created_at: datetime
- status: string (e.g. "active" / "cancelled" / "no_show")
- cancelled_at: datetime (status 変更時刻)
- cancelled_by: string (操作者の email = {{session.email}})
- cancel_reason: string (任意)
```

`cancelled_at` / `cancelled_by` は「状態変更記録」列として `cancelled` と `no_show` で共用する (カラム数を抑えるため)。

`inquiries` (新設):

```markdown
## inquiries
- id: string
- submissionId: string (client-generated idempotency key; filter target for dedup on re-submit)
- name: string
- email: string
- subject: string
- message: string
- status: string (e.g. "new" / "replied" / "archived")
- created_at: datetime
- reply_text: string
- reply_at: datetime
- reply_by: string
```

`submissionId` は公開フォーム (`web/api/contact.yaml`) の dedup 用。詳しくは `references/page-patterns.md` の「API Workflow Template (Public Contact Form)」を参照。

1 inquiry = 1 reply を前提とする。複数往復の履歴が必要になったら `inquiry_replies` シートを別に切る (v1 では対応しない)。

### 顧客側フィルタの更新

`meetings` に `status` 列を足したら、顧客側の「自分の予約一覧」ページも同期して更新する必要がある。既存の `data:` config や `sheet-read` フィルタに `status` 条件を追加:

```json
{
  "meetings": {
    "sheet": "meetings",
    "matchBy": "account_email",
    "fields": ["id", "subject", "start_at", "status"],
    "where": { "status_in": ["active", ""] }
  }
}
```

(where 句は runtime 実装依存 — なければ `sheet-read` で読んでクライアントで `status !== "cancelled" && status !== "no_show"` でフィルタ。空文字は「古い行 = active 扱い」とする。)

## Admin Dashboard Page Template (`admin/index.html`)

管理トップ。予約件数・未返信問い合わせ件数をサマリ表示し、各管理ページへのリンクを並べる。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理画面</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-white border-b">
    <div class="max-w-5xl mx-auto px-4 py-4">
      <h1 class="text-xl font-bold">管理画面</h1>
      <p id="signed-in" class="text-sm text-gray-500"></p>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-2 gap-4">
    <a href="/admin/bookings.html" class="block bg-white rounded shadow p-6 hover:bg-gray-50">
      <h2 class="font-semibold mb-2">予約管理</h2>
      <p class="text-sm text-gray-600">有効 <span id="n-active" class="font-bold">-</span> 件 /
         キャンセル <span id="n-cancelled">-</span> /
         無断 <span id="n-no-show">-</span></p>
    </a>
    <a href="/admin/inquiries.html" class="block bg-white rounded shadow p-6 hover:bg-gray-50">
      <h2 class="font-semibold mb-2">問い合わせ管理</h2>
      <p class="text-sm text-gray-600">未返信 <span id="n-new" class="font-bold">-</span> 件 /
         返信済 <span id="n-replied">-</span></p>
    </a>
  </main>
  <script src="/__gemihub/api.js"></script>
  <script>
    (async () => {
      // admin プレビューが session.email を注入しているので auth.require は不要
      const me = await gemihub.auth.me();
      document.getElementById("signed-in").textContent =
        me ? `ログイン中: ${me.email}` : "";

      const [bookings, inquiries] = await Promise.all([
        gemihub.get("bookings/list"),
        gemihub.get("inquiries/list"),
      ]);
      const count = (arr, fn) => arr.filter(fn).length;
      document.getElementById("n-active").textContent =
        count(bookings, b => !b.status || b.status === "active");
      document.getElementById("n-cancelled").textContent =
        count(bookings, b => b.status === "cancelled");
      document.getElementById("n-no-show").textContent =
        count(bookings, b => b.status === "no_show");
      document.getElementById("n-new").textContent =
        count(inquiries, i => i.status === "new" || !i.status);
      document.getElementById("n-replied").textContent =
        count(inquiries, i => i.status === "replied");
    })();
  </script>
</body>
</html>
```

## Admin Bookings List Template (`admin/bookings.html`)

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>予約管理</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-white border-b">
    <div class="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
      <h1 class="text-xl font-bold">予約管理</h1>
      <a href="/admin/index.html" class="text-sm text-gray-500 hover:text-gray-700">← 管理トップ</a>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div class="mb-4 flex gap-2" id="tabs">
      <button data-tab="active"    class="px-3 py-1 border rounded bg-white">有効</button>
      <button data-tab="cancelled" class="px-3 py-1 border rounded bg-white">キャンセル</button>
      <button data-tab="no_show"   class="px-3 py-1 border rounded bg-white">無断キャンセル</button>
    </div>
    <table class="w-full bg-white rounded shadow text-sm">
      <thead class="border-b text-left">
        <tr><th class="p-2">日時</th><th class="p-2">顧客</th><th class="p-2">件名</th>
            <th class="p-2">状態</th><th class="p-2">操作</th></tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
  </main>
  <script src="/__gemihub/api.js"></script>
  <script>
    (async () => {
      const bookings = await gemihub.get("bookings/list");

      const render = (st) => {
        const tbody = document.getElementById("rows");
        tbody.innerHTML = "";
        const rows = bookings.filter(b => (b.status || "active") === st);
        if (rows.length === 0) {
          tbody.innerHTML = `<tr><td class="p-4 text-gray-400" colspan="5">該当なし</td></tr>`;
          return;
        }
        rows.forEach(b => {
          const tr = document.createElement("tr");
          tr.className = "border-b";
          tr.innerHTML = `
            <td class="p-2">${escape(b.start_at)}</td>
            <td class="p-2">${escape(b.account_email)}</td>
            <td class="p-2">${escape(b.subject || "")}</td>
            <td class="p-2">${b.status || "active"}</td>
            <td class="p-2 space-x-2">
              ${st === "active"
                ? `<button class="cancel px-2 py-1 border rounded text-xs" data-id="${b.id}">キャンセル</button>
                   <button class="no-show px-2 py-1 border rounded text-xs" data-id="${b.id}">無断</button>`
                : `<button class="restore px-2 py-1 border rounded text-xs" data-id="${b.id}">有効に戻す</button>`}
            </td>`;
          tbody.appendChild(tr);
        });
      };

      const escape = (s) =>
        String(s ?? "").replace(/[&<>"']/g, c =>
          ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

      document.querySelector("main").addEventListener("click", async (e) => {
        const id = e.target.dataset.id;
        if (!id) return;
        let status, reason = "";
        if (e.target.classList.contains("cancel"))    { status = "cancelled"; reason = prompt("キャンセル理由 (任意):", "") || ""; }
        else if (e.target.classList.contains("no-show")) { status = "no_show"; reason = prompt("備考 (任意):", "") || ""; }
        else if (e.target.classList.contains("restore")) { status = "active"; }
        else return;

        if (!confirm(`この予約を ${status} にしますか?`)) return;
        await gemihub.post("bookings/status", { id, status, reason });
        // 再取得
        const fresh = await gemihub.get("bookings/list");
        bookings.length = 0;
        bookings.push(...fresh);
        render(document.querySelector("#tabs .active")?.dataset.tab || "active");
      });

      const switchTab = (tab) => {
        document.querySelectorAll("#tabs button").forEach(b =>
          b.classList.toggle("active", b.dataset.tab === tab));
        render(tab);
      };
      document.querySelectorAll("#tabs button").forEach(btn =>
        btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
      switchTab("active");
    })();
  </script>
</body>
</html>
```

## Admin Inquiries Page Template (`admin/inquiries.html`)

**1 ページに一覧 + 詳細 + 返信フォームをすべて入れる**。行をクリックすると右側パネル (または下展開) に詳細と返信フォームが出る。IDE プレビューで URL 遷移が取れないため、別 `[id].html` には分けないのが admin 画面の大原則。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>問い合わせ管理</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-white border-b">
    <div class="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
      <h1 class="text-xl font-bold">問い合わせ管理</h1>
      <a href="/admin/index.html" class="text-sm text-gray-500 hover:text-gray-700">← 管理トップ</a>
    </div>
  </header>
  <main class="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
    <!-- Left: list -->
    <section>
      <div class="mb-4 flex gap-2" id="tabs">
        <button data-tab="new"     class="px-3 py-1 border rounded bg-white">未返信</button>
        <button data-tab="replied" class="px-3 py-1 border rounded bg-white">返信済</button>
      </div>
      <ul id="rows" class="bg-white rounded shadow divide-y"></ul>
    </section>

    <!-- Right: detail + reply -->
    <section>
      <div id="empty-detail" class="bg-white rounded shadow p-6 text-gray-400 text-sm">
        左の一覧から問い合わせを選択してください。
      </div>
      <div id="detail" class="hidden bg-white rounded shadow p-4 space-y-4">
        <div>
          <div class="text-xs text-gray-500" id="d-meta"></div>
          <h2 class="font-semibold" id="d-subject"></h2>
          <div class="mt-2 text-sm whitespace-pre-wrap" id="d-message"></div>
        </div>
        <div id="existing-reply" class="hidden text-sm bg-gray-50 p-3 rounded">
          <div class="text-xs text-gray-500 mb-1" id="er-meta"></div>
          <div class="whitespace-pre-wrap" id="er-text"></div>
        </div>
        <form id="reply-form" class="space-y-3">
          <textarea id="reply" rows="8" required
            class="w-full border rounded p-2" placeholder="返信本文..."></textarea>
          <button type="submit"
            class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">送信</button>
        </form>
        <div id="message-box" class="text-sm hidden"></div>
      </div>
    </section>
  </main>
  <script src="/__gemihub/api.js"></script>
  <script>
    (async () => {
      let inquiries = await gemihub.get("inquiries/list");
      let selectedId = null;
      let activeTab = "new";
      const escape = (s) =>
        String(s ?? "").replace(/[&<>"']/g, c =>
          ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

      const renderList = () => {
        const ul = document.getElementById("rows");
        ul.innerHTML = "";
        const rows = inquiries.filter(i => (i.status || "new") === activeTab);
        if (rows.length === 0) {
          ul.innerHTML = `<li class="p-4 text-gray-400">該当なし</li>`;
          return;
        }
        rows.forEach(i => {
          const li = document.createElement("li");
          li.className = "p-4 cursor-pointer hover:bg-gray-50" +
            (i.id === selectedId ? " bg-blue-50" : "");
          li.dataset.id = i.id;
          li.innerHTML = `
            <div class="text-xs text-gray-500">${escape(i.created_at)}</div>
            <div class="font-semibold">${escape(i.subject || "(件名なし)")}</div>
            <div class="text-sm text-gray-600">${escape(i.name)} &lt;${escape(i.email)}&gt;</div>`;
          ul.appendChild(li);
        });
      };

      const renderDetail = () => {
        const inquiry = inquiries.find(i => i.id === selectedId);
        document.getElementById("empty-detail").classList.toggle("hidden", !!inquiry);
        document.getElementById("detail").classList.toggle("hidden", !inquiry);
        if (!inquiry) return;

        document.getElementById("d-meta").textContent =
          `${inquiry.created_at} — ${inquiry.name} <${inquiry.email}>`;
        document.getElementById("d-subject").textContent = inquiry.subject || "(件名なし)";
        document.getElementById("d-message").textContent = inquiry.message || "";

        const er = document.getElementById("existing-reply");
        if (inquiry.status === "replied" && inquiry.reply_text) {
          er.classList.remove("hidden");
          document.getElementById("er-meta").textContent =
            `${inquiry.reply_at} — ${inquiry.reply_by}`;
          document.getElementById("er-text").textContent = inquiry.reply_text;
          document.getElementById("reply").value = inquiry.reply_text;
        } else {
          er.classList.add("hidden");
          document.getElementById("reply").value = "";
        }
        document.getElementById("message-box").classList.add("hidden");
      };

      document.getElementById("rows").addEventListener("click", (e) => {
        const li = e.target.closest("li[data-id]");
        if (!li) return;
        selectedId = li.dataset.id;
        renderList();
        renderDetail();
      });

      document.getElementById("reply-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!selectedId) return;
        const reply_text = document.getElementById("reply").value.trim();
        if (!reply_text) return;
        if (!confirm("この内容で返信しますか? 送信メールは取り消せません。")) return;
        const box = document.getElementById("message-box");
        box.className = "text-sm"; box.textContent = "送信中...";
        try {
          await gemihub.post("inquiries/reply", { id: selectedId, reply_text });
          box.className = "text-sm text-green-600";
          box.textContent = "返信を送信しました。";
          inquiries = await gemihub.get("inquiries/list");
          renderList(); renderDetail();
        } catch (err) {
          box.className = "text-sm text-red-600";
          box.textContent = err?.response?.error || "送信に失敗しました。";
        }
      });

      const switchTab = (tab) => {
        activeTab = tab;
        selectedId = null;
        document.querySelectorAll("#tabs button").forEach(b =>
          b.classList.toggle("active", b.dataset.tab === tab));
        renderList();
        renderDetail();
      };
      document.querySelectorAll("#tabs button").forEach(btn =>
        btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
      switchTab("new");
    })();
  </script>
</body>
</html>
```

## API Workflow Templates

### Admin Bookings List (`admin/api/bookings/list.yaml`)

```yaml
# admin は全件を見るので auth フィルタは付けない
nodes:
  - id: read
    type: sheet-read
    sheet: meetings
    saveTo: result

  - id: respond
    type: set
    name: __response
    value: "{{result}}"
```

### Admin Bookings Status Update (`admin/api/bookings/status.yaml`)

1 本のワークフローで `cancelled` / `no_show` / `active` 復帰の 3 つを扱う。**復帰時は `cancelled_at` / `cancelled_by` / `cancel_reason` をクリア**する (列名と中身が乖離しないように); キャンセル/無断キャンセルでは状態変更記録として書き込む。

```yaml
nodes:
  - id: prepare
    comment: "status の妥当性チェックと now の生成"
    type: script
    saveTo: prepared
    code: |
      const status = "{{request.body.status:json}}";
      const allowed = ["active", "cancelled", "no_show"];
      if (!allowed.includes(status)) {
        throw new Error("Invalid status: " + status);
      }
      return {
        now: new Date().toISOString(),
        status,
      };

  - id: branch_restore
    comment: "active 復帰は cancelled_* をクリア。cancel/no_show は状態変更記録を残す"
    type: if
    condition: '"{{prepared.status}}" === "active"'
    trueNext: restore
    falseNext: cancel_or_no_show

  - id: restore
    comment: "cancelled_* を空文字でクリアして整合性を保つ"
    type: sheet-update
    sheet: meetings
    filter: '{"id": "{{request.body.id:json}}"}'
    data: '[{"status": "active", "cancelled_at": "", "cancelled_by": "", "cancel_reason": ""}]'
    next: respond

  - id: cancel_or_no_show
    type: sheet-update
    sheet: meetings
    filter: '{"id": "{{request.body.id:json}}"}'
    data: '[{"status": "{{prepared.status}}", "cancelled_at": "{{prepared.now}}", "cancelled_by": "{{session.email:json}}", "cancel_reason": "{{request.body.reason:json}}"}]'

  - id: read_back
    comment: "通知メールの宛先と件名に使う顧客情報を引く"
    type: sheet-read
    sheet: meetings
    filter: '{"id": "{{request.body.id:json}}"}'
    saveTo: row

  - id: notify
    type: gmail-send
    to: "{{row[0].account_email}}"
    subject: "ご予約の状態が変更されました"
    body: |
      {{row[0].account_email}} 様

      下記のご予約の状態が「{{prepared.status}}」に変更されました。

      日時: {{row[0].start_at}}
      件名: {{row[0].subject}}
      備考: {{request.body.reason}}

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

### Admin Inquiries List (`admin/api/inquiries/list.yaml`)

```yaml
# 一覧ページは全件を受け取り、詳細もフロント側 (inquiries.find(i => i.id === selectedId))
# で引くので `[id].yaml` は不要。件数がスケールしたら limit / sort を足す。
nodes:
  - id: read
    type: sheet-read
    sheet: inquiries
    saveTo: result

  - id: respond
    type: set
    name: __response
    value: "{{result}}"
```

### Admin Inquiry Reply (`admin/api/inquiries/reply.yaml`)

**ノード順に注意**: メール送信を先に行い、成功した場合のみ `status: "replied"` でシートを更新する。逆順にすると、`gmail-send` 失敗時にシートだけ「返信済」になり実際の返信が顧客に届かない事故が起きる (運営者は「送った」と思い込んで再送しない)。

```yaml
nodes:
  - id: prepare
    type: script
    saveTo: prepared
    code: |
      return { now: new Date().toISOString() };

  - id: read_target
    comment: "返信先 (顧客のメール / 名前 / 件名) を引く。送信が先なので update より前に読む"
    type: sheet-read
    sheet: inquiries
    filter: '{"id": "{{request.body.id:json}}"}'
    saveTo: row

  - id: send
    comment: 'ここで失敗するとワークフローが止まり、status は "new" のまま残る → 運営者が再試行できる'
    type: gmail-send
    to: "{{row[0].email}}"
    subject: "Re: {{row[0].subject}}"
    body: |
      {{row[0].name}} 様

      {{request.body.reply_text}}

      ---
      {{session.email}}

  - id: update
    comment: "メール送信に成功した行だけを replied に更新"
    type: sheet-update
    sheet: inquiries
    filter: '{"id": "{{request.body.id:json}}"}'
    data: '[{"reply_text": "{{request.body.reply_text:json}}", "reply_at": "{{prepared.now}}", "reply_by": "{{session.email:json}}", "status": "replied"}]'

  - id: respond
    type: set
    name: __response
    value: '{"ok": true}'
```

## Admin Pre-Save Checklist

通常の Pre-Save Checklist に加え、admin ページ / admin API には以下も適用:

### Admin HTML pages
- [ ] ファイルが `admin/` 配下にある (`web/admin/` ではない)
- [ ] `gemihub.auth.require("admin", ...)` を呼ばない (admin account type は存在しない)
- [ ] `data:` config (`auth.meetings` 等) を使わない
- [ ] 表示文字列は `escape()` で HTML エスケープする (admin は自分だけが見るが、顧客由来の値 `name`/`subject`/`message` などに `<script>` が混入していても無害にするため)

### Admin API workflows (YAML)
- [ ] ファイルが `admin/api/` 配下にある
- [ ] `trigger.requireAuth` を書いていない (admin 実行経路は IDE プレビューが認証を担保)
- [ ] `auth.email` / `auth.<col>` を使っていない。操作者を記録する列には `{{session.email:json}}` を使う
- [ ] `sheet-update` / `sheet-delete` の `filter:` に `"id": "{{request.body.id:json}}"` のような一意キーを使う (誤って全行更新しない)
- [ ] キャンセル系は `sheet-update` でソフト削除 (`sheet-delete` は使わない)
- [ ] 通知メールの件名・本文は `request.body.*` を **`{{...}}` の bare 展開** で使う (gmail-send の body フィールドは JSON リテラルではないので `:json` は不要 / むしろ有害)

## Future Extensions

- 複数往復のやり取り: `inquiry_replies` シートを切り、`inquiries.id` を foreign key にする
- 運営設定 (通知先メール・定型返信文・営業時間): `config` シートを作り、admin 画面で編集
- スタッフ別アクセス権: 必要になったら `admins` シート + Hubwork account type を追加 (IDE プレビューではなく Hubwork 側で認証)
