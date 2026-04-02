# Hubwork — 有料プラン

HubworkはGemiHubの有料プランで、Google Sheets/Gmail連携、静的ページホスティング、スケジュール実行、カスタムドメインに対応したWebアプリビルダーへと拡張する。

## アーキテクチャ概要

```
Load Balancer + Cloud CDN + Certificate Manager
  ├── *.gemihub.online     → Cloud Run（ワイルドカードサブドメイン）
  ├── app.acme.com         → Cloud Run（カスタムドメイン）
  └── app.other.com        → Cloud Run（カスタムドメイン）

Cloud Run（単一、マルチテナント）
  ├── GemiHub IDE（既存の無料機能）
  ├── Hubwork API（Hostヘッダーからアカウント解決）
  ├── ページプロキシ（Driveから読み取り、Cache-Control付きでレスポンス → CDNキャッシュ）
  ├── スケジュールワークフロー実行エンドポイント
  └── isolated-vm（サーバーサイドscriptノード実行）

Firestore
  ├── hubwork-accounts/{id}                — アカウント情報、暗号化リフレッシュトークン
  ├── hubwork-accounts/{id}/scheduleIndex  — 設定キャッシュ（settings.jsonから同期）
  ├── hubwork-accounts/{id}/scheduleRuntime/{scheduleId} — リトライ/ロック等の実行状態
  ├── hubwork-magic-tokens/{token}         — マジックリンクトークン（TTLで自動削除）
  └── hubwork-form-submissions/{key}       — 冪等性キー（TTLで自動削除）


Cloud Scheduler（単一ジョブ）
  └── POST /hubwork/api/workflow/scheduled（毎分）
```

### 設計方針

- **全アカウントで単一Cloud Run** — アカウント別インスタンスなし。`Host`ヘッダーからFirestoreルックアップでアカウント解決（メモリ内60秒キャッシュ）。
- **二層URL** — 全アカウントが即座に`{accountSlug}.gemihub.online`を取得。カスタムドメインは任意の追加設定。DNS未設定でもビルトインサブドメインで動作確認可能。
- **Cloud RunがDriveプロキシ** — ページをGoogle Driveから`_sync-meta.json`ルックアップで読み取り、`Cache-Control`ヘッダー付きで返す。Cloud CDNがレスポンスをキャッシュ。Cloud StorageやBackend Bucketsは不要。
- **Firestoreでマルチインスタンス状態管理** — マジックリンクトークンはCloud Runインスタンス間で共有が必要。レート制限はインメモリ（インスタンス単位、DoS対策として許容範囲）。
- **静的ページ生成** — 認証付きページはランタイムで`GET /hubwork/api/me`を取得するAJAXスクリプトを含む（サーバーサイド`currentUser`注入ではない）。
- **settings.jsonがスケジュールの正本** — Firestoreの`scheduleIndex`は保存時に再構築される設定キャッシュ、`scheduleRuntime`はリトライ/ロック等の可変実行状態。SchedulerはFirestoreでスケジュール判定・実行状態管理を行い、DriveはワークフローYAML読み込み時のみ参照。

## 機能

| 機能 | 説明 |
|------|------|
| Stripeサブスクリプション | Stripe Checkoutで月額¥2,000、webhook駆動のアカウントプロビジョニング |
| 管理パネル | `/hubwork/admin`でアカウント管理（Basic認証 + Google OAuthメール制限） |
| Google Sheets CRUD | `sheet-read`、`sheet-write`、`sheet-update`、`sheet-delete`ワークフローノード |
| Gmail送信 | `gmail-send`ワークフローノード |
| 静的ページホスティング | Driveの`web/`にファイルを配置、CDN経由でファイルベースルーティング配信 |
| カスタムドメイン | アカウント別ドメイン、SSL自動プロビジョニング（Certificate Manager） |
| ビルトインサブドメイン | アカウント作成時に即座に`{accountSlug}.gemihub.online`が利用可能 |
| コンタクト認証 | メールによるマジックリンクログイン、APIアクセス用セッションCookie |
| currentUser API | Sheetsからフィールドフィルタされたユーザーデータを`/hubwork/api/me`で公開 |
| フォーム→ワークフロー | HTMLフォーム送信でワークフロー実行をトリガー（冪等性・ハニーポット対応） |
| サーバーサイドScript | `script`ノードが`isolated-vm`（V8アイソレート）でサーバーサイド実行 |
| スケジュール実行 | cronベース、マルチテナント実行（リトライ・タイムアウト・並行制御付き） |

