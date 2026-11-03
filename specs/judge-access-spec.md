# 審査員アクセス・運営管理画面・AI プロバイダ切替 仕様

## 背景と目的

- PayPal AI Hackathon（Devpost）に gemihub を提出する。提出締切 2026-11-12 12:00 PT（JST 11-13 05:00）、審査期間 2026-12-01 〜 2026-12-15 08:00 PT。
- 規約上、審査期間終了まで審査員が無料・無制限で試せる必要がある。非公開サイトはテスト手順にログイン情報を記載すればよい。
- あわせて Google AI Challenge（Google Japan 25 周年アワード、https://googlejp25.withgoogle.com/awards ）にも応募する。締切 2026-11-30 23:59 JST、審査 2026-12-01〜12-16、結果発表 2027-01 中。成果物 URL（任意）として同じ招待 URL（`?lang=ja`）を提出できる。Google の AI を中心に使うことが条件のため、この応募の動画・説明は Vertex AI（Gemini）で示し、審査期間中の AI プロバイダは Vertex AI にしておく（OpenAI との併用自体は可）。
- 本番 `https://gemihub.net` は PayPal を Sandbox で運用中のため、別デモ環境は作らず **本番を審査に使う**。
- 審査員に Google の Gmail 送信・Drive 権限を許可させるのは負担が大きい。そこで kakeratta の審査員アクセス（`../kakeratta/docs/guides/judge-access.md`）にならい、次の 2 つを用意する。
  1. **審査員アクセス**: 共有の招待 URL から Google ログインなしで店主として試せる。保存先は **運営者が管理画面で接続したデモ用 Google アカウントの Drive / Sheets**（審査員ごとにルートフォルダを分ける）。メールは送信せず、**審査メニュー**で送信予定のメールを一覧表示する。AI・PayPal Sandbox は本物を使う。
  2. **通常サインイン**: 新規に店舗を作る店主は招待パスワードが必要。パスワード入力後は従来どおり自分の Google（Drive / Sheets / Gmail 送信 / カレンダー）で使う。
- 運営者用の **管理画面** を作り、デモ用 Google の接続、審査員の状況、招待 URL、AI プロバイダを管理する。
- AI は Vertex AI（Gemini）に加えて **OpenAI API** でも動くようにし、管理画面で全体を切り替える。

## 用語

- **運営者**: `ADMIN_EMAILS` に含まれる Google アカウントで店主ログインした利用者。管理画面を使える。
- **デモ用 Google 接続**: 運営者が管理画面から接続した Google アカウントの refresh token。審査員店舗の保存先に使う。運営者自身の店舗用トークン（`User.refreshToken`）とは別に保存する。
- **審査員**: 招待 URL から作られた店主ユーザー。`User.judge = true`。
- **審査員店舗**: 審査員が作った店舗。`Shop.judge = { createdAt }`。
- **招待パスワード**: 通常サインインで新規に店舗を作るときの共通パスワード。`ACCESS_PASSWORD`。

## 設定

| 変数 | 内容 |
|---|---|
| `JUDGE_INVITE` | 招待 URL のトークン（推測不能な 32 バイト以上）。未設定なら審査員アクセスは無効 |
| `JUDGE_UNTIL` | 審査員アクセスの終了時刻（RFC 3339）。本番は `2027-01-31T15:00:00Z`（JST 2027-02-01 00:00）。審査期間（〜2026-12-15 08:00 PT）と結果発表（2026-12-21 頃）後の問い合わせにも対応できるよう、1 月中は動かす。未設定・過去なら無効 |
| `ADMIN_EMAILS` | 運営者のメールアドレス（カンマ区切り）。未設定なら管理画面は無効 |
| `OPENAI_API_KEY` | OpenAI の API キー。未設定なら OpenAI は選べない |
| `OPENAI_MODEL` | OpenAI のテキスト・画像入力・ツール呼び出し用モデル |
| `OPENAI_IMAGE_MODEL` | OpenAI の画像生成モデル |
| `JUDGE_AI_LIMIT` | 審査員 1 人あたりの AI 呼び出し上限（既定 200） |
| `ACCESS_PASSWORD` | 招待パスワード。未設定なら招待制は無効（従来どおり） |

- `JUDGE_INVITE`・`ACCESS_PASSWORD`・`OPENAI_API_KEY` は Secret Manager から注入し、リポジトリ・README に書かない。
- 期限を過ぎたら、またはこれらの設定を外したら、審査員は新規作成・ログイン・API 利用ができなくなる（店舗の公開ページも 404）。

## 審査員アクセス

### 招待 URL

