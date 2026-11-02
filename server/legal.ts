import { tr, getLocale } from "../shared/i18n.ts";
import { escapeHtml } from "./artifacts.ts";

export function renderLegal(kind: "policy" | "terms") {
  const title = kind === "policy" ? tr("プライバシーポリシー") : tr("利用規約");
  const sections = kind === "policy" ? [
    [tr("運営と対象"), tr("gemihubはtakeshy.workが提供する、お店づくりと予約管理のサービスです。このページでは、サービス上で扱う情報とその利用方法を説明します。")],
    [tr("利用する情報"), tr("Googleログインの氏名・メールアドレス、登録時に入力する会員情報、予約・お問い合わせ・お客様メモ、アップロードした画像、お店の設定、AIへの依頼内容を、選択した機能のために利用します。接続・障害対応のための技術ログも記録します。")],
    [tr("Googleサービスとの接続"), tr("店主のDriveとスプレッドシートにお店のファイルや業務データを保存し、Gmailの送信権限で予約などの通知を送ります。Gmailの受信メールを読み取る機能はありません。スタッフがカレンダー連携を許可した場合は、空き時間の確認に予定の時間帯を利用し、予定のタイトルや本文は取得しません。")],
    [tr("AI処理と決済"), tr("AIへの依頼と、その処理に必要なお店の情報・選択した画像はGoogle CloudのVertex AIへ送信します。本サービスで利用者データをAIモデルの学習に使う機能はありません。事前決済を有効にした店舗ではPayPalを利用し、カード情報は本サービスで保管しません。")],
    [tr("保存先とアクセス"), tr("業務データの主な保存先は店主のGoogle Driveとスプレッドシートです。サーバーのFirestoreには、暗号化したGoogle認証情報、ログイン状態、公開用の設定、変更案や処理待ち情報などを保存します。お店のデータは、本人・店主・許可されたスタッフなど、それぞれの機能で必要な範囲に分けて扱います。")],
    [tr("旧ノートの引き継ぎ"), tr("旧GemiHubの設定の有無を確認し、該当する方をkiokuflow.netの引き継ぎ画面へ案内します。ノートのコピーはkiokuflow側で行い、コピーの検証後に旧設定をゴミ箱へ移します。元のノート・添付ファイルは残します。旧設定がなくなったことを確認してから、お店の機能を利用できます。")],
    [tr("利用範囲・削除・お問い合わせ"), tr("Googleから受け取る情報は、案内した機能の提供と改善に必要な範囲で扱い、販売や広告配信のために利用しません。Googleアカウントの設定から連携を解除できます。店舗の予約や会員情報の削除は店舗運営者へ、サービス側のアカウント・認証情報の削除やお問い合わせはtakeshy.workへご連絡ください。")]
  ] : [
    [tr("ご利用について"), tr("自分が利用する権限のあるGoogleアカウントとお店の情報を使ってください。他の方の情報への不正なアクセス、法令や第三者の権利を侵害する利用を行わないでください。")],
    [tr("AIの変更案と公開"), tr("AIが作成する内容は変更案です。店舗運営者が内容を確認し、承認・公開してください。営業時間・料金・予約条件・公開する文章や画像の内容は、店舗運営者が管理してください。")],
    [tr("予約とお支払い"), tr("予約サービスの提供、料金、キャンセルや返金の条件は各店舗が案内する内容を確認してください。事前決済にはPayPalを利用する場合があります。GoogleやPayPalなど外部サービスの利用には、それぞれの利用条件も適用されます。")],
    [tr("データの管理とサービスの変更"), tr("大切なデータは必要に応じてバックアップしてください。外部サービスや通信環境などにより、利用できない場合があります。旧ノートの引き継ぎでは案内内容を確認し、処理中は旧・新環境での編集を止めてください。サービスへのお問い合わせはtakeshy.workへご連絡ください。")]
  ];
  const locale = getLocale();
  const body = sections.map(([heading, text]) => `<section><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(text)}</p></section>`).join("");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | gemihub</title><link rel="canonical" href="https://gemihub.net/${kind}"><style>body{margin:0;background:#f8f9f5;color:#283c35;font:16px/1.8 system-ui,sans-serif}main{max-width:780px;margin:24px auto;padding:24px;background:white;border:1px solid #e3e8df;border-radius:16px}header,footer{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}h1{font-size:clamp(1.4rem,5vw,2rem)}h2{font-size:1.1rem;margin-top:28px}a{color:#284f43}p{overflow-wrap:anywhere}@media(max-width:840px){main{margin:16px;padding:20px}}</style></head><body><main><header><a href="/lp">gemihub</a><nav><a href="/${kind}?lang=ja">${escapeHtml(tr("日本語"))}</a> / <a href="/${kind}?lang=en">English</a></nav></header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(tr("最終更新: 2026年11月2日"))}</p>${body}${kind === "policy" ? '<p><a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy (Limited Use)</a><br><a href="https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance">Google Cloud AI data governance</a></p>' : ''}<footer><a href="/lp">${escapeHtml(tr("サービス紹介へ戻る"))}</a><a href="https://takeshy.work">takeshy.work</a></footer></main></body></html>`;
}
