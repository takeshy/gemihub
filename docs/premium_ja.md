# プレミアムプラン

GemiHub のプレミアムプランは、Google Sheets / Gmail 連携、静的ページホスティング、スケジュール実行、カスタムドメイン対応を備えた Web アプリビルダーへと拡張します。

## アーキテクチャ概要

```
Load Balancer + Cloud CDN + Certificate Manager
  ├── *.gemihub.online     → Cloud Run (ワイルドカードサブドメイン)
  ├── app.acme.com         → Cloud Run (カスタムドメイン)
  └── app.other.com        → Cloud Run (カスタムドメイン)

Cloud Run (シングルインスタンス、マルチテナント)
  ├── GemiHub IDE (既存の無料機能)
  ├── プレミアム API (Host ヘッダーからアカウントを解決)
  ├── ページプロキシ (Drive から読み取り、Cache-Control 付きで返却 → CDN がキャッシュ)
  ├── スケジュールワークフロー実行エンドポイント
  └── isolated-vm (サーバーサイド script ノード実行)

Firestore
  ├── hubwork-accounts/{id}                — アカウント情報、暗号化されたリフレッシュトークン
  ├── hubwork-accounts/{id}/scheduleIndex  — 希望するスケジュール構成のインデックス (settings.json から同期)
  ├── hubwork-accounts/{id}/scheduleRuntime/{scheduleId} — リトライ/ロック用のランタイム状態
  ├── hubwork-magic-tokens/{token}         — マジックリンクトークン (TTL で自動削除)
  └── hubwork-form-submissions/{key}       — べき等キー (TTL で自動削除)


Cloud Scheduler (単一ジョブ)
  └── POST /hubwork/api/workflow/scheduled (毎分)
```

### 設計上の判断

- **全アカウントを単一の Cloud Run で処理** — アカウントごとのインスタンスは作らない。アカウントは `Host` ヘッダーから Firestore ルックアップ（メモリ内 60 秒キャッシュ）で解決される。
- **2 層 URL** — すべてのアカウントは `{accountSlug}.gemihub.online` が即座に利用可能。カスタムドメインはオプションで追加可能。DNS 未設定のアカウントでもビルトインサブドメインで動作する。
- **Cloud Run を Drive プロキシとして利用** — ページは Google Drive から `_sync-meta.json` ルックアップで読み取られ、`Cache-Control` ヘッダー付きで配信される。Cloud CDN がレスポンスをキャッシュ。Cloud Storage や Backend Bucket は不要。
- **Firestore でマルチインスタンス状態を管理** — マジックリンクトークンは Cloud Run インスタンス間で共有が必要。レートリミットはインメモリ（インスタンス単位、DoS 緩和には十分）。
- **AJAX ベースのデータアクセス** — ページは静的 HTML。認証済みデータは `/__gemihub/auth/me` および `/__gemihub/api/*` ワークフローエンドポイント経由でランタイムに取得。サーバーサイドでの注入は行わない。
- **settings.json をスケジュールの信頼できるソースとする** — Firestore `scheduleIndex` は保存時に再構築される希望スケジュール構成を格納し、`scheduleRuntime` は可変の実行状態を格納する。スケジューラーは Firestore でマッチングとランタイム状態を参照し、Drive はワークフロー YAML の実行時読み込みにのみアクセスする。

## プラン

| 機能 | 無料 | Lite (¥300/月) | Pro (¥2,000/月) |
|------|:----:|:--------------:|:---------------:|
| アップロード制限 | 20MB | 5GB | 5GB |
| Gmail Send ノード | - | あり | あり |
| http ノードの CORS プロキシ（クロスオリジンfetch） | 2 req/分 | 60 req/分 | 60 req/分 |
| PDF 生成 | - | あり | あり |
| マイグレーショントークン / 一時編集 URL | - | あり | あり |
| Google Sheets CRUD ノード | - | - | あり |
| 静的ページホスティング (CDN) | - | - | あり |
| ビルトインサブドメイン | - | - | あり |
| カスタムドメイン (自動 SSL) | - | - | あり |
| マルチタイプ認証 | - | - | あり |
| ワークフロー API (`/__gemihub/api/*`) | - | - | あり |
| クライアントヘルパー (`/__gemihub/api.js`) | - | - | あり |
| Interactions API チャット | - | あり | あり |
| AI Web Builder スキル | - | - | あり |
| サーバーサイド実行 | - | - | あり |
| スケジュールワークフロー | - | - | あり |
| 管理パネル | - | - | あり |

## アカウント管理

### Firestore スキーマ