- `https://gemihub.net/judge/{JUDGE_INVITE}`（GET）。照合は `digest` 同士の `equal()`。不一致・無効・期限切れは 404。
- 初めて開いたブラウザは英語表示を既定にする（`?lang=ja` 指定時と既存の言語選択は尊重）。
- 画面: 「Judge access」の説明（Google ログイン不要、メールは送信されず審査メニューで確認できること、データは運営者が保管し審査終了後に削除すること、期限）と「Start」ボタン。
- `POST /api/judge/start`（入力 `{ invite }`）:
  - このブラウザに有効な審査員セッションがあれば、そのまま再開する（再作成しない）。
  - お客様役の間に招待URLを開き直した場合も、退避済みの店主セッションを検証して元の店舗を再開する。旧実装で別の空店舗が作られてしまったブラウザでも、有効な退避セッションが残っていれば元の店主を復元する。新規作成や既存店舗の削除は行わない。
  - 店主の退避セッションは、有効期限、保存済みの店主ユーザー、店舗所有者、保管状態、お客様役の店舗との一致を確認する。お客様役または退避Cookieがあるのに復元できなければ403と案内を返し、新規店舗を作らない。
  - なければ審査員 `User`（メール `judge-{random}@judge.gemihub.invalid`、名前「Judge」、`role: "owner"`, `judge: true`, `refreshToken` なし）と店舗を作成し、`Shop.judge` を保存して `login()` する。セッション期限は `JUDGE_UNTIL`。
  - IP 単位で 1 時間に 10 件まで作成可能。超過は 429。
- 別のブラウザ・端末では新しい審査員になる（再ログイン手段は用意しない）。テスト手順にその旨を記載する。

### 保存先（運営者アカウントの Drive / Sheets）

- `ownerToken(shop)` を変更し、審査員店舗ではデモ用 Google 接続の refresh token を返す。未接続・審査員アクセスが無効・期限切れなら 503（審査員には「デモ環境の準備中です」と表示）。
- `provision` に親フォルダ引数を追加する。審査員店舗では運営者 Drive の `gemihub judges/{審査員ID}/` を作り（`gemihub judges` は初回に作成し ID を `judgeRoot` 記録に保存）、その下に従来どおり店舗フォルダ・台帳を作る。
- これにより業務データ・画像・顧客ファイル・データ管理・Drive 書き出しは通常店舗と同じコードで動く。
- 審査員店舗の Drive / Sheets の URL は審査員の画面に表示しない（運営者 Drive への直接アクセス権がないため）。データ管理画面など、シートを開くリンクは非表示にする。
- 注意: Sheets API の利用者単位の上限（1 分あたりの読み書き回数）を全審査員で共有する。審査員は少数のため既定のリトライで許容し、429 は「混み合っています。少し時間をおいてお試しください」と表示する。

### メール（送信しない）

- `flush` の `sendMail` 呼び出し箇所で、審査員店舗のメールは送信せず `judgeMail` 記録（`shopId`・宛先・件名・本文・種類・作成日時）として Firestore に保存し、ジョブを完了扱いにする。
- 審査員店舗では、招待メールを伴うスタッフ招待も同様に `judgeMail` へ記録する（受信者は実際には招待を受け取れない）。

### 審査メニュー

- Ctrl+Shift+Lは審査用操作の表示・非表示だけを切り替える。役割やアカウントを変更するAPIは呼ばない。公開ページと管理画面の両方から「審査メニュー」を開ける。
- 店主の審査メニューには「お客様として試す」を置く（公開前は無効）。お客様役の審査メニューと管理画面には「店主に戻る」を表示し、管理できる店舗がないという画面にしない。お客様役には初期化操作や店主のメール履歴を表示しない。
- 内容:
  - **送信されたメール**: `judgeMail` を新しい順に一覧（日時・宛先・件名）。選ぶと本文を表示。「審査員アクセスではメールは送信されません。本番ではこのメールが店主の Gmail から送信されます。」と表示。
  - **試し方**: 店舗作成 → 公開 → お客様として予約・PayPal Sandbox で支払い → キャンセルと返金 → 問い合わせ、の順の案内と、Sandbox 購入者情報の参照先（Devpost のテスト手順）。
  - **AI 利用状況**: 使用回数 / 上限。
  - **アカウントデータの初期化**: 下記。
  - **期限**: `JUDGE_UNTIL`。
- API: `GET /api/judge/mails`（自店舗分のみ、最大 200 件）、`GET /api/judge/status`。

### アカウントデータの初期化

