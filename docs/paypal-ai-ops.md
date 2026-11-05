# 仕様: PayPal連携の「相談・質問」と滞留アラート

対象: gemihub（PayPal AI Hackathon 提出前の追加機能）
目的: AIがPayPalの実データを読み、オーナーに説明・提案する。お金を動かすのは従来どおりサーバーの決定的なコードのみ。
審査上の狙い: 「AI × PayPal」が直接つながっていることを示す（Best Use of PayPal+AI）。

---

## 0. 原則（変えないこと）

- AIはPayPalに**書き込まない**。AIが使えるPayPalツールは読み取り専用。
- 返金・再試行などの実行は、既存のサーバー処理（`refundQuote()`、`PayPal-Request-Id`冪等キー、リコンサイラ）経由のみ。
- 実行には必ずオーナーの画面上の承認が必要（propose → preview → approve）。
- 金額はAIが計算しない。表示する金額はすべてサーバー/PayPalから取得した値。
- 対象はそのショップ自身の取引のみ。他ショップのデータは見えない。

---

## 1. 機能A: 「相談・質問」でPayPalを読む

### 1.1 概要
既存の読み取り専用リサーチエージェントに、PayPalの読み取りツールを追加する。回答には従来の出典（spec.md / history.md / 台帳）に加えて、PayPalの記録を出典として表示する。

### 1.2 追加するツール（読み取り専用）
PayPal Orders / Payments / Transaction Search の読み取りREST呼び出しをサーバー側でラップする（`server/paypal.ts`）。Agent Toolkit は書き込み系ツールを含み、gemihub の LLM（Gemini）とも前提が違うため使わない。

- ツールは会話層が `investigate` に `paypal: true` を付けたときだけ渡す。それ以外の質問は従来どおりツールなしの1回呼び出し。

| ツール名（エージェント向け） | 中身 | 入力 | 出力（要約） |
| --- | --- | --- | --- |
| `paypal_get_order` | Orders v2 GET | `orderId` | status、amount、captureId |
| `paypal_get_capture` | Payments v2 captures GET | `captureId` | status、amount、refund合計 |
| `paypal_get_refund` | Payments v2 refunds GET | `refundId` | status、amount、理由 |
| `paypal_list_transactions` | Transaction Search | 期間（最大31日）、種別 | 取引一覧（ID、日時、金額、種別、状態） |
| `ledger_find_booking_payments` | 既存台帳 | 予約ID / 顧客 / 期間 | 予約⇔orderId/captureId/refundIdの対応 |

- ツール引数のIDは、そのショップの台帳に存在するものに限定（サーバー側で検証、なければ拒否）。
- Transaction Searchの期間はサーバーで上限を強制。
- 結果はエージェントに渡す前に必要項目だけに絞る（payerやお客様のメール等の個人情報は渡さない。顧客での検索はサーバー側で照合し、返すのは名前のみ）。
- 金額はすべて通常の単位（49.5 など）で渡す。台帳の最小単位（セント・円）はサーバーで変換する。

### 1.3 回答の振る舞い
- 台帳とPayPalの状態が食い違うときは、その差を明示する（例:「台帳では返金待ち、PayPalではCOMPLETED」）。
- 出典として、PayPalの記録（種別 + ID + 状態 + 取得時刻）を表示する。
- 分からない・取得できないときは推測せず、その旨を答える。
- 操作が必要そうなら、**提案カード**を出す（機能Cへ）。チャット本文で実行はしない。

### 1.4 質問例（デモ・テスト用）
- "Did the $49.50 refund go through?"
- 「今週の返金の合計は？」
- 「この予約、PayPalではどうなってる？」
- 「止まっている返金はある？」

### 1.5 相談時の処理の流れ（実装）

AIは2段階。PayPalを読むのは2段目の調査担当だけで、提案の選択と実行はサーバーのコードが行う。

```
店主の質問
  │
  ▼
① 会話AI（converse）……ツールは investigate / draft_request の2つだけ
  │  investigate(question, paypal: true)
  ▼
② 調査担当AI（research）……PayPal読み取りツール5つ（最大4往復）
  │  ツール呼び出し → サーバーが台帳でIDを確認 → PayPalにGET → 必要項目だけ返す
  ▼
  回答 + 出典（paypal:refund:ID など）
  │
  ▼
③ サーバー：アラート判定（台帳ルールのみ）と関係する提案の選択（AIは関与しない）
  │
  ▼
画面：回答 + 出典 + 提案カード
  │ 店主が「実行」
  ▼
④ サーバー：状態を確認し直してから既存処理を実行
```