```
hubwork-accounts/{accountId}
  email: string
  encryptedRefreshToken: string      — AES-256-GCM、SESSION_SECRET から派生したキーで暗号化
  accountSlug: string                — ユニーク、例: "acme" → acme.gemihub.online
  defaultDomain: string              — "acme.gemihub.online" (スラッグから自動生成)
  customDomain?: string              — 例: "app.acme.com"
  rootFolderName: string
  rootFolderId: string
  plan: "lite" | "pro" | "granted"   — lite = ¥300/月、pro = ¥2,000/月、granted = 管理者が作成した無料アカウント
  stripeCustomerId?: string          — Stripe 顧客 ID (webhook で設定)
  stripeSubscriptionId?: string      — Stripe サブスクリプション ID (webhook で設定)
  billingStatus: "active" | "past_due" | "canceled"   — granted アカウントは常に "active"
  accountStatus: "enabled" | "disabled"
  domainStatus: "none" | "pending_dns" | "provisioning_cert" | "active" | "failed"
  createdAt: Timestamp

hubwork-accounts/{accountId}/scheduleIndex/{scheduleId}
  workflowPath: string               — ワークフローファイル名 (例: "daily-report.yaml")
  cron: string                       — 5 フィールドの cron 式
  timezone: string                   — 例: "Asia/Tokyo" (デフォルト: "UTC")
  enabled: boolean
  variables?: Record<string, string>
  retry: number                      — 失敗時の最大リトライ回数 (デフォルト: 0)
  timeoutSec: number                 — 実行タイムアウト秒数 (デフォルト: 300)
  concurrencyPolicy: "allow" | "forbid"
  missedRunPolicy: "skip" | "run-once"
  updatedAt: Timestamp
  sourceVersion: string              — 陳腐化チェック用の settings.json スケジュールエントリのハッシュ

hubwork-accounts/{accountId}/scheduleRuntime/{scheduleId}
  retryCount: number                 — 現在のリトライカウンター (0 = 保留中のリトライなし、成功時にリセット)
  lockedUntil?: Timestamp            — `forbid` 用の実行ロック期限
  lastRunAt?: Timestamp
  lastSuccessAt?: Timestamp
  lastError?: string
  updatedAt: Timestamp

hubwork-magic-tokens/{token}         — TTL ポリシーにより期限切れのドキュメントを自動削除
  accountId: string
  email: string
  type: string                         — アカウントタイプ (例: "talent", "company")
  expiresAt: Timestamp
  used: boolean
```

### ステータス設計

ステータスは 3 つの独立した関心事に分割されています:

| フィールド | 値 | 制御対象 | 設定元 |
|-----------|------|---------|--------|
| `billingStatus` | `active`, `past_due`, `canceled` | 機能アクセス (`plan` と組み合わせ)。`granted` アカウントは常に `"active"` で初期化され、Stripe では変更されない。 | Stripe webhook (有料) / 常に `"active"` (granted) |
| `accountStatus` | `enabled`, `disabled` | アカウントのマスタースイッチ | 管理パネル |
| `domainStatus` | `none`, `pending_dns`, `provisioning_cert`, `active`, `failed` | カスタムドメイン URL の利用可否 | ドメインプロビジョニングフロー |

**アクセスルール:**
- **プレミアム機能が利用可能:** `accountStatus == "enabled"` (単一チェック)。Stripe webhook はキャンセル時に自動的に `accountStatus` を `"disabled"` に設定し、再有効化時に再度有効にするため、`billingStatus` は情報表示のみ（管理パネルに表示）。
- **スケジュール実行:** 上記と同じ。`domainStatus` は無関係。
- **ビルトインサブドメイン (`defaultDomain`):** 機能が利用可能であれば常に利用可能。
- **カスタムドメイン:** `domainStatus == "active"` の場合のみ。ただし機能アクセスは独立。

これにより「課金はアクティブだが DNS 未設定」のアカウントでも、スケジュールワークフロー、フォームアクション、ビルトインサブドメインを引き続き利用できます。

### アカウントプラン

| プラン | 作成方法 | 説明 |
|--------|---------|------|
| `lite` | Stripe Checkout → webhook | ¥300/月。Gmail ノード、PDF、アップロード制限なし。 |
| `pro` | Stripe Checkout → webhook | ¥2,000/月。Lite の全機能 + Sheets ノード、Web ビルダー、サブドメイン、認証、スケジュールワークフロー。 |
| `granted` | 管理パネル | 管理者が作成する無料アカウント。Pro と同等のアクセス権限。 |

`plan` フィールドは必須です。プランが設定されていないアカウントは有料機能を利用できません。`granted` アカウントは Pro と同等のフルアクセスが可能です。

### アカウント解決 (2 層 URL)

すべてのプレミアムルートは、リクエストの `Host` ヘッダーからアカウントを解決します:

1. `Host` ヘッダーからドメインを抽出（ポートを除去）
2. `customDomain` マッチを試行: Firestore で `customDomain == domain` をクエリ
3. マッチしない場合、`defaultDomain` マッチを試行: `defaultDomain == domain` をクエリ
4. 結果をメモリにキャッシュ（60 秒 TTL）
5. アカウントが見つからない場合、プラン未設定の場合、またはアクセスルールに失敗した場合は 404 を返却

初期の公開 URL は常に `https://{accountSlug}.gemihub.online` です。カスタムドメイン設定後は、両方の URL で同一のコンテンツが配信されます。

この処理は `app/services/hubwork-account-resolver.server.ts` の `resolveHubworkAccount(request)` で行われます。

### トークン管理

管理者の Google OAuth リフレッシュトークンは暗号化 (AES-256-GCM) されて Firestore に保存されます。リクエスト到着時:

1. Host ヘッダーからアカウントを解決
2. インメモリのアクセストークンキャッシュを確認（5 分のリフレッシュバッファ）
3. 期限切れの場合: Firestore からリフレッシュトークンを復号し、OAuth2 リフレッシュを実行
4. 新しいアクセストークンをメモリにキャッシュ

これにより、管理者がログインしていなくてもコンタクトがページにアクセスできます。

## ページシステム

### ファイルベースルーティング

ページはファイルベースルーティングで配信されます（Remix/Next.js と同様）。Drive の `web/` に配置されたファイルは Cloud Run（CDN キャッシュ付き）から直接配信されます。中間ストレージは不要です。

