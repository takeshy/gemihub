# Gemini Hub コードレビュー

## 全体的な評価

よく設計されたアプリケーション。React Router 7 + SSR、Google Drive バックエンド、SSE ストリーミング、IndexedDB オフラインファーストなど、モダンな技術選択がされている。以下、カテゴリ別に指摘事項をまとめる。

---

## 1. セキュリティ（重要度: 高）

### 1-1. SSRF (Server-Side Request Forgery) — MCP エンドポイント

**対象ファイル:**
- `app/routes/api.mcp.tool-call.tsx`
- `app/routes/api.mcp.resource-read.tsx`
- `app/routes/api.settings.mcp-test.tsx`
- `app/routes/api.settings.mcp-oauth-token.tsx`

クライアントから送られた `serverUrl` をそのまま `fetch` に渡している。内部ネットワーク（`127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`）へのアクセスを防ぐバリデーションがない。

**推奨:** URL のスキームを HTTPS に限定し、プライベート IP レンジへのリクエストをブロックするバリデーションを追加する。

### 1-2. OAuth フローに CSRF 対策がない

**対象:** `app/services/google-auth.server.ts:17-24`

`generateAuthUrl()` で `state` パラメータが生成・検証されていない。OAuth CSRF 攻撃に対して脆弱。

**推奨:** セッションに紐づいたランダムな `state` パラメータを生成し、コールバック時に検証する。

### 1-3. API キーのセッション内平文保存

**対象:** `app/services/session.server.ts:39`

`geminiApiKey` がセッション Cookie に平文で保存されている。

**推奨:** サーバーサイドでのみ API キーを保持するか、セッション内で暗号化して保存する。

### 1-4. Drive API クエリのエスケープ不足

**対象:** `app/services/google-drive.server.ts` (行 51, 81, 118, 297, 316, 334)

`replace(/'/g, "\\'")` による手動エスケープのみで、Drive API クエリ言語の他の特殊文字に対する防御がない。

### 1-5. ファイルアップロードのパストラバーサル

**対象:** `app/routes/api.drive.upload.tsx:39`

```typescript
const uploadName = namePrefix ? `${namePrefix}/${file.name}` : file.name;
```

`namePrefix` に `../` が含まれた場合のサニタイズがない。

### 1-6. fetch に AbortSignal / タイムアウトがない

**対象:** `app/services/google-drive.server.ts`, `app/services/mcp-client.server.ts` 等

すべての外部 `fetch` 呼び出しにタイムアウトが設定されておらず、リクエストが無限にハングする可能性がある。

---

## 2. 入力バリデーション（重要度: 高）

### 2-1. リクエストボディのスキーマバリデーション不在

ほぼすべての API ルートで、リクエストボディの構造を検証していない。`zod` や類似のライブラリによるスキーマバリデーションの導入を推奨。

**特に影響が大きい箇所:**
- `api.chat.tsx:32-60` — messages 配列の構造未検証
- `api.sync.tsx:59` — action タイプのホワイトリスト検証なし
- `api.drive.files.tsx:88` — actionType の検証なし
- `settings.tsx:254, 264, 300` — `JSON.parse()` が try-catch なし

### 2-2. MCP ツール呼び出しの引数未検証

**対象:** `app/services/drive-tools.server.ts:122-126`

```typescript
case "read_drive_file": {
  const fileId = args.fileId as string; // バリデーションなし
```

---

## 3. アーキテクチャ・設計（重要度: 中）

### 3-1. グローバルな Mutable State

**対象:**
- `app/services/mcp-tools.server.ts:13` — `mcpClients = new Map()`
- `app/services/user-settings.server.ts:9` — `settingsCache = new Map()`
- `app/services/execution-store.server.ts:19` — `executions = new Map()`

グローバル `Map` がリクエストやユーザーごとに分離されていない。マルチユーザー環境でデータリークのリスクがある。

**推奨:** リクエストスコープのコンテキストに移行するか、キーにユーザー識別子を含める。

### 3-2. エラーハンドリングの不統一

サービス間でエラーの扱いが統一されていない:
- `null` を返すもの (`sync-meta.server.ts:61-63`)
- 例外を投げるもの (`google-drive.server.ts:41`)
- `console.log` で記録して続行するもの (`mcp-client.server.ts:287`)

**推奨:** エラーハンドリング戦略を統一する。

### 3-3. サイレントな失敗

**主な箇所:**
- `chat-history.server.ts:45-61` — `Promise.allSettled()` の失敗がログなし
- `execution-store.server.ts:40` — state が見つからない場合に `return` で黙って終了
- 多くの `.catch()` ブロックでエラーの詳細が破棄されている

---

## 4. コンポーネント層（重要度: 中）