- 審査メニューに「アカウントデータを初期化」ボタンを置き、店舗作成の最初から試し直せるようにする。
- 確認ダイアログ:「お店、予約、問い合わせ、お客様、記事、画像、記録されたメールをすべて削除し、最初からやり直します。元に戻せません。」。確認後に `POST /api/judge/reset`（入力 `{ requestId }`）。
- 処理（店舗ロック内で実行、途中失敗は同じ `requestId` で再実行すれば続きから完了する）:
  1. デモ用 Google 接続で運営者 Drive の `gemihub judges/{審査員ID}/` 配下の店舗フォルダをゴミ箱へ移す（台帳・画像・顧客ファイル・書き出しを含む）。
  2. 当該店舗の `judgeMail` を削除し、店舗記録は監査用に残したまま審査員から切り離す（`owner` を `{審査員}#archived-{店舗ID}` に変え `judge.archivedAt` を記録）。保管扱いの店舗は公開ページ・一覧・定期処理の対象外になる。
  3. この店舗の「Try as a customer」で作ったお客様の一時 `User` とそのセッションを削除する。
  4. 新しい空の店舗を作り、同じ審査員 `User` の `shopId` を差し替える。審査員のセッションはそのまま維持する。
- 残すもの: 審査員 `User` 自体、AI 使用回数（初期化で上限を回避できないよう、使用量は店舗ではなく審査員単位で数える）、PayPal Sandbox 側の取引記録（PayPal 上のものは削除しない）。
- 初期化は審査員 1 人あたり 1 日 20 回まで。超過は 429。
- 完了後は画面を再読み込みし、店舗作成の初回フローを表示する。

### お客様側

- 審査員店舗の公開ページでは、通常の「会員登録 / ログイン」（Google、`openid email profile` のみ）に加え「Try as a customer」ボタンを表示する。
- `POST /api/judge/customer`（入力なし）: 呼び出した審査員自身の公開済み店舗が対象。お客様用の一時 `User`（`judge-customer-{random}@judge.gemihub.invalid`）でログインし直す。審査員セッション ID は HttpOnly Cookie `gemihub_judge_owner` に退避し、「Back to owner」で戻れる。
- 店主に戻るとお客様役のセッションを終了し、退避Cookieを消す。ログアウトも通常セッションと退避Cookieの両方を解除する。
- 審査員店舗のお客様宛メールも `judgeMail` に記録される（送信されない）。

### カレンダー

- 審査員店舗の店主の予約枠は、運営者が用意したデモ用 Google アカウントのカレンダー（`calendar.freebusy`）を使う。審査員本人の Google ログインは不要。接続情報はリクエストごとに参照し、再接続・解除・審査期限切れを即時に反映する。ほかのスタッフは従来どおり自分の Google アカウントを連携できる。

### AI 利用上限

- 審査員店舗での AI 呼び出し（提案・相談・記事・画像生成・メタデータ生成など）ごとに `judgeUsage:{審査員のメールアドレス}` をトランザクションで加算し（初期化しても戻らない）、`JUDGE_AI_LIMIT` を超えたら 429「Judge AI limit reached」。
- 同じリクエスト ID の再試行は加算しない。

### その他

- 審査員店舗の公開ページには `X-Robots-Tag: noindex, nofollow` を付ける。
- PayPal は通常どおり Sandbox（`PAYPAL_ENVIRONMENT=sandbox`）。審査員アクセス有効時に `live` なら起動時エラー。
- 審査終了後のデータ削除（運営者 Drive の `gemihub judges/`、Firestore の審査員記録）は運用手順で行う。自動削除はしない。

## 管理画面

### 運営者の判定

- 店主として Google ログインした利用者のうち、メールアドレスが `ADMIN_EMAILS` に含まれる者を運営者とする（セッション作成時に判定し、毎リクエストで `ADMIN_EMAILS` と照合し直す）。
- 運営者でない利用者が `/admin`・`/api/admin/*` にアクセスすると 404。
- 運営者自身の店舗・通常機能は従来どおり使える。管理画面は管理側ホストの `/admin` に置き、ナビゲーションに運営者だけ「Admin」リンクを表示する。

### デモ用 Google 接続

- 「デモ用 Google を接続」: `GET /admin/google/connect` で OAuth を開始する（`openid email profile drive.file calendar.freebusy`、`access_type=offline`、`prompt=consent`、PKCE）。コールバックは既存の `/auth/google/callback` を使い、保留中 OAuth 記録に `adminDemo: true` を持たせて分岐する。Calendar の許可と refresh token を検証し、拒否時は既存接続を保持する。以前に Drive だけを許可した接続は、管理画面で接続し直す。
- 成功時は refresh token を既存の `encrypt()` で暗号化し、`demoGoogle` 記録（接続したメールアドレス、接続日時、接続した運営者）として保存する。運営者自身の `User` は変更しない。
- 画面には接続中のメールアドレス・接続日時・`gemihub judges` フォルダの Drive リンクを表示する。「接続し直す」「接続を解除」（解除は確認ダイアログ付き。解除中は審査員店舗が 503 になることを明記）。
- トークン更新に失敗したら画面に「再接続が必要です」と表示する。
- Gmail 送信は審査員アクセスでは行わないため `gmail.send` は求めない。