```
web/index.html           → /
web/about.html           → /about
web/styles.css           → /styles.css
web/images/logo.png      → /images/logo.png
web/users/index.html     → /users/
web/users/[id].html      → /users/123, /users/abc, ...
web/blog/[slug].html     → /blog/hello-world
```

**動的ルート** はファイル名に `[param]` 構文を使用します。静的ファイルにマッチしないリクエストの場合、プロキシは同じディレクトリ内の `[xxx].html` ファイルを探します。

**対応ファイルタイプ**: HTML、CSS、JS、画像、フォントなど、あらゆる静的アセット。MIME タイプはファイル拡張子から自動検出されます。

### 仕組み

1. ユーザーが GemiHub IDE、Obsidian、またはその他の Drive 接続クライアントで `web/` 内のファイルを作成・編集（ドラッグ＆ドロップ対応）
2. Push（任意のクライアントから）でファイルが Drive に更新される。ページプロキシは CDN キャッシュミス時に Drive から直接読み取る。
3. パブリッシュステップや中間ストレージは不要 — Drive に上がった時点でファイルは公開される。
4. CDN がレスポンスをキャッシュ (`s-maxage=600`) するため、Drive API はキャッシュミス時のみ呼ばれる。

### ページ配信フロー

```
Browser → LB → Cloud CDN (キャッシュヒット → 即座に返却)
                  ↓ (キャッシュミス)
            Cloud Run → Drive API (_sync-meta.json ルックアップ経由) → Cache-Control ヘッダー付きレスポンス → CDN がキャッシュ
```

`/users/abc123` のようなリクエストの **解決順序**:
1. 完全一致ファイルを試行: `{accountId}/users/abc123.html`
2. インデックスを試行: `{accountId}/users/abc123/index.html`
3. 完全パス（非 HTML）を試行: `{accountId}/users/abc123`
4. `[param]` パターンを試行: `{accountId}/users/[id].html` (親ディレクトリ内の任意の `[xxx].html`)
5. 404

キャッチオールルートは以下のヘッダー付きでレスポンスを返します:
- `Cache-Control: public, max-age=300, s-maxage=600`
- セキュリティヘッダー (X-Content-Type-Options, X-Frame-Options)

### アカウントタイプ設定

アカウントタイプは複数のログイン ID（例: "talent", "company", "staff"）を定義します。各タイプには `identity`（認証ソース）とオプションの `data`（ユーザーデータソース）があります。`settings.json` で設定:

```json
{
  "hubwork": {
    "spreadsheets": [{ "id": "...", "label": "My Sheet" }],
    "accounts": {
      "talent": {
        "identity": {
          "sheet": "Talents",
          "emailColumn": "email"
        },
        "data": {
          "profile": {
            "sheet": "Talents",
            "matchBy": "email",
            "fields": ["email", "name", "skills"],
            "shape": "object"
          }
        }
      },
      "company": {
        "identity": {
          "sheet": "Companies",
          "emailColumn": "contact_email"
        },
        "data": {
          "profile": {
            "sheet": "Companies",
            "matchBy": "contact_email",
            "fields": ["name", "industry"],
            "shape": "object"
          },
          "jobs": {
            "sheet": "Jobs",
            "matchBy": "company_email",
            "fields": ["title", "status"],
            "shape": "array"
          }
        }
      }
    }
  }
}
```

- `identity.sheet` — マジックリンク認証に使用するシート
- `identity.emailColumn` — メールアドレスを含むカラムヘッダー
- `data` — オプションの名前付きデータソースマップ。各ソースはメール一致でシートをクエリし、フィールドフィルタされた結果を返す。

### クライアントヘルパー (`/__gemihub/api.js`)

HTML ページに含めることでプレミアム API にアクセス:

```html
<script src="/__gemihub/api.js"></script>
```

提供される機能:
- `gemihub.get(path, params)` — `/__gemihub/api/{path}` に GET リクエスト（クエリパラメータ付き）、JSON を返却
- `gemihub.post(path, body)` — `/__gemihub/api/{path}` に POST リクエスト（JSON ボディ）、JSON を返却
- `gemihub.auth.me(type)` — 現在のユーザーデータを取得（未認証時は `null` を返却）
- `gemihub.auth.login(type, email)` — マジックリンクを送信
- `gemihub.auth.logout(type)` — セッションを破棄
- `gemihub.auth.require(type, loginPath?)` — ガード: 未認証時はログインページにリダイレクト

**保護されたページパターン** — ローディング状態で開始し、認証後にレンダリング:

```html
<div id="app">Loading...</div>
<script src="/__gemihub/api.js"></script>
<script>
  (async () => {
    const user = await gemihub.auth.require("talent");
    document.getElementById("app").innerHTML = `Welcome, ${user.email}`;
  })();
</script>
```

### ワークフロー API (`/__gemihub/api/*`)

Drive の `web/api/` に配置されたワークフロー YAML ファイルが API エンドポイントとして公開されます:

```
web/api/users/list.yaml     → GET/POST /__gemihub/api/users/list
web/api/users/[id].yaml     → GET/POST /__gemihub/api/users/abc123
web/api/contact.yaml        → POST /__gemihub/api/contact
```

**ワークフローに注入される入力変数:**

| 変数 | ソース |
|------|--------|
| `query.*` | URL クエリパラメータ |
| `params.*` | `[param]` パターンのキャプチャ |
| `body.*` | POST JSON ボディまたはフォームフィールド |
| `body.{key}_name`, `body.{key}_type`, `body.{key}_size` | ファイルメタデータ (multipart のみ) |
| `auth.type`, `auth.email` | 認証済みユーザー (`requireAuth` 設定時のみ) |
| `currentUser` | ユーザーデータの JSON 文字列 (認証済みかつ `data` 設定がある場合のみ) |
| `request.method` | `"GET"` または `"POST"` |