**① 会話AI（`server/assistant.ts` の `converse()`）**
- 使えるのは `investigate`（事実の調査）と `draft_request`（設定変更の下書き）だけ。PayPalツールは見えない。
- 支払い・返金の質問だと判断したら、`investigate` に `paypal: true` を付けて呼ぶ。付けない質問は、従来どおりツールなしの1回呼び出しで答える。

**② 調査担当AI（`research()`、ツールは `server/paypal-ops.ts` の `toolProvider`）**
- ツールは相談のたびに、その店の台帳から作り直す。
- `ledger_find_booking_payments` は台帳だけを見る（PayPalには問い合わせない）。`paypal_get_order` / `paypal_get_capture` / `paypal_get_refund` はIDを指定してPayPalにGET、`paypal_list_transactions` は期間（最大31日）で取引を検索する。
- 例:「Did the $49.50 refund go through?」
  1. 台帳ツールで $49.50 の返金を探す → 予約 b1、返金ID、台帳上の状態 `retrying`
  2. `paypal_get_refund` でPayPal上の状態を読む → `COMPLETED`
  3. 「PayPalでは完了、台帳では再試行待ち」と差を明示して答え、出典に `paypal:refund:ID` を入れる
- ツール呼び出しごとにサーバーが守ること:
  - IDがこの店の台帳になければ、PayPalに問い合わせる前に拒否する。
  - 動くのはGETだけ。返金・決済のAPIにはAIから届かない。
  - 状態・金額・ID・日時だけを返す。お客様のメールアドレスは返さず、金額は通常の単位（$49.50 → 49.5）にそろえる。
  - 取得に失敗したら「取得できませんでした」とだけ返し、AIは推測しない。

**③ 提案カードの選択（`server/app.ts` の相談API）**
- 支払いの質問なら、台帳ルールだけでアラートを判定し直す（PayPalには問い合わせない。前回の毎時チェックで見つかった不一致は引き継ぐ）。
- `relevantProposals` が、質問・回答・出典に出た予約IDやPayPal IDに関係する提案だけを選ぶ。名指しがなければ、緊急度の高い順に最大5件。
- 提案の金額・操作はサーバーのルールが決めたもので、AIは関与しない。

**④ 実行（`paypal/proposals/execute`、オーナーのみ）**
1. 予約ロックを取り、毎分の自動処理と同時に動かないようにする。
2. 対象の予約だけをPayPalで確認し直し、提案時の状態（指紋）と比べる。ずれていれば実行せず最新の状態を返す。
3. 一致したら既存処理を呼ぶ。
   - 返金の再試行: リコンサイラが同じ `requestId` でやり直す（二重返金なし）。
   - 状態の再同期 / 手動確認の完了: PayPalから読み直し、`payments.sync` を通して台帳を更新する。
   - 割引枠の再販を終了: `transfers.close`。
4. 結果を history.md と操作ログに記録し、画面に返す。

**注意**: デモモード（`DEMO_MODE` があり、GCPの設定がない状態）では、相談は決まった応答（`demoReply`）を返すだけで、AIもこの流れも通らない。

---

## 2. 機能B: 滞留アラート（定期チェック + 通知）

### 2.1 概要
定期ジョブが台帳とPayPalを突き合わせ、オーナーの対応が必要なものを検出する。AIが短い日本語/英語の要約を作り、管理画面とGmailで通知する。

### 2.2 実行タイミング
- 既存のバックグラウンドループに相乗り。チェック間隔は1時間（設定可能）。
- 通知は1日1回のダイジェスト（例: ショップのタイムゾーンで朝9時）+ 緊急度の高いものは即時。
- 同じ項目を繰り返し通知しない（項目ごとに最終通知時刻を保存、状態が変わったら再通知）。

### 2.3 検出対象（ルールはサーバーで決定的に判定）

| 種別 | 条件 | 緊急度 |
| --- | --- | --- |
| 返金の停滞 | 返金が`retrying`/`pending`のまま N時間以上 | 中 |
| 資金待ち | `awaiting_funds` | 中 |
| 要手動確認 | `manual_review` | 高（即時） |
| 決済未確定 | `capturing`のまま一定時間 / capture応答不明 | 高（即時） |
| 状態の不一致 | 台帳とPayPalで状態が違う | 高 |
| 割引枠の売れ残り | 再販中で締切まで残り2時間以内 | 低 |