## アカウント管理

### Firestoreスキーマ

```
hubwork-accounts/{accountId}
  email: string
  encryptedRefreshToken: string      — AES-256-GCM、SESSION_SECRETから鍵導出
  accountSlug: string                — 一意、例: "acme" → acme.gemihub.online
  defaultDomain: string              — "acme.gemihub.online"（slugから自動生成）
  customDomain?: string              — 例: "app.acme.com"
  rootFolderName: string
  rootFolderId: string
  spreadsheetId?: string
  plan: "lite" | "pro" | "granted"   — lite = ¥300/月、pro = ¥2,000/月、granted = 管理者作成の無料
  stripeCustomerId?: string          — Stripe顧客ID（webhookで設定）
  stripeSubscriptionId?: string      — StripeサブスクリプションID（webhookで設定）
  billingStatus: "active" | "past_due" | "canceled"   — grantedアカウントは常に"active"
  accountStatus: "enabled" | "disabled"
  domainStatus: "none" | "pending_dns" | "provisioning_cert" | "active" | "failed"
  createdAt: Timestamp

hubwork-accounts/{accountId}/scheduleIndex/{scheduleId}
  workflowPath: string               — ワークフローファイル名（例: "daily-report.yaml"）
  cron: string                       — 5フィールドcron式
  timezone: string                   — 例: "Asia/Tokyo"（デフォルト: "UTC"）
  enabled: boolean
  variables?: Record<string, string>
  retry: number                      — 失敗時の最大リトライ回数（デフォルト: 0）
  timeoutSec: number                 — 実行タイムアウト秒数（デフォルト: 300）
  concurrencyPolicy: "allow" | "forbid"
  missedRunPolicy: "skip" | "run-once"
  updatedAt: Timestamp
  sourceVersion: string              — settings.jsonスケジュールエントリのハッシュ（鮮度チェック用）

hubwork-accounts/{accountId}/scheduleRuntime/{scheduleId}
  retryCount: number                 — 現在のリトライカウンタ（0 = リトライなし、成功時リセット）
  lockedUntil?: Timestamp            — 実行ロック期限（forbid用）
  lastRunAt?: Timestamp
  lastSuccessAt?: Timestamp
  lastError?: string
  updatedAt: Timestamp

hubwork-magic-tokens/{token}         — TTLポリシーで期限切れドキュメントを自動削除
  accountId: string
  email: string
  expiresAt: Timestamp
  used: boolean
```

### ステータス設計

ステータスは3つの独立した関心事に分離:

| フィールド | 値 | 制御対象 | 設定元 |
|-----------|-----|---------|--------|
| `billingStatus` | `active`、`past_due`、`canceled` | 機能アクセス（`plan`と共に）。`granted`アカウントは常に`"active"`で初期化され、Stripeからは変更されない。 | Stripe webhook（paid）/ 常に`"active"`（granted） |
| `accountStatus` | `enabled`、`disabled` | アカウントのマスタースイッチ | 管理パネル |
| `domainStatus` | `none`、`pending_dns`、`provisioning_cert`、`active`、`failed` | カスタムドメインURL利用可否 | ドメインプロビジョニングフロー |

**アクセスルール:**
- **Hubwork機能利用可否:** `accountStatus == "enabled"`（単一チェック）。Stripe webhookが課金停止時に`accountStatus`を`"disabled"`に、再開時に`"enabled"`に自動設定するため、`billingStatus`は情報表示用（管理パネル）。
- **スケジュール実行可否:** 上記と同じ。`domainStatus`は無関係
- **ビルトインサブドメイン（`defaultDomain`）:** 機能が利用可能なら常時アクセス可
- **カスタムドメイン:** `domainStatus == "active"`のときのみ。ただし機能アクセスは独立

これにより「課金は有効だがDNS待ち」の状態でもスケジュール実行・フォームアクション・ビルトインサブドメインが使える。