**Content-Type によるレスポンス動作:**

| リクエスト Content-Type | レスポンス |
|---|---|
| `application/json` または GET | `__response` 変数を JSON として返却 (`__response` 未設定時は `__` 以外の全変数) |
| `application/x-www-form-urlencoded` | `__redirectUrl` / `body.__redirect` / Referer にリダイレクト |
| `multipart/form-data` | 上記と同じ (リダイレクト) |

**`__response` 規約:** この変数にワークフロー内で JSON 文字列をセットします。API はそれをパースして結果を返却します。二重に JSON 文字列化しないでください — 変数は既に JSON 文字列を保持しています。

**`__statusCode`:** オプション。JSON レスポンスの HTTP ステータスコードを設定します。フォームリダイレクトでは無視されます。

**`requireAuth`:** `trigger.requireAuth` に単一のアカウントタイプ名を設定します（例: `"talent"`）。カンマ区切りの値は無効で、400 を返します。

**ワークフロー例 (`web/api/users/list.yaml`):**

```yaml
trigger:
  requireAuth: talent

nodes:
  - id: users
    type: sheet-read
    config:
      sheet: Talents
      filter: '{"status": "active"}'
      saveTo: users

  - id: respond
    type: set
    name: __response
    value: "{{users}}"
```

**セキュリティに関する注意事項:**

- GET API は読み取り専用であること（副作用なし）。データ変更は POST を使用。
- POST リクエストは Origin ヘッダーの検証が必要（CSRF 対策）。
- レート制限: IP あたり 60 リクエスト/分。
- ファイルアップロード制限: ファイルあたり 5MB、合計 10MB。超過時は 413 を返却。
- タイムアウト: デフォルト 30 秒、`trigger.apiTimeoutSec` で設定可能（最大 60 秒）。

> **認証は認可ではありません。** `requireAuth` はユーザーがログイン済みであることのみを検証します。`requireAuth` 付きのワークフローでは `currentUser` でシートデータをフィルタする**必要があります** — フィルタなしの場合、`sheet-read` はログインユーザーに関係なく全行を返却します。

**HTML フォーム連携**（JavaScript 不要）:

```html
<form action="/__gemihub/api/contact" method="POST">
  <input name="name">
  <input name="email" type="email">
  <input type="hidden" name="__redirect" value="/thanks">
  <button type="submit">Send</button>
</form>
```

## 認証

### アカウントタイプセッション

各アカウントタイプは独立したセッション Cookie (`__hubwork_{type}`) を持ちます。ユーザーは複数のタイプに同時にログイン可能です（例: `talent` と `company` の両方）。API エンドポイントは `trigger.requireAuth` のみからアクティブなプリンシパルを判定します — `requireAuth: "talent"` の場合、`__hubwork_talent` Cookie のみがチェックされます。

### マジックリンクフロー

1. ユーザーがログインページでメールアドレスを送信 → `POST /__gemihub/auth/login`（`{ type, email }` ボディ）
2. サーバーが Google Sheets の `accounts[type].identity` シートに対してメールアドレスを検証
3. Firestore にトークンを作成（`hubwork-magic-tokens` コレクション、10 分 TTL、`type` を含む）
4. Gmail API 経由でログインリンクをメール送信
5. ユーザーがリンクをクリック → `GET /__gemihub/auth/verify/:token`
6. サーバーが Firestore でトークンを検証（トランザクション、ワンタイム使用）
7. セッション Cookie (`__hubwork_{type}`) を設定、7 日間有効
8. ターゲットページにリダイレクト

HEAD リクエストは検証エンドポイントに対して 200 を返しますが、トークンは消費しません（メールクライアントのリンクスキャナーによるトークン無効化を防止）。

### 認証エンドポイント

| エンドポイント | メソッド | 説明 |
|--------------|----------|------|
| `/__gemihub/auth/login` | POST | マジックリンクを送信。ボディ: `{ type, email }`。常に `{ ok: true }` を返却（メール/タイプの列挙を防止）。 |
| `/__gemihub/auth/verify/:token` | GET | トークンを検証、Cookie を設定、リダイレクト。 |
| `/__gemihub/auth/logout` | POST | セッションを破棄。ボディ: `{ type }`。 |
| `/__gemihub/auth/me?type=talent` | GET | 現在のユーザーデータを取得。`{ type, email, ...data }` または 401 を返却。 |

### レート制限

インメモリのスライディングウィンドウ（Cloud Run インスタンスごと）:
- メールアドレスあたりマジックリンク: 3 リクエスト / 10 分
- IP あたりマジックリンク: 10 リクエスト / 10 分
- IP あたりワークフロー API: 60 リクエスト / 60 秒

## カスタムドメイン

### 2 層 URL 設計

すべてのプレミアムアカウントには 2 つの URL 層があります:

| 層 | URL | 利用可能条件 |
|----|-----|-------------|
| ビルトイン | `https://{accountSlug}.gemihub.online` | アカウント作成時に即座に利用可能 |
| カスタム | `https://app.acme.com` | DNS 検証 + SSL プロビジョニング完了後 |

管理パネルでは両方が表示されます:
- **プレビュー URL**: `https://{accountSlug}.gemihub.online` (常に動作)
- **本番 URL**: カスタムドメイン (`domainStatus == "active"` の場合のみ表示)

### プロビジョニングフロー

