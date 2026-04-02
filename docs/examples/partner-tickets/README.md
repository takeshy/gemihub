# Partner Ticket Listing Example

Hubwork の Multi-Type Auth + Workflow API を使った Partner チケット一覧ページのサンプル。

## File Structure

```
web/
  login/partner.html              → /login/partner (ログインページ)
  partner/tickets.html            → /partner/tickets (チケット一覧、要認証)
  api/partner/tickets.yaml        → /__gemihub/api/partner/tickets (チケット取得 API)
```

## Setup

### 1. Google Sheets

Spreadsheet に以下のシートを作成:

**Partners シート** (認証用):

| email | company_name | contact_name |
|-------|-------------|-------------|
| partner@example.com | Acme Inc | John Doe |

**Tickets シート** (チケットデータ):

| partner_email | subject | description | status | category | createdate | updated_date |
|--------------|---------|-------------|--------|----------|-----------|-------------|
| partner@example.com | Bug report #1 | Login button not working | open | bug | 2026-03-01 | 2026-03-15 |
| partner@example.com | Feature request | Add dark mode | in_progress | feature | 2026-03-10 | 2026-03-20 |

### 2. settings.json

`settings-example.json` を参考に、`settings.json` の `hubwork.accounts` に partner アカウントタイプを追加。

### 3. Deploy

全ファイルを GemiHub の `web/` フォルダに配置して Push。

## Flow

1. Partner が `/login/partner` にアクセス
2. メールアドレスを入力 → マジックリンクが送信される
3. メール内のリンクをクリック → `__hubwork_partner` Cookie が発行される
4. `/partner/tickets` にリダイレクト
5. `gemihub.auth.require("partner")` で認証チェック (未認証なら `/login/partner` に戻る)
6. `gemihub.get("partner/tickets")` で Workflow API を呼び出し
7. Workflow が `Tickets` シートから `partner_email` でフィルタして返却
8. HTML で一覧を描画