### アカウントプラン

| プラン | 作成方法 | 説明 |
|--------|----------|------|
| `lite` | Stripe Checkout → webhook | 月額¥300。Gmail ノード、PDF、アップロード制限解除。 |
| `pro` | Stripe Checkout → webhook | 月額¥2,000。Lite 全機能 + Sheets ノード、Web ビルダー、サブドメイン、認証、定期実行。 |
| `granted` | 管理パネル | 管理者が手動作成する無料アカウント。Pro 相当のアクセス権。 |

`plan` フィールドは必須 — プランのないアカウントは有料機能を使えない。`granted` は Pro 相当。

### アカウント解決（二層URL）

全Hubworkルートはリクエストの`Host`ヘッダーからアカウントを解決:

1. `Host`ヘッダーからドメイン抽出（ポート除去）
2. `customDomain`マッチを試行: Firestoreで`customDomain == domain`をクエリ
3. マッチしない場合、`defaultDomain`マッチを試行: `defaultDomain == domain`をクエリ
4. メモリ内キャッシュ（60秒TTL）
5. アカウントが一致しない、プラン未設定、またはアクセスルール不適合の場合は404

初期公開URLは常に`https://{accountSlug}.gemihub.online`。カスタムドメイン設定後は両URLが同じコンテンツを配信。

`app/services/hubwork-account-resolver.server.ts`の`resolveHubworkAccount(request)`で処理。

### トークン管理

管理者のGoogle OAuthリフレッシュトークンは暗号化（AES-256-GCM）してFirestoreに保存。リクエスト到着時:

1. Hostヘッダーからアカウント解決
2. インメモリのアクセストークンキャッシュを確認（5分リフレッシュバッファ）
3. 期限切れの場合: Firestoreからリフレッシュトークンを復号し、OAuth2リフレッシュ呼び出し
4. 新しいアクセストークンをメモリにキャッシュ

これにより管理者がログインしていなくてもコンタクトがページにアクセスできる。

## ページシステム

### ファイルベースルーティング

Remix/Next.jsに似たファイルベースルーティングでページを配信。Driveの`web/`にファイルを置くとCloud Run（CDNキャッシュ付き）で直接配信される — 中間ストレージ不要。

```
web/index.html           → /
web/about.html           → /about
web/styles.css           → /styles.css
web/images/logo.png      → /images/logo.png
web/users/index.html     → /users/
web/users/[id].html      → /users/123, /users/abc, ...
web/blog/[slug].html     → /blog/hello-world
```

**動的ルート**はファイル名に`[param]`構文を使用。静的ファイルにマッチしないリクエストは、同ディレクトリの`[xxx].html`ファイルにフォールバック。

**対応ファイルタイプ**: HTML、CSS、JS、画像、フォント — 任意の静的アセット。MIMEタイプはファイル拡張子から自動検出。

### 仕組み

1. GemiHub IDE、Obsidian、またはDrive連携クライアントで`web/`にファイルを作成/編集（ドラッグ&ドロップ対応）
2. Push時（任意のクライアントから）にDrive上のファイルが更新される。ページプロキシはCDNキャッシュミス時にDriveから直接読み取り。
3. 公開ステップなし、中間ストレージなし — Driveに置けば即公開。
4. CDNがレスポンスをキャッシュ（`s-maxage=600`）するため、Drive APIはキャッシュミス時のみ呼ばれる。

### ページ配信フロー

```
ブラウザ → LB → Cloud CDN（キャッシュヒット → 即座に返却）
                  ↓（キャッシュミス）
            Cloud Run → Drive API（_sync-meta.jsonルックアップ）→ Cache-Controlヘッダー付きレスポンス → CDNキャッシュ
```

**解決順序**（`/users/abc123`へのリクエストの場合）:
1. 完全一致ファイル: `{accountId}/users/abc123.html`
2. インデックス: `{accountId}/users/abc123/index.html`
3. 完全パス（非HTML）: `{accountId}/users/abc123`
4. `[param]`パターン: `{accountId}/users/[id].html`（親ディレクトリ内の任意の`[xxx].html`）
5. 404