1. 管理者が設定 > プレミアムプラン > カスタムドメインにドメインを入力
2. アプリが Certificate Manager の DNS 認可 + 証明書 + マップエントリを作成
3. アプリが LB URL マップにホストルールを追加（全ドメインで同一の Cloud Run バックエンド）
4. DNS 設定手順が管理者に表示される（CNAME レコード）
5. 管理者がレジストラで DNS レコードを作成
6. Google が自動的に DNS を検証 → SSL 証明書をプロビジョニング（数分〜数時間）
7. `domainStatus` が遷移: `none` → `pending_dns` → `provisioning_cert` → `active`

### URL マップ構造

すべてのドメイン（ビルトイン + カスタム）は同一の Cloud Run バックエンドを指します:

```
*.gemihub.online     → Cloud Run (ワイルドカードサブドメイン)
app.acme.com         → Cloud Run (動的に追加されたホストルール)
app.other.com        → Cloud Run (動的に追加されたホストルール)
```

Cloud Run は `Host` ヘッダーからアカウントを識別します — パスベースのルーティングは不要です。

## スケジュールワークフロー

### 信頼できるソース

Google Drive 上の `settings.json` がスケジュール設定の信頼できる唯一のソースです。Firestore `scheduleIndex` は settings から導出された希望スケジュール構成を格納し、Firestore `scheduleRuntime` はリトライやロックなどの可変実行状態を格納します。

**更新フロー:**
1. 設定 UI が Drive 上の `settings.json` を更新
2. 保存時、Firestore がアカウントドキュメントに新しい `scheduleRevision` を書き込み、そのリビジョンの `scheduleIndex` エントリを upsert
3. すべての新しいエントリの書き込み後、アカウントの `activeScheduleRevision` が新しいリビジョンにアトミックに切り替え
4. 以前のリビジョンの古い `scheduleIndex` エントリは非同期で削除
5. Cloud Scheduler はスケジュールマッチング/ランタイム状態の参照に Firestore のみを読み取り、Drive はワークフロー YAML の実行時読み込みにのみアクセス
6. ワークフロー YAML は実行時に Drive から読み込まれる

**一貫性ルール:**
- `scheduleIndex` の再構築はベストエフォート操作。失敗しても settings は Drive（信頼できるソース）に保存され、UI に警告が表示される。
- 各 `scheduleIndex` エントリには `sourceVersion`（保存時の settings.json エントリの MD5 ハッシュ）がある。再構築プロセスが `sourceVersion` を Firestore に書き込み、スケジューラーはアクティブな Firestore リビジョンを信頼し、検証のために Drive の settings を再読み込みしない。
- スケジューラーはアカウントの `activeScheduleRevision` からのスケジュールのみを読み取るため、部分的な再構築が空または書きかけのスケジュールセットを露出させることはない。
- 管理者は管理パネルから手動でインデックス再構築をトリガーして、失敗から回復できる。

### 設定 (settings.json)

```json
{
  "hubwork": {
    "schedules": [
      {
        "workflowPath": "daily-report.yaml",
        "cron": "0 9 * * *",
        "timezone": "Asia/Tokyo",
        "enabled": true,
        "variables": { "recipient": "admin@example.com" },
        "retry": 3,
        "timeoutSec": 300,
        "concurrencyPolicy": "forbid",
        "missedRunPolicy": "skip"
      }
    ]
  }
}
```

### スケジュールパラメータ

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `workflowPath` | (必須) | ワークフローファイル名 (例: `daily-report.yaml`) |
| `cron` | (必須) | 5 フィールドの cron 式 |
| `timezone` | `"UTC"` | IANA タイムゾーン (例: `"Asia/Tokyo"`) |
| `enabled` | `true` | 有効/無効の切り替え |
| `variables` | `{}` | ワークフロー実行に渡される変数 |
| `retry` | `0` | 一時的な失敗時の最大リトライ回数。リトライはリクエスト内ではなく後続のスケジューラーティックに延期され、Firestore `scheduleRuntime` で追跡される。 |
| `timeoutSec` | `300` | 実行タイムアウト秒数 (最大 600) |
| `concurrencyPolicy` | `"allow"` | `allow` = とにかく実行、`forbid` = 前回がまだ実行中ならスキップ |
| `missedRunPolicy` | `"skip"` | `skip` = スケジューラーダウンタイム後の未実行分を無視、`run-once` = 回復時に 1 回実行 |

### 実行フロー

1. Cloud Scheduler が毎分 `POST /hubwork/api/workflow/scheduled` を呼び出し（OIDC 認証）
2. エンドポイントが Firestore から機能が利用可能な全アカウントを読み取り
3. 各アカウントについて: アカウントの `activeScheduleRevision` から `scheduleIndex` エントリと対応する `scheduleRuntime` 状態を読み取り
4. スケジューラーが cron 式を現在時刻と照合（タイムゾーンを考慮）し、`scheduleRuntime.retryCount` からの保留中リトライも確認
5. マッチしたスケジュール: `concurrencyPolicy` に従ってランタイムロックを取得または更新
6. スケジューラーが Drive からワークフロー YAML を読み込み、ServiceContext を構築して実行
7. 失敗時: `scheduleRuntime.retryCount` をインクリメント。次のティックで `retryCount > 0` かつ `retryCount <= retry` であれば、cron マッチに関係なくスケジュールを再実行。リトライは後続のティックに延期され — リクエスト内のリトライループは行わない — Cloud Run リクエストタイムアウトとの競合を回避。
8. 成功時または `retryCount > retry` の場合: `retryCount` を 0 にリセットし、ランタイムロックをクリア
9. 各アカウントは順次処理され、1 つのアカウントの失敗が他をブロックしない