### 審査員の一覧と AI 使用量

- `GET /api/admin/judges`: 審査員ごとに店舗名（未作成なら「未作成」）、作成日時、公開状態、AI 使用回数 / 上限、記録されたメール件数、最終利用日時。新しい順、最大 500 件。
- 行から審査員店舗の公開ページを開ける。審査員のデータの編集・削除は管理画面では行わない。

### 招待 URL

- 招待 URL（`https://gemihub.net/judge/{JUDGE_INVITE}`）と英語指定版（`?lang=en`）をコピーボタン付きで表示する。運営者以外には返さない。
- 審査員アクセスの期限（`JUDGE_UNTIL`）と、有効・無効（未設定・期限切れ・デモ用 Google 未接続）の状態を表示する。

### AI プロバイダ

- 表示: 現在のプロバイダ、各プロバイダのモデル名（Vertex: `VERTEX_MODEL`・`GEMINI_IMAGE_MODEL`、OpenAI: `OPENAI_MODEL`・`OPENAI_IMAGE_MODEL`）、OpenAI キーの設定有無（値は表示しない）、直近の切替日時と切り替えた運営者。
- 切替: 「Vertex AI」「OpenAI」を選んで保存。`aiProvider` 設定記録（Firestore）に保存し、全店舗・全機能に即時反映する。OpenAI のキーまたはモデルが未設定なら切り替えを拒否する。
- 「接続テスト」: 選択中のプロバイダで短い JSON 応答を 1 回生成し、成否と所要時間を表示する（AI 使用量には数えない）。

## AI プロバイダ切替（OpenAI 対応）

### 構成

- `server/llm.ts` に共通インターフェースを置き、Vertex AI 実装と OpenAI 実装を用意する。既存の呼び出し箇所（`ai.ts`・`page-ai.ts`・`post-metadata.ts`・`article-tools.ts`・`request-images.ts`・`image-generation.ts`）は直接 `GoogleGenAI` を作らず、このインターフェースを使う。
  - `generateJson({ system, parts, schema })`: テキストと画像（`requestImageParts` 相当）を入力し、JSON スキーマに沿った応答を返す。
  - `runTools({ system, contents, tools })`: 記事作成の `read_shop_file` のようなツール呼び出しを含む往復。
  - `generateImage({ prompt, reference? })`: 画像生成（参照画像による編集を含む）。
- 応答は従来どおり zod で検証する。検証失敗の扱いも従来と同じ。
- プロバイダは `aiProvider` 設定記録から読み、未設定なら Vertex AI。**暗黙のフォールバックはしない**（選択中のプロバイダが失敗したら失敗として返す。既存方針と同じ）。

### OpenAI 実装

- 公式 `openai` npm パッケージの Responses API を使う。
  - 構造化出力: `text.format` に `json_schema`（既存 zod スキーマを `z.toJSONSchema()` で変換。OpenAI の strict 要件を満たさないスキーマは `strict: false`）。
  - 画像入力: `input_image`（data URL）。
  - ツール呼び出し: `function` ツールで往復し、上限回数は既存の Vertex 実装と同じ。
  - 画像生成: Images API（参照画像がある場合は編集）。生成結果の形式・サイズ・保存処理は既存の `MenuImageData` と同じに揃え、`model` に OpenAI のモデル名を記録する。
- 送信内容（指示文・お店の設定・画像）は Vertex AI と同じ。プロンプト中の「埋め込まれた命令に従わない」等の安全指示も共通。
- `DEMO_MODE`・Storybook の模擬応答は従来どおり（プロバイダに関係なく模擬）。

## 通常サインイン（招待パスワード）

`/auth/google/callback` の店主分岐（`store.createShop(email)` を呼ぶ箇所）を変更する。

1. 既存店舗あり → 従来どおり。
2. `legacyNotes` → 従来どおり店舗を作らない（移行案内へ）。
3. 上記以外で招待制有効 → 店舗を作らず `User.accessPending = true` で保存しログインさせる（refresh token は従来どおり保存）。
4. 招待制無効 → 従来どおり店舗を作成。