catch-allルートは以下のヘッダーでレスポンスを返す:
- `Cache-Control: public, max-age=300, s-maxage=600`
- セキュリティヘッダー（X-Content-Type-Options、X-Frame-Options）

### currentUserデータ（AJAX）

認証付きページは`GET /hubwork/api/me`を取得するスクリプトを含む。レスポンスは`settings.json`の設定に基づいてフィールドフィルタされ、情報漏えいを防止する。

**settings.jsonでの設定:**

```json
{
  "hubwork": {
    "currentUser": {
      "profile": {
        "sheet": "Users",
        "matchBy": "email",
        "fields": ["email", "name", "company", "plan"],
        "shape": "object"
      },
      "orders": {
        "sheet": "Orders",
        "matchBy": "email",
        "fields": ["id", "product", "status", "createdAt"],
        "shape": "array",
        "limit": 20,
        "sort": "-createdAt"
      }
    }
  }
}
```

**レスポンス形式:**

```json
{
  "email": "user@example.com",
  "profile": {
    "email": "user@example.com",
    "name": "John",
    "company": "Acme Inc",
    "plan": "pro"
  },
  "orders": [
    { "id": "ord_1", "product": "Widget", "status": "paid", "createdAt": "2026-03-01" }
  ]
}
```

`currentUser`設定の各キーがレスポンスのキーにマッピングされる。指定された`fields`のみがレスポンスに含まれる。`profile`のような単一オブジェクトは`shape: "object"`を指定する。未指定時は配列で返る。`currentUser`設定が未設定の場合、エンドポイントは`{ "email": "..." }`のみを返す。

**AJAX注入スクリプト:**

```javascript
// 静的ページ生成で注入
(async function() {
  const res = await fetch('/hubwork/api/me', { credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
    return;
  }
  const data = await res.json();
  window.currentUser = data;
  window.dispatchEvent(new CustomEvent('hubwork:user-loaded', { detail: data }));
})();
```

ページは`hubwork:user-loaded`イベントをリッスンしてユーザー固有のコンテンツを描画できる。

## 認証

### マジックリンクフロー

1. ユーザーがログインページでメールを送信 → `POST /hubwork/auth/magic-link`
2. サーバーがGoogle Sheetsのユーザーシートでメールを検証
3. Firestoreにトークン作成（`hubwork-magic-tokens`コレクション、10分TTL）
4. Gmail APIでログインリンクをメール送信
5. ユーザーがリンクをクリック → `GET /hubwork/auth/verify/:token`
6. サーバーがFirestoreでトークンを検証（トランザクション、ワンタイム）
7. セッションCookie（`__hubwork_contact`）設定、7日間有効
8. ターゲットページへリダイレクト

### レート制限

インメモリのスライディングウィンドウ（Cloud Runインスタンス単位）:
- メール別マジックリンク: 3リクエスト / 10分
- IP別マジックリンク: 10リクエスト / 10分
- IP別フォームアクション: 30リクエスト / 60秒

## カスタムドメイン

### 二層URL設計

全Hubworkアカウントは2つのURLティアを持つ:

| ティア | URL | 利用可能タイミング |
|--------|-----|-------------------|
| ビルトイン | `https://{accountSlug}.gemihub.online` | アカウント作成時に即座に |
| カスタム | `https://app.acme.com` | DNS検証 + SSLプロビジョニング後 |

管理パネルでは両方を表示:
- **プレビューURL**: `https://{accountSlug}.gemihub.online`（常時動作）
- **本番URL**: カスタムドメイン（`domainStatus == "active"`のときのみ表示）

### プロビジョニングフロー

1. 管理者が設定 > Hubwork > カスタムドメインにドメインを入力
2. アプリがCertificate ManagerのDNS認証 + 証明書 + マップエントリを作成
3. アプリがLBのURLマップにホストルールを追加（全ドメインで同一Cloud Runバックエンド）
4. DNS設定手順を管理者に表示（CNAMEレコード）
5. 管理者がレジストラでDNSレコードを作成
6. Googleが自動でDNS検証 → SSL証明書をプロビジョニング（数分〜数時間）
7. `domainStatus`遷移: `none` → `pending_dns` → `provisioning_cert` → `active`

### URLマップ構造

全ドメイン（ビルトイン + カスタム）が同一Cloud Runバックエンドを指す:

```
*.gemihub.online     → Cloud Run（ワイルドカードサブドメイン）
app.acme.com         → Cloud Run（動的にホストルール追加）
app.other.com        → Cloud Run（動的にホストルール追加）
```

Cloud Runが`Host`ヘッダーからアカウントを特定 — パスベースのルーティングは不要。

## スケジュール実行

### 正本

Google Driveの`settings.json`がスケジュール設定の唯一の正本。Firestoreの`scheduleIndex`は設定から派生した設定キャッシュ、`scheduleRuntime`はリトライやロック等の可変実行状態。

**更新フロー:**
1. 設定UIがDriveの`settings.json`を更新
2. 保存時にFirestoreで新しい`scheduleRevision`を生成し、新リビジョンプレフィクス付きの`scheduleIndex`エントリを書き込み
3. 全エントリ書き込み完了後、アカウントの`activeScheduleRevision`を新リビジョンにアトミック切り替え
4. 旧リビジョンの`scheduleIndex`エントリを非同期削除
5. Cloud SchedulerはFirestoreのみでスケジュール判定・実行状態管理を行い、DriveはワークフローYAML読み込み時のみ参照
6. ワークフローYAMLは実行時にDriveから読み込み

**整合性ルール:**
- `scheduleIndex`の再構築はベストエフォート。失敗してもsettingsはDrive（正本）に保存され、UIに警告を表示する。
- 各`scheduleIndex`エントリには`sourceVersion`（保存時のsettings.jsonエントリのMD5ハッシュ）がある。再構築プロセスが`sourceVersion`をFirestoreに書き込み、SchedulerはアクティブなFirestoreリビジョンを信頼して検証のためにDriveを再読み込みしない。
- Schedulerはアカウントの`activeScheduleRevision`のスケジュールのみを読むため、部分的な再構築で空集合や中途半端なスケジュールセットが露出することはない。
- 管理パネルから手動でインデックス再構築をトリガーして障害からの復旧が可能。

### 設定（settings.json）

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
|-----------|----------|------|
| `workflowPath` | （必須） | ワークフローファイル名（例: `daily-report.yaml`） |
| `cron` | （必須） | 5フィールドcron式 |
| `timezone` | `"UTC"` | IANAタイムゾーン（例: `"Asia/Tokyo"`） |
| `enabled` | `true` | 有効/無効トグル |
| `variables` | `{}` | ワークフロー実行に渡す変数 |
| `retry` | `0` | 一時失敗時の最大リトライ回数。リトライは後続のSchedulerティックに持ち越し（リクエスト内リトライではない）、Firestoreの`scheduleRuntime`で追跡。 |
| `timeoutSec` | `300` | 実行タイムアウト秒数（最大600） |
| `concurrencyPolicy` | `"allow"` | `allow` = そのまま実行、`forbid` = 前回実行中ならスキップ |
| `missedRunPolicy` | `"skip"` | `skip` = Scheduler停止後の取りこぼし無視、`run-once` = 復旧時に1回実行 |

### 実行フロー

1. Cloud Schedulerが毎分`POST /hubwork/api/workflow/scheduled`を呼び出し（OIDC認証）
2. エンドポイントが機能利用可能な全アカウントをFirestoreから読み取り
3. アカウントごと: `activeScheduleRevision`の`scheduleIndex`エントリと対応する`scheduleRuntime`状態を読み取り
4. Schedulerがcron式を現在時刻と照合（タイムゾーン考慮）、`scheduleRuntime.retryCount`からの保留リトライも合わせて判定
5. 一致するスケジュール: `concurrencyPolicy`に従いランタイムロックを取得/更新
6. DriveからワークフローYAMLを読み込み、ServiceContextを構築、実行
7. 失敗時: `scheduleRuntime.retryCount`をインクリメント。次のティックで`retryCount > 0`かつ`retryCount <= retry`なら、cron一致に関係なく再実行。リトライはリクエスト内ではなく後続ティックに持ち越し — Cloud Runのリクエストタイムアウトとの衝突を回避。
8. 成功時または`retryCount > retry`: `retryCount`を0にリセット、ランタイムロックをクリア
9. 各アカウントは順次処理; 1アカウントの失敗が他をブロックしない