- `awaiting_approval` は checkout が10分で期限切れになるため検出対象にしない。
- PayPalへの照会（状態の不一致）は、未完了の返金と直近7日に動きのある決済に限り、最大30件。返金済みの決済（`REFUNDED` / `PARTIALLY_REFUNDED`）は正常とみなす。相談画面からのチェックは台帳ルールのみで、前回の照会結果を引き継ぐ。
- 検出はルールのみ。AIは**要約文を作るだけ**で、対象の選定や金額には関与しない。

### 2.4 通知の内容
- 件名例: 「gemihub: 対応が必要なものが3件あります」
- 本文: AI要約（2〜4文）+ 項目リスト（種別、予約、金額、PayPal ID、経過時間）+ 管理画面へのリンク。
- 管理画面: 「要対応」バッジとリスト。各項目から「相談・質問」を開くと、その項目を文脈に入れた状態で始まる。
- Gmail送信は既存のオーナーGmail送信を利用。オーナーが通知のオン/オフと時刻を設定できる。

---

## 3. 機能C: 提案と承認（A・Bから共通で使う）

### 3.1 提案できる操作（ホワイトリスト）
| 操作 | 実行する既存処理 | 条件 |
| --- | --- | --- |
| 返金の再試行 | リコンサイラの即時再試行 | `retrying` / `pending` |
| 状態の再同期 | PayPalから状態を取り直して台帳更新 | 不一致あり |
| 手動確認を完了にする | PayPalから返金状態を読み直し、完了なら台帳を更新（既存の同期処理） | `manual_review` かつ refund ID あり（ない場合はPayPal管理画面での確認を案内） |
| 割引枠の再販を終了 | 既存の決着処理（期限前の確定） | 再販中 |

- 新しい返金の作成・金額指定はAIから提案できない（v1）。
- 提案カードには、操作名、対象、**サーバーが計算した**金額、実行後の見込みを表示。
- オーナーが「実行」を押すと、サーバーが状態を再確認してから既存処理を呼ぶ（古い提案は拒否）。
- 実行結果はhistory.mdと操作ログに記録し、相談画面に結果を返す。

---

## 4. 審査員モード
- 審査員ショップでも機能A・Cは使える（Sandbox）。
- 機能Bは「今すぐチェック」ボタンで手動実行できるようにする（定期実行を待たずにデモできる）。
- 審査員モードではメール通知は送らず、管理画面の通知のみ。

---

## 5. 受け入れ条件
1. 相談画面で「Did the $49.50 refund go through?」と聞くと、PayPalの返金IDと状態（COMPLETED等）を出典付きで答える。
2. 他ショップのorderId/captureIdを指定しても、ツールは拒否し、AIはデータを返さない。
3. AIのツール一覧に、PayPalへ書き込むツールが存在しない（テストで確認）。
4. 返金を意図的に`retrying`状態にすると、次のチェックで検出され、管理画面に表示される。
5. 同じ項目は状態が変わらない限り再通知されない。
6. 提案カードの「実行」で既存の再試行処理が呼ばれ、`PayPal-Request-Id`が再利用される（二重返金なし）。
7. 提案から時間が経って状態が変わっていたら、実行は拒否され、最新状態が表示される。
8. 日本語/英語の両方で通知と回答が出る。
9. 審査員モードで「今すぐチェック」→ 通知 → 相談 → 承認 → 結果表示、が一通り動く。

---

## 6. テスト
- 単体: ツールのショップ境界チェック、検出ルール、重複通知の抑止、提案の失効。
- 結合（Sandbox, Playwright）: 返金停滞を作る → 検出 → 承認 → 返金完了 → PayPalで同じrefund IDを確認。
- AI失敗時: ツールがエラーでも回答は「取得できなかった」と答え、推測しない。

---

## 7. デモ（動画に足す15〜20秒）
1. 管理画面に「要対応 1件」の通知。
2. 開くと相談画面で、AIが「$49.50の返金が再試行待ちです（PayPal refund ID …）」と説明。
3. 「再試行」を承認 → 完了。
4. PayPalの画面で同じ返金を確認（既存シーンにつなぐ）。

Devpost追記案:
"Consult & ask now reads live PayPal data through read-only PayPal Orders and Payments API tools, and a background check flags stuck refunds and unsold slots. The AI explains what it found and proposes a fix; the owner approves, and the server executes it with the same idempotent PayPal calls."

---

## 8. 範囲外（v1ではやらない）
- AIによる新規返金の作成や金額の変更
- PayPal Disputes / Webhook署名検証（別タスク）
- SMSやLINEなど、メール以外の通知