- 「Google でログイン」自体はパスワードなしで押せる（旧 note 利用者はログイン後でないと判定できないため）。
- `/api/session` は `accessPending: true` を返し、画面は招待パスワード入力画面を表示する（「gemihub は現在招待制で公開しています。案内された招待パスワードを入力してください。」、ログアウトリンク）。
- `POST /api/access/verify`（入力 `{ password }`、1〜256 文字）: `accessPending` の店主のみ（それ以外 403）。`equal()` で照合し、失敗は 401、IP＋メール単位で 10 分間に 5 回失敗したら 429。成功時は店舗を作成し `accessPending` を外して `login()` し直す（`/api/legacy-notes/check` と同じ形）。
- `accessPending` の店主は `/api/session`・`/api/logout`・`/api/access/verify` 以外の `/api/` に 409（`legacyNotes` のガードと同じ位置）。
- 既存店主・お客様・スタッフ・LP・公開店舗ページには影響しない。

## 文言

- すべて `tr()` で日英両方を用意する（審査員向けに英語必須）。

## インフラ（`infra/`）

- Secret Manager に `gemihub-web-judge-invite`（Terraform の `random_id` で生成）、`gemihub-web-access-password`・`gemihub-web-openai-api-key`（payload は手動投入）を追加し、`shared_vm_registration.secrets` に `JUDGE_INVITE`・`ACCESS_PASSWORD`・`OPENAI_API_KEY` を注入。
- `env` に `JUDGE_UNTIL`・`JUDGE_AI_LIMIT`・`ADMIN_EMAILS`・`OPENAI_MODEL`・`OPENAI_IMAGE_MODEL` を追加（変数化、`JUDGE_UNTIL` の既定は `2027-01-31T15:00:00Z`）。
- `output "judge_url"`（sensitive）で招待 URL を出す（kakeratta と同じ）。
- `infra/tests` に有効時・無効時の出力テストを追加。

## 運用チェックリスト（コード外）

- 管理画面でデモ用 Google を接続し、AI プロバイダを決めて接続テストを通しておく。
- Devpost の「Tools」欄に Vertex AI（Gemini）と OpenAI の用途を記載する（管理画面で切替可能であること）。
- Devpost のテスト手順に招待 URL、「Try as a customer」の使い方、Sandbox 購入者アカウント（またはテストカード）を記載する。公開 README には招待 URL・パスワードを書かない。
- デモ動画では通常サインインで Gmail 送信とカレンダー連携が実際に動く様子を見せる。
- GCP の予算アラートを設定する。
- 提出前に審査員アクセスを 2 アカウント分試し、フォルダ・メール一覧・AI 上限が分かれていることを確認する。

## テスト（`tests/`）

- 審査員アクセス無効（未設定・期限切れ・招待不一致）: `/judge/...` は 404、`/api/judge/*` は 404/403、既存の審査員セッションは 401。
- 招待 URL から審査員が作られ、同じブラウザでは再開、別 Cookie では別の審査員になる。
- 初期化: 店舗フォルダがゴミ箱へ移り、店舗・メール記録・お客様の一時ユーザーが消え、新しい空の店舗に切り替わる。AI 使用回数は残る。同じ `requestId` の再実行で重複処理しない。他の審査員・通常店舗のデータは消えない。審査員以外は 403。
- 審査員店舗の公開で `provision` が運営者トークンと審査員ごとの親フォルダで呼ばれる（Google クライアントはモック）。
- 審査員店舗のメールは `sendMail` が呼ばれず `judgeMail` に記録され、`/api/judge/mails` で自店舗分だけ取得できる。
- 「Try as a customer」は該当審査員のブラウザからのみ有効。
- AI 上限を超えると 429、再試行は加算されない。
- 通常店舗のメール送信・保存先は変わらない。
- 管理画面: 運営者以外は 404。デモ用 Google の接続で運営者の `User` は変わらず `demoGoogle` に暗号化保存される。未接続なら審査員店舗は 503。審査員一覧・招待 URL は運営者にだけ返る。
- AI プロバイダ: 切替が全機能に反映される（`generateJson`・`runTools`・`generateImage` を両実装でモック SDK により検証）。OpenAI のキー・モデル未設定なら切替を拒否。失敗時に他方へフォールバックしない。
- 招待パスワード: 新規店主は `accessPending`、他 API は 409、誤りで 401・超過で 429、正しいと店舗作成。既存店主・`legacyNotes`・お客様はパスワード不要。招待制無効なら従来どおり。

## 対象外

- 審査員の再ログイン（別端末での再開）・通常アカウントへの引き継ぎ。
- 審査終了後の自動削除。
- サイト全体の Basic 認証。
- `DEMO_MODE` の公開利用。