### Cron式フォーマット

5フィールド形式: `分 時 日 月 曜日`

| 構文 | 意味 |
|------|------|
| `*` | 任意の値 |
| `*/n` | n間隔 |
| `n` | 固定値 |
| `n-m` | 範囲 |
| `n,m` | リスト |

## フォーム→ワークフロー実行

### 概要

`POST /hubwork/actions/:workflowId`でHTMLフォームからワークフロー実行をトリガーできる。

### 設定

フォームの挙動はワークフローYAMLのトリガーブロックで設定:

```yaml
trigger:
  type: form
  requireAuth: true
  idempotencyKeyField: "submissionId"
  honeypotField: "_hp_field"
  successRedirect: "/thanks"
  errorRedirect: "/error"
```

### パラメータ

| パラメータ | デフォルト | 説明 |
|-----------|----------|------|
| `requireAuth` | `false` | コンタクトセッション（マジックリンクログイン）を必須にする |
| `idempotencyKeyField` | （なし） | 冪等性キーのフォームフィールド名。5分以内の重複送信を拒否。キーはFirestore（`hubwork-form-submissions/{accountId}_{key}`）にTTL自動削除付きで保存し、複数Cloud Runインスタンス間で動作。 |
| `honeypotField` | （なし） | ボット検出用の隠しフィールド名。入力があればサイレントに受理するが実行しない |
| `successRedirect` | RefererまたはRefererまたは`/` | 成功時のリダイレクトURL |
| `errorRedirect` | Refererまたは`/` | エラー時のリダイレクトURL |

### セキュリティ

- Originヘッダーによる CSRF検証
- レート制限: IP当たり30リクエスト / 60秒
- ワークフローIDバリデーション: 英数字 + アンダースコア/ハイフンのみ
- 冪等性: Firestoreベースの重複排除（`hubwork-form-submissions`コレクション、TTL 5分）。トランザクショナルなcheck-and-setで複数Cloud Runインスタンス間の正確性を保証。
- ハニーポット: ボット送信のサイレント拒否

## サーバーサイドScript実行