### Cron 式フォーマット

5 フィールド形式: `minute hour dayOfMonth month dayOfWeek`

| 構文 | 意味 |
|------|------|
| `*` | 任意の値 |
| `*/n` | n ごと |
| `n` | 固定値 |
| `n-m` | 範囲 |
| `n,m` | リスト |

## AI Web Builder スキル

Proプランが有効な場合、ビルトインの Agent スキル（「Webpage Builder」）が Drive の `skills/webpage-builder/` に自動プロビジョニングされます。このスキルにより、AI チャットを通じて Web ページや API エンドポイントを構築できます。

### 自動プロビジョニング

スキルは Proプラン有効化後、最初に設定ページを訪れた際に作成されます。以下が含まれます:

```
skills/webpage-builder/
  SKILL.md                           ← AI 指示 + ワークフロー宣言
  references/
    api-reference.md                 ← クライアントヘルパー、ルーティング、ワークフロー API ドキュメント
    page-patterns.md                 ← ログインページ、保護されたページ、API ワークフローテンプレート
  workflows/
    save-page.yaml                   ← HTML を web/ に保存 (drive-save)
    save-api.yaml                    ← ワークフロー YAML を web/api/ に保存 (drive-save)
```

`SKILL.md` が既に存在する場合、プロビジョニングはスキップされます（べき等）。ユーザーは作成後にスキルファイルをカスタマイズできます。

### 使い方

1. チャットを開き、スキルドロップダウンから「Webpage Builder」スキルを有効化
2. 作りたいものを記述:
   - 「Partnerのログインページとチケット一覧ページを作って。Ticketsシートからpartner_emailでフィルタして」
   - 「問い合わせフォームを作って。送信したらContactsシートに書き込み」
   - 「商品一覧APIを作って。Productsシートから全件取得」
3. AI が HTML ページとワークフロー YAML ファイルを生成し、`save-page` / `save-api` ワークフローで Drive に保存
4. Push して公開

### AI が把握している情報

スキルの参照資料には以下が含まれます:
- `gemihub.get()` / `gemihub.post()` / `gemihub.auth.*` クライアントヘルパー API
- ファイルルーティングルール (`web/*.html` → ページ、`web/api/*.yaml` → API)
- ログインページ、保護されたページ、API ワークフローテンプレート
- 認証と認可のルール (`auth.email` でフィルタが必須)
- 利用可能なワークフローノード (`sheet-read`, `sheet-write`, `gmail-send` 等)

### スキルテンプレート (ソース)

テンプレートファイルは `app/services/hubwork-skill-templates/` にサーバービルドに埋め込まれています。これらのファイルへの変更は新規プロビジョニングされるスキルに反映されますが、既存のスキルは更新されません。

## ワークフロー API 経由のフォーム送信

HTML フォームは `/__gemihub/api/*` エンドポイントに直接 POST します。サーバーは `Content-Type`（form-data または urlencoded）を検出し、JSON を返す代わりに実行後にリダイレクトします。

### トリガー設定

フォーム固有のオプションはワークフロー YAML の trigger ブロックで設定します:

```yaml
trigger:
  requireAuth: talent
  idempotencyKeyField: "submissionId"
  honeypotField: "_hp_field"
  successRedirect: "/thanks"
  errorRedirect: "/error"
```

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `requireAuth` | (なし) | 単一のアカウントタイプ名。カンマ区切りの値は無効（400 を返却）。 |
| `idempotencyKeyField` | (なし) | べき等キー用のフォームフィールド名（Firestore ベース、5 分 TTL） |
| `honeypotField` | (なし) | ボット検出用の隠しフィールド名。入力されている場合、サイレントに受け入れるが実行しない |
| `successRedirect` | Referer または `/` | 成功時のリダイレクト URL |
| `errorRedirect` | Referer または `/` | エラー時のリダイレクト URL |

リダイレクト優先順位: `__redirectUrl` 変数 > `body.__redirect` フィールド > `trigger.successRedirect` > Referer > `/`

## サーバーサイド Script 実行