### 4-1. Error Boundary がない

コンポーネントツリー全体に React Error Boundary が存在しない。1 つのコンポーネントのエラーがアプリ全体をクラッシュさせる。

**推奨:** 最低限、チャットパネル・ワークフローエディタ・メインビューワそれぞれに Error Boundary を設置する。

### 4-2. 大きなコンポーネントの分割が必要

- `MainViewer.tsx` (628 行) — 3 つのサブコンポーネントがインライン定義。`MarkdownFileEditor` と `TextFileEditor` に約 260 行の重複コードあり
- `ChatPanel.tsx` (548 行) — 11 個の state 変数。SSE パース処理をカスタムフックに抽出すべき
- `ChatInput.tsx` (637 行) — オートコンプリート処理を分離すべき

### 4-3. パフォーマンス

- `MessageBubble.tsx` — `React.memo` なし、リスト内で頻繁に再レンダリング
- `ChatPanel.tsx:438-450` — `handleSend` がストリーミング中に毎文字再生成される
- `ExecutionPanel.tsx` — ログリストに仮想化なし。大量ログでパフォーマンス劣化
- 複数箇所でリストの `key` にインデックスを使用（`DiffView.tsx:25`, `ExecutionPanel.tsx:80`）

### 4-4. アクセシビリティ

- コンポーネント全体で `aria-label` が 7 つしかない（イベントハンドラは 226 個）
- アイコンのみのボタンにラベルなし（`ChatInput.tsx` の添付・ツールボタン等）
- `AutocompletePopup` に `role="listbox"` がない
- `ConflictDialog.tsx:76-119` — クリック可能な `div` に `role="button"` がない

### 4-5. innerHTML による XSS リスク（軽微）

- `MermaidPreview.tsx:38`, `MermaidCodeBlock.tsx:30` — `innerHTML = svg` で React の XSS 防御をバイパス

---

## 5. ワークフローエンジン（重要度: 中〜高）

### 5-1. ノード ID の衝突検知なし

**対象:** `app/engine/parser.ts:79`

ユーザーが ID を指定しない場合 `node-1`, `node-2` と自動生成されるが、ユーザーが明示的に `node-5` 等を指定した場合に衝突チェックがない。

### 5-2. HTTP/MCP ハンドラにタイムアウトなし

**対象:** `app/engine/handlers/http.ts:132`, `app/engine/handlers/mcp.ts`

`fetch()` にタイムアウトが設定されておらず、ワークフローが無限にハングする可能性がある。

### 5-3. ゼロ除算がサイレントに 0 を返す

**対象:** `app/engine/handlers/controlFlow.ts:40`

```typescript
case "/": return right !== 0 ? left / right : 0;
```

エラーまたは警告を出すべき。

### 5-4. 算術式が単一の二項演算のみ対応

**対象:** `app/engine/handlers/controlFlow.ts:22-49`

`{{a}} + {{b}} + {{c}}` のような複合式が処理できない。

### 5-5. Drive ファイル ID の判定が脆弱

**対象:** `app/engine/handlers/drive.ts:77-82`

```typescript
if (!path.includes(".") && path.length > 20) {
```

ドットを含まず 20 文字以上のファイル名が誤って Drive ID と判定される。

### 5-6. Drive API のリトライ処理なし

レート制限（429）やサーバーエラー（503）に対するリトライロジックがなく、一時的なエラーでワークフロー全体が失敗する。

---

## 6. その他

### 6-1. 弱い ID 生成

**対象:** `app/services/edit-history.server.ts:52-54`

```typescript
function generateId(): string {
  return Math.random().toString(36).substring(2, 8);
}
```

`Math.random()` はユニーク性が保証されない。`crypto.randomUUID()` を使用すべき。

### 6-2. テストがない

テストフレームワークが未導入。最低限、以下のテストを推奨:
- ワークフローエンジン（パーサー・エグゼキューター）のユニットテスト
- API ルートの統合テスト
- セキュリティ関連の回帰テスト

### 6-3. プロダクションコードに console.log が残存

**対象:** `app/components/ide/EncryptedFileViewer.tsx` に 10 箇所以上のデバッグログ

---

## 優先度まとめ

| 優先度 | カテゴリ | 項目数 |
|--------|----------|--------|
| **即時対応** | SSRF 防御、OAuth CSRF、パストラバーサル、fetch タイムアウト | 6 件 |
| **短期** | 入力バリデーション（zod 導入）、Error Boundary、エラーハンドリング統一 | 5 件 |
| **中期** | コンポーネント分割、パフォーマンス改善、テスト導入、アクセシビリティ | 8 件 |
| **長期** | グローバル State の改善、ワークフローエンジンの堅牢化 | 4 件 |
