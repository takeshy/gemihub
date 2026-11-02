# gemihub の識別子

この予約サービスは **gemihub**（https://gemihub.net）、隣の `../gemihub` にあるサービスは **kiokuflow**（https://kiokuflow.net）です。チェックアウトのディレクトリ名はそのままです。この予約サービスはまだリリースされていないため、旧名称のデータ移行や互換処理は設けません。

| 用途 | このサービスの名前 |
| --- | --- |
| Firestore DB | `gemihub` |
| Firestoreコレクション | `gemihub_state`、`gemihub_locks` |
| Cookie | `gemihub_session`、`gemihub_oauth`、`gemihub_locale` |
| ブラウザ保存キー | `gemihub:` |
| 言語ヘッダー・HTMLメタデータ | `X-Gemihub-Language`、`gemihub-language` |
| ダウンロード版のデータ | `window.__GEMIHUB_MOCK__` |
| ドメイン確認TXT | `_gemihub.<domain>` |
| 共有VM登録・LBバックエンド | `gemihub-web`、`shared-apps-gemihub-web` |
| サービスアカウント・Secret・レジストリ等 | `gemihub-web` プレフィックス |

kiokuflow側は既存のVMデプロイグループ `gemihub` を維持しています。Kakerattaの共有VM登録コードも `gemihub` を予約しています。このサービスでは追加アプリID `gemihub-web`、ポート8105、ネットワーク172.28.4.0/24を使い、既存アプリのイメージ・アカウント・DBを使用しません。

LBを管理するTerraformは引き続き隣のリポジトリにあります。出力をマージするときは `shared_vm_backends.gemihub-web` と `shared_vm_hosts.gemihub-web` を追加します。既存DNS・証明書・URL mapは重複管理せず、kiokuflow側の切り替えに合わせてgemihub.netの配信先を設定します。

この変更ではTerraform apply・配置・DNSの切り替えを行いません。指定済みGoogle OAuthの既存Secret参照とコールバック `https://gemihub.net/auth/google/callback` はそのまま使います。

## 旧ノート利用者の入口

旧GemiHubのノート機能はkiokuflow.netへ移りました。gemihub.netを配信する本リポジトリが、店主Googleログイン時の旧設定の検出と設定画面での案内を担当します。kiokuflow側が、新しいGoogle認証後の旧ノート・設定・暗号鍵のコピーを担当します。予約サービスのDBを旧ノートのDBに接続したり、旧OAuth Secretを変更したりはしません。

旧ノートアプリのService Workerは `/sw.js` の終了用スクリプトへ更新し、`gemihub-sw-` キャッシュだけを削除して登録を解除します。IndexedDBや別のキャッシュは削除しません。終了用スクリプトはDBへの接続前にno-storeで返します。