`script` ワークフローノードは [`isolated-vm`](https://github.com/laverdet/isolated-vm) を使用してサーバーサイドで JavaScript を実行します:

- 各実行で新しい V8 アイソレートを作成（状態の漏洩なし）
- メモリ制限: アイソレートあたり 128 MB
- 設定可能なタイムアウト（デフォルト 10 秒）
- ネットワーク、ファイルシステム、モジュールアクセスなし
- `input` 変数が提供されている場合に利用可能

クライアントサイド実行（iframe サンドボックス）は変更なし。

## ワークフローノード（有料プラン限定）

### sheet-read

Google Sheets のタブから行を読み取ります。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `filter` | いいえ | JSON フィルタ `{"status": "active"}` または `column == value` |
| `limit` | いいえ | 返却する最大行数 |
| `saveTo` | はい | 変数名 (オブジェクトの JSON 配列を受け取る) |

### sheet-write

シートに行を追加します。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `data` | はい | シートヘッダーに一致する JSON オブジェクトまたは配列 |

### sheet-update

フィルタに一致する行を更新します。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `filter` | はい | JSON フィルタ |
| `data` | はい | 更新するカラムを含む JSON オブジェクト |
| `saveTo` | いいえ | 更新された行数を格納する変数 |

### sheet-delete

フィルタに一致する行を削除します。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `filter` | はい | JSON フィルタ |
| `saveTo` | いいえ | 削除された行数を格納する変数 |

### gmail-send

Gmail API 経由でメールを送信します。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `to` | はい | 宛先メールアドレス |
| `subject` | はい | 件名 |
| `body` | いいえ | HTML 本文 |
| `saveTo` | いいえ | メッセージ ID を格納する変数 |

## サブスクリプションと課金

### Stripe 連携

Stripe Checkout 経由の月額サブスクリプション。フロー:

1. ユーザーが **設定 > プレミアムプラン** タブで「登録」をクリック
2. `POST /hubwork/api/stripe/checkout` が `metadata: { rootFolderId }` 付きの Stripe Checkout Session を作成
3. ユーザーが Stripe のホストページで支払いを完了
4. Stripe webhook (`checkout.session.completed`) → Firestore アカウントを `plan: "lite"` または `"pro"`、`billingStatus: "active"` で作成/更新
5. ユーザーが設定に戻る — プレミアム機能が自動的に有効化（別途トグル不要）

サブスクリプションライフサイクル:
- `customer.subscription.deleted` → `billingStatus` を `"canceled"` に設定
- `customer.subscription.updated` → Stripe のステータスに基づき `billingStatus` を設定（`active`/`trialing` → `"active"`、`past_due` → `"past_due"`、その他 → `"canceled"`）

ユーザーは Stripe Billing Portal (`POST /hubwork/api/stripe/portal`) 経由でサブスクリプションを管理（キャンセル、支払い方法の更新）できます。

### 管理パネル

アカウント管理用の管理ダッシュボードは `/hubwork/admin` にあります。

**認証:**
- Google OAuth メールアドレス — `HUBWORK_ADMIN_EMAILS` 環境変数に含まれている必要があります（カンマ区切り、デフォルト: `takesy.morito@gmail.com`）

**機能:**
- 全アカウント一覧（メール、ドメイン、プラン、ステータス、作成日）
- アカウント詳細の表示/編集（プラン、accountStatus、billingStatus、メール）
- メールアドレスで granted（無料）アカウントを作成
- アカウント削除
- カスタムドメインのテスト（DNS + SSL チェック）
- テストマジックリンクの送信
- コンタクトメールアドレスの currentUser ペイロードをプレビュー
- ワークフローの即時実行（手動トリガー）
- 次回実行のプレビュー（次の 5 回の実行時刻を表示）
- ページ公開履歴/ロールバック

## API ルート

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| POST | `/__gemihub/auth/login` | なし | マジックリンクを送信。ボディ: `{ type, email }` |
| GET | `/__gemihub/auth/verify/:token` | なし | マジックリンクトークンを検証、Cookie を設定、リダイレクト |
| POST | `/__gemihub/auth/logout` | なし | セッションを破棄。ボディ: `{ type }` |
| GET | `/__gemihub/auth/me?type=` | コンタクトセッション | アカウントタイプの currentUser データを取得 |
| GET | `/__gemihub/api.js` | なし | クライアントヘルパースクリプト |
| GET/POST | `/__gemihub/api/*` | オプション (`requireAuth`) | ワークフロー API (`web/api/*.yaml` を解決) |
| GET | `/*` (キャッチオール) | なし | ファイルベースのページプロキシ (Drive → CDN、プレミアムドメインのみ) |
| GET/POST | `/hubwork/api/domain` | 管理者セッション | ドメイン管理 |
| POST | `/hubwork/api/workflow/scheduled` | OIDC (Cloud Scheduler) | スケジュール実行 |
| POST | `/hubwork/api/stripe/checkout` | Google OAuth | Stripe Checkout Session を作成 |
| POST | `/hubwork/api/stripe/webhook` | Stripe 署名 | Stripe イベントを処理 |
| POST | `/hubwork/api/stripe/portal` | Google OAuth | Stripe Billing Portal セッションを作成 |
| GET | `/hubwork/admin` | Basic Auth + OAuth メール | 管理ダッシュボード |
| GET/POST | `/hubwork/admin/accounts/:id` | Basic Auth + OAuth メール | アカウント詳細/編集/削除 |
| GET/POST | `/hubwork/admin/accounts/create` | Basic Auth + OAuth メール | granted アカウントを作成 |

## インフラストラクチャ

### GCP サービス

| サービス | 用途 |
|---------|------|
| Cloud Run | 全アカウントを配信するシングルインスタンス |
| Firestore | アカウントデータ、トークン、スケジュールインデックス |
| Certificate Manager | カスタムドメイン用 SSL 証明書 |
| Cloud Scheduler | 毎分スケジュールワークフロー実行をトリガー |
| Cloud CDN | ページプロキシレスポンスをキャッシュ |
| Load Balancer | 全ドメイン（ワイルドカード + カスタム）を Cloud Run にルーティング |

### Terraform リソース

| リソース | ファイル | 用途 |
|---------|--------|------|
| `google_project_service` (Firestore, CertManager, Scheduler APIs) | `apis.tf` | 必要な API を有効化 |
| `google_project_iam_member` (datastore.user, certmanager.editor, compute.loadBalancerAdmin) | `iam.tf` | Cloud Run サービスアカウントの権限 |
| `google_certificate_manager_certificate_map` | `networking.tf` | 動的 SSL 用の証明書マップ |
| `google_certificate_manager_certificate` + `_map_entry` | `networking.tf` | メインドメイン + ワイルドカード証明書 |
| `google_cloud_scheduler_job` | `scheduler.tf` | 毎分のスケジュールトリガー |
| `google_service_account` (hubwork-scheduler) | `scheduler.tf` | スケジューラーサービスアカウント |

### 環境変数

| 変数 | 説明 |
|------|------|
| `GCP_PROJECT_ID` | GCP プロジェクト ID（Certificate Manager および Compute API 呼び出し用） |
| `HUBWORK_CERT_MAP_NAME` | Certificate Manager マップ名（デフォルト: `gemihub-map`） |
| `HUBWORK_URL_MAP_NAME` | LB URL マップ名（デフォルト: `gemini-hub-https`） |
| `STRIPE_SECRET_KEY` | Stripe API シークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 署名シークレット |
| `STRIPE_PRICE_ID_LITE` | Lite プラン (¥300/月) の Stripe Price ID |
| `STRIPE_PRICE_ID_PRO` | Proプラン (¥2,000/月) の Stripe Price ID |
| `HUBWORK_ADMIN_CREDENTIALS` | Basic Auth 資格情報（`user:password` 形式、Secret Manager） |
| `HUBWORK_ADMIN_EMAILS` | 管理者メールアドレス（カンマ区切り、Secret Manager） |

### Drive データ構造

```
{rootDir}/
  settings.json        ← プレミアム設定 (spreadsheets, accounts, schedules)
  web/                   ← 静的サイトファイル (Cloud Run が Drive API 経由で直接配信)
    index.html
    about.html
    styles.css
    users/[id].html    ← 動的ページルート
    login/talent.html  ← ログインページ (ユーザー作成)
    api/                 ← ワークフロー API エンドポイント (/__gemihub/api/* として配信)
      users/list.yaml  ← GET/POST /__gemihub/api/users/list
      users/[id].yaml  ← GET/POST /__gemihub/api/users/:id
      contact.yaml     ← POST /__gemihub/api/contact
  hubwork/
    history/
      {execId}.json    ← ワークフロー実行履歴
  workflows/
    *.yaml             ← ワークフロー定義 (trigger 設定を含む場合あり)
```

## 主要ファイル

| ファイル | 用途 |
|---------|------|
| `app/services/firestore.server.ts` | Firestore クライアントシングルトン |
| `app/services/hubwork-accounts.server.ts` | アカウント CRUD、トークン暗号化/リフレッシュ、スケジュールインデックス同期 |
| `app/services/hubwork-account-resolver.server.ts` | Host ヘッダーからアカウントを解決 (defaultDomain + customDomain、60 秒キャッシュ) |
| `app/services/hubwork-admin-auth.server.ts` | 管理パネル認証 (OAuth メールチェック、Basic Auth は HTTP レベルで処理) |
| `app/services/stripe.server.ts` | Stripe クライアントシングルトン |
| `app/services/hubwork-magic-link.server.ts` | Firestore 内のマジックリンクトークン (トランザクション検証、アカウントタイプを含む) |
| `app/services/hubwork-rate-limiter.server.ts` | インメモリのスライディングウィンドウレートリミッター |
| `app/services/hubwork-session.server.ts` | タイプ別セッション Cookie 管理 (`__hubwork_{type}`) |
| `app/services/hubwork-page-renderer.server.ts` | buildCurrentUser (アカウントタイプ設定からフィールドフィルタされた Sheets データ) |
| `app/services/hubwork-api-resolver.server.ts` | sync meta から `web/api/*.yaml` ワークフローファイルを解決 |
| `app/services/hubwork-skill-provisioner.server.ts` | 「Webpage Builder」スキルを Drive に自動プロビジョニング |
| `app/services/hubwork-skill-templates/` | 埋め込みスキルコンテンツ (SKILL.md, references, workflows) |
| `app/services/hubwork-domain.server.ts` | Certificate Manager + URL マップ管理 |
| `app/services/isolated-vm-executor.server.ts` | サーバーサイド JS 実行 (V8 アイソレート) |
| `app/types/settings.ts` | HubworkAccountType, HubworkDataSource, HubworkSettings の型定義 |
| `app/types/hubwork.ts` | Firestore ドキュメントの型定義 |
| `app/engine/handlers/hubworkSheets.ts` | Sheet の read/write/update/delete ハンドラー |
| `app/engine/handlers/hubworkGmail.ts` | Gmail send ハンドラー |
| `app/routes/hubwork.internal.auth.login.tsx` | `POST /__gemihub/auth/login` — アカウントタイプ付きマジックリンク |
| `app/routes/hubwork.internal.auth.verify.$token.tsx` | `GET /__gemihub/auth/verify/:token` — 検証 + Cookie 設定 |
| `app/routes/hubwork.internal.auth.logout.tsx` | `POST /__gemihub/auth/logout` — セッション破棄 |
| `app/routes/hubwork.internal.auth.me.tsx` | `GET /__gemihub/auth/me` — タイプ別の currentUser データ |
| `app/routes/hubwork.internal.api.$.tsx` | `GET/POST /__gemihub/api/*` — ワークフロー API 実行 |
| `app/routes/hubwork.internal.api-js.tsx` | `GET /__gemihub/api.js` — クライアントヘルパースクリプト |
| `app/routes/hubwork.site.$.tsx` | キャッチオールページプロキシ (Drive → CDN) |
| `app/components/settings/HubworkTab.tsx` | 設定 UI (サブスクリプション、ドメイン、スケジュール) |
| `app/routes/hubwork.admin.tsx` | 管理ダッシュボード (アカウント一覧 + 運用ツール) |
| `app/routes/hubwork.api.stripe.webhook.tsx` | Stripe webhook ハンドラー |
