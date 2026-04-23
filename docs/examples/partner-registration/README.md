# Partner Registration Example

Hubwork の登録（新規サインアップ）＋マジックリンクログインのサンプル。登録メール・ログインメールを Markdown テンプレートでカスタマイズする例も含む。

## File Structure

```
web/
  register/partner.html         → /register/partner  （登録フォーム）
  login/partner.html            → /login/partner     （ログインフォーム）
  partner/index.html            → /partner/          （ログイン後ランディング、要認証）

emails/
  partner/login.md              → ログインメールテンプレート
  partner/register.md           → 登録確認メールテンプレート
```

## Setup

### 1. Google Sheets

スプレッドシートに `Partners` シートを作成:

| email | name | company |
|-------|------|---------|
| （登録後に追加される） |  |  |

ヘッダー行のみあれば OK。登録検証後、メール・氏名・会社名が自動で追加される。

### 2. settings.json

`settings-example.json` を参考に、`hubwork.accounts.partner` に以下を追加:

- `identity`: 既存の Partners シートをログイン認証に使用
- `register.fields`: 登録フォームで収集するフィールド（name, company）
- `register.duplicatePolicy`: `"silent-login"`（デフォルト）= 登録済みメールが来たらログインリンクを送る

### 3. Deploy

`web/` と `emails/` 以下を丸ごと GemiHub の rootDir に配置して Push。

## Flow

### 新規登録

1. Partner が `/register/partner` にアクセス
2. 氏名・会社名・メールを入力して送信 → `gemihub.auth.register("partner", email, { name, company })`
3. Firestore に `hubwork-pending-registrations/{token}` が保存される（10 分 TTL）
4. `emails/partner/register.md` テンプレートで登録確認メール送信（`{{registerLink}}` 変数に検証 URL が差し込まれる）
5. Partner がメール内のリンクをクリック → `/__gemihub/auth/register/verify/:token`
6. サーバーが Firestore トークン検証 → Partners シートに行追加 → `__hubwork_partner` Cookie 発行
7. `/partner/` にリダイレクト

**重複検出**: 登録フォームに既存メールが送られた場合、デフォルト（`silent-login`）ではログインリンクを代わりに送る。情報漏えい防止として「登録済みですよ」とは返さない。

### ログイン

既存コンタクトは `/login/partner` から通常どおりマジックリンクでログイン。

## Email Template 変数

`emails/partner/*.md` の Markdown 本文と YAML frontmatter `subject` 内で `{{var}}` 形式で使える:

| 変数 | 用途 | login | register |
|------|------|:----:|:--------:|
| `{{magicLink}}` | ログイン用検証 URL | ✓ | - |
| `{{registerLink}}` | 登録用検証 URL | - | ✓ |
| `{{email}}` | 送信先メール | ✓ | ✓ |
| `{{accountType}}` | アカウントタイプ | ✓ | ✓ |
| `{{siteName}}` | リクエスト Host | ✓ | ✓ |
| `{{expiresInMinutes}}` | リンクの有効期限（分） | ✓ | ✓ |
| `{{redirectPath}}` | ログイン後遷移先 | ✓ | ✓ |
| フォーム項目（`{{name}}` 等） | `register.fields` の各値 | - | ✓ |

`{{var}}` は HTML エスケープ（XSS 対策）。URL は `{{{var}}}` を使うのが慣習（ReactMarkdown が正規化するため `{{var}}` でも結果は変わらないが、Mustache 的に triple-brace が明示的）。

テンプレートファイルが存在しない場合は `emails/login.md` / `emails/register.md`（アカウント共通）にフォールバックし、それも無ければ組み込みデフォルトが使われる。