`script`ワークフローノードは[`isolated-vm`](https://github.com/laverdet/isolated-vm)を使用してJavaScriptをサーバーサイドで実行:

- 実行ごとに新しいV8アイソレートを作成（状態リークなし）
- メモリ制限: アイソレートあたり128MB
- タイムアウト設定可能（デフォルト10秒）
- ネットワーク、ファイルシステム、モジュールアクセスなし
- `input`変数が提供されている場合利用可能

クライアントサイド実行（iframeサンドボックス）は変更なし。

## ワークフローノード（有料限定）

### sheet-read

Google Sheetsタブから行を読み取り。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `filter` | いいえ | JSONフィルタ `{"status": "active"}` または `column == value` |
| `limit` | いいえ | 返す最大行数 |
| `saveTo` | はい | 変数名（JSONオブジェクト配列を受け取る） |

### sheet-write

シートに行を追加。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `data` | はい | シートヘッダーに一致するJSONオブジェクトまたは配列 |

### sheet-update

フィルタに一致する行を更新。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `filter` | はい | JSONフィルタ |
| `data` | はい | 更新するカラムのJSONオブジェクト |
| `saveTo` | いいえ | 更新行数の変数 |

### sheet-delete

フィルタに一致する行を削除。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `sheet` | はい | タブ名 |
| `filter` | はい | JSONフィルタ |
| `saveTo` | いいえ | 削除行数の変数 |

### gmail-send

Gmail APIでメール送信。

| プロパティ | 必須 | 説明 |
|-----------|------|------|
| `to` | はい | 受信者メール |
| `subject` | はい | 件名 |
| `body` | いいえ | HTML本文 |
| `saveTo` | いいえ | メッセージIDの変数 |

## サブスクリプション・課金

### Stripe連携

Stripe Checkoutによる月額¥2,000のサブスクリプション。フロー:

1. ユーザーが**設定 > Hubwork**タブで「Subscribe」をクリック
2. `POST /hubwork/api/stripe/checkout`が`metadata: { rootFolderId }`付きのStripe Checkout Sessionを作成
3. ユーザーがStripeのホスト型ページで決済完了
4. Stripe webhook（`checkout.session.completed`）→ Firestoreアカウントを`plan: "lite"`または`"pro"`、`billingStatus: "active"`で作成/更新
5. ユーザーが設定に戻る — Hubwork機能が自動的に有効化（個別のトグル不要）

サブスクリプションライフサイクル:
- `customer.subscription.deleted` → `billingStatus`を`"canceled"`に設定
- `customer.subscription.updated` → Stripeのステータスに基づき`billingStatus`を設定（`active`/`trialing` → `"active"`、`past_due` → `"past_due"`、それ以外 → `"canceled"`）

ユーザーはStripe Billing Portal（`POST /hubwork/api/stripe/portal`）でサブスクリプション管理（キャンセル、支払い方法更新）。

### 管理パネル

`/hubwork/admin`のアカウント管理ダッシュボード。

**認証（両方必要）:**
1. HTTP Basic認証 — `HUBWORK_ADMIN_CREDENTIALS`環境変数の認証情報（`user:password`形式、Secret Managerに保存）
2. Google OAuthメール — `HUBWORK_ADMIN_EMAILS`環境変数に含まれる必要あり（カンマ区切り、デフォルト: `takesy.morito@gmail.com`）

**機能:**
- 全アカウント一覧（メール、ドメイン、プラン、各ステータス、作成日）
- アカウント詳細の表示/編集（プラン、accountStatus、billingStatus、メール）
- メールで付与（無料）アカウントを作成
- アカウント削除
- カスタムドメインテスト（DNS + SSL確認）
- テストマジックリンク送信
- currentUserペイロードプレビュー（コンタクトメール指定）
- ワークフロー即時実行（手動トリガー）
- スケジュール次回実行プレビュー（次の5回の実行時刻表示）
- ページ公開履歴 / ロールバック

## APIルート

| メソッド | パス | 認証 | 説明 |
|----------|------|------|------|
| POST | `/hubwork/auth/magic-link` | なし | マジックリンクログインリクエスト |
| GET | `/hubwork/auth/verify/:token` | なし | マジックリンクトークン検証 |
| GET | `/*`（catch-all） | なし | ファイルベースページプロキシ（Drive → CDN、Hubworkドメインのみ） |
| POST | `/hubwork/actions/:workflowId` | 任意 | フォーム送信 → ワークフロー |
| GET | `/hubwork/api/me` | コンタクトセッション | フィールドフィルタされたcurrentUserデータ取得 |
| GET/POST | `/hubwork/api/domain` | 管理者セッション | ドメイン管理 |
| POST | `/hubwork/api/workflow/scheduled` | OIDC（Cloud Scheduler） | スケジュール実行 |
| POST | `/hubwork/api/stripe/checkout` | Google OAuth | Stripe Checkout Session作成 |
| POST | `/hubwork/api/stripe/webhook` | Stripe署名 | Stripeイベント処理 |
| POST | `/hubwork/api/stripe/portal` | Google OAuth | Stripe Billing Portalセッション作成 |
| GET | `/hubwork/admin` | Basic + OAuthメール | 管理ダッシュボード |
| GET/POST | `/hubwork/admin/accounts/:id` | Basic + OAuthメール | アカウント詳細/編集/削除 |
| GET/POST | `/hubwork/admin/accounts/create` | Basic + OAuthメール | 付与アカウント作成 |

## インフラストラクチャ

### GCPサービス

| サービス | 用途 |
|----------|------|
| Cloud Run | 全アカウントにサービスする単一インスタンス |
| Firestore | アカウントデータ、トークン、スケジュールインデックス |
| Certificate Manager | カスタムドメイン用SSL証明書 |
| Cloud Scheduler | 毎分スケジュールワークフロー実行をトリガー |
| Cloud CDN | ページプロキシレスポンスをキャッシュ |
| Load Balancer | 全ドメイン（ワイルドカード + カスタム）をCloud Runにルーティング |

### Terraformリソース

| リソース | ファイル | 用途 |
|----------|----------|------|
| `google_project_service`（Firestore、CertManager、Scheduler API） | `apis.tf` | 必要なAPIの有効化 |
| `google_project_iam_member`（datastore.user、certmanager.editor、compute.loadBalancerAdmin） | `iam.tf` | Cloud Run SAの権限 |
| `google_certificate_manager_certificate_map` | `networking.tf` | 動的SSL用証明書マップ |
| `google_certificate_manager_certificate` + `_map_entry` | `networking.tf` | メインドメイン + ワイルドカード証明書 |
| `google_cloud_scheduler_job` | `scheduler.tf` | 毎分スケジュールトリガー |
| `google_service_account`（hubwork-scheduler） | `scheduler.tf` | スケジューラサービスアカウント |

### 環境変数

| 変数 | 説明 |
|------|------|
| `GCP_PROJECT_ID` | GCPプロジェクトID（Certificate ManagerとCompute API呼び出し用） |
| `HUBWORK_CERT_MAP_NAME` | Certificate Managerマップ名（デフォルト: `gemihub-map`） |
| `HUBWORK_URL_MAP_NAME` | LBのURLマップ名（デフォルト: `gemini-hub-https`） |
| `STRIPE_SECRET_KEY` | Stripe APIシークレットキー |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhookの署名シークレット |
| `STRIPE_PRICE_ID_LITE` | Lite プラン（月額¥300）の Stripe Price ID |
| `STRIPE_PRICE_ID_PRO` | Pro プラン（月額¥2,000）の Stripe Price ID |
| `HUBWORK_ADMIN_CREDENTIALS` | 管理パネルのBasic認証（`user:password`、Secret Managerに保存） |
| `HUBWORK_ADMIN_EMAILS` | カンマ区切りの管理者メール（デフォルト: `takesy.morito@gmail.com`） |

### Driveデータ構造

```
{rootDir}/
  settings.json        ← hubwork設定（spreadsheetId、sheets、schedules、currentUser）
  web/                   ← 静的サイトファイル（Cloud RunがDrive APIで直接配信、Hubworkアカウントに自動作成）
    index.html
    about.html
    styles.css
    users/[id].html    ← 動的ルート
  hubwork/
    history/
      {execId}.json    ← ワークフロー実行履歴
  workflows/
    *.yaml             ← ワークフロー定義（トリガー設定を含む場合あり）
```

## 主要ファイル

| ファイル | 用途 |
|----------|------|
| `app/services/firestore.server.ts` | Firestoreクライアントシングルトン |
| `app/services/hubwork-accounts.server.ts` | アカウントCRUD、トークン暗号化/リフレッシュ、スケジュールインデックス同期 |
| `app/services/hubwork-account-resolver.server.ts` | Hostヘッダーからアカウント解決（defaultDomain + customDomain、60秒キャッシュ） |
| `app/services/hubwork-admin-auth.server.ts` | 管理パネル認証（Basic + OAuthメール確認） |
| `app/services/stripe.server.ts` | Stripeクライアントシングルトン |
| `app/services/hubwork-magic-link.server.ts` | Firestoreのマジックリンクトークン（トランザクション検証） |
| `app/services/hubwork-rate-limiter.server.ts` | インメモリのスライディングウィンドウレート制限 |
| `app/services/hubwork-session.server.ts` | コンタクトセッションCookie管理 |
| `app/services/hubwork-page-renderer.server.ts` | buildCurrentUser（/hubwork/api/me用のフィールドフィルタ済みSheetsデータ） |
| `app/services/hubwork-domain.server.ts` | Certificate Manager + URLマップ管理 |
| `app/services/isolated-vm-executor.server.ts` | サーバーサイドJS実行（V8アイソレート） |
| `app/types/hubwork.ts` | Firestoreドキュメントの型定義 |
| `app/engine/handlers/hubworkSheets.ts` | シート読み取り/書き込み/更新/削除ハンドラー |
| `app/engine/handlers/hubworkGmail.ts` | Gmail送信ハンドラー |
| `app/components/settings/HubworkTab.tsx` | 設定UI（サブスクリプション、ドメイン、スケジュール） |
| `app/routes/hubwork.admin.tsx` | 管理ダッシュボード（アカウント一覧 + 運用ツール） |
| `app/routes/hubwork.api.stripe.webhook.tsx` | Stripe webhookハンドラー |
