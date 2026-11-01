import { localizeShell } from "../shared/html.ts";
import { tr } from "../shared/i18n.ts";
import { shopSchema, type ShopConfig } from "./domain.ts";
import { renderCustomPage } from "./page-renderer.tsx";
import { renderChrome } from "./chrome-renderer.tsx";
import { systemSvg } from "./shop-system.ts";
import { driveMock, renderMockScript } from "./drive-mock.ts";
import { inlineDriveShell, type ReadBuildAsset } from "./drive-shell.ts";
import { withInlineImages } from "./image-references.ts";
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
// The same template is used for the live page and the readable Drive artifact.
// AI only supplies validated data; it cannot add JavaScript or alter auth guards.
export function renderShop(config: ShopConfig, shell: string) {
  const c = shopSchema.parse(config);
  return localizeShell(shell)
    .replace(
      /<title>.*?<\/title>/s,
      () => tr("<title>{0} — ご予約</title>", escapeHtml(c.name)),
    )
    .replace(
      '<div id="root"></div>',
      () =>
        tr("<div id=\"root\"></div><noscript><h1>{0}</h1><p>{1}</p><ul>{2}</ul><p>予約には JavaScript を有効にしてください。</p></noscript>", escapeHtml(c.name), escapeHtml(c.description), c.menus
          .filter((m) => m.active)
          .map(
            (m) =>
              tr("<li>{0} · {1}分 · {2}円</li>", escapeHtml(m.name), m.duration, m.price),
          )
          .join(
            "",
          )),
    );
}
export function driveSnapshot(config: ShopConfig, shell: string, readAsset?: ReadBuildAsset, menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>): Record<string, string> {
  const mock = driveMock(config, menuImages);
  let offline = renderShop(mock.shop, shell).replace(
    /<div id="root"><\/div><noscript>([\s\S]*?)<\/noscript>/,
    (_match, fallback: string) => `<div id="root"><div class="public-shop">${fallback}</div></div>`,
  ).replace(
    tr("予約には JavaScript を有効にしてください。"), tr("予約の操作には JavaScript と、同じフォルダーの data.js が必要です。"),
  );
  // Complete HTML substitutions before embedding JS: translation catalogs can
  // themselves contain root/noscript markup and must never be rewritten.
  offline = inlineDriveShell(offline, readAsset);
  const reference = '<script src="./data.js"></script>';
  const headEnd = offline.lastIndexOf('</head>');
  offline = headEnd >= 0 ? offline.slice(0, headEnd) + reference + "\n" + offline.slice(headEnd) : reference + offline;
  return {
    "web/index.html": offline,
    "web/data.js": renderMockScript(mock),
    "web/shop.json": JSON.stringify(mock.shop, null, 2),
    "web/mock.json": JSON.stringify(mock, null, 2),
  };
}
export function artifacts(config: ShopConfig, shell: string, readAsset?: ReadBuildAsset, menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>): Record<string, string> {
  const c = shopSchema.parse(config);
  const inline = withInlineImages(c, menuImages);
  return {
    ...driveSnapshot(c, shell, readAsset, menuImages),
    ...Object.fromEntries((["header", "footer"] as const).flatMap(part => [[`web/parts/${part}.html`, renderChrome(inline, part)], [`web/parts/${part}.json`, JSON.stringify(c[part], null, 2)]])),
    ...Object.fromEntries(c.pages.flatMap(page => [[`web/pages/${page.slug}.html`, renderCustomPage(inline.pages.find(item => item.id === page.id)!, shell)], [`web/pages/${page.slug}.json`, JSON.stringify(page, null, 2)]])),
    "web/pages/index.json": JSON.stringify(c.pages.map(({ id, slug, title, navigationLabel }) => ({ id, slug, title, navigationLabel })), null, 2),
    "admin/system.svg": systemSvg(c),
    "admin/index.html": shell,
    "schema.md":
      tr("# データ構造 v1\n\n## menus\nid, name, duration (分), price (円), active (true/false), imageId (任意・メニュー画像の識別子)\nメニュー画像の本体は店主のDrive、参照はimageIdに保存します。画像として登録したものだけを公開中の有効なメニューから配信します。\n\n## staff\nid, name, menuIds (JSON配列), weekdays (JSON配列・日曜0), start (HH:mm), end (HH:mm), imageId (任意・スタッフ写真)\n既存6列の順序を維持して末尾にimageIdを追加します。旧6列も読めます。\n\n## settings\nkey, value (JSON)\n\n## reservations\nid, customer, name, menuId, staffId, start (ISO UTC), end (ISO UTC), status (active/cancelled/no_show), createdAt, updatedBy, updatedAt, requestKey, price (予約時点の円・必須の非負整数), message (任意・最大2000文字), payment (任意JSON・PayPal環境/注文ID/決済ID/金額/予約時返金条件/キャンセル・返金状態)\n既存14列の末尾にpaymentを追加。旧14列も読み込めます。決済・返金の処理記録はFirestoreに固定し、失敗時に復旧します。シートの直接編集から返金を実行しません。認証情報は保存しません。\n\n## inquiries\nid, email, name, message, reply, status, at\n\n## members\nemail, accepted (true/false), status (registered/accepted/revoked; invitedは旧招待との互換), invitedAt, acceptedAt, revokedAt\n\n## customers\nemail (前後空白除去・小文字), updatedBy, updatedAt (ISO UTC)\nメールをキーにお客様単位の情報を保持します。将来の情報もこのシートに集約します。\n\n## customer_notes\nid, email, text, attachments (JSON配列: id/name/mimeType/size), createdAt, createdBy, status (active/deleted), updatedAt, updatedBy\n1投稿1行。編集時は更新者・更新日時を記録し、削除は状態変更で保持します。添付本体は店主のDriveに非公開で保存し、運営専用APIから取得します。添付は5ファイルまで、各5MB・合計10MB以内です。ファイル名は登録・編集時に変更でき、シートのnameとDriveのファイル名を更新します。画像一覧は当該お客様の全期間の有効な画像添付を登録日時順に表示し、メモ本文は表示しません。\n\n## posts\nid, record (JSON)\n\n## pages\nid, record (JSON) — ページごとに1行。settings.pages は見出しとアドレスの索引。\n\n## お客様の集計\n予約の customer と問い合わせの email を前後空白除去・小文字で統合します。氏名は記録日時（createdAt / at）が最新の記録から取得し、同時刻は種別とIDで決定します。来店実績は status=active かつ end が集計時点以前の予約です。来店日には start を用います。合計金額は実績予約の price の合計です。集計期間は全期間・1週間前・1か月前・3か月前・半年前・1年前・任意の開始日を指定できます。開始日の日本時間0時以降の start / at / メモのcreatedAt で履歴・来店回数・最終来店日・合計金額を絞り込み、未来の予約も表示します。月・年は暦でさかのぼり、該当日がなければ月末を使います。氏名は全期間の最新の予約・問い合わせから取得し、メモの有無は全期間で判定します。予約料金は必須で、現在のメニュー料金の変更には影響されません。\n\ncustomers はお客様単位の情報、customer_notes はメモのタイムラインの保存先です。店主と参加済みメンバーだけが CRM を閲覧・編集できます。\n\n## AIとのチャット\nai_chats: id, email, intent, title, createdAt, updatedAt\nai_chat_messages: id, conversationId, email, role, text, requestId, sequence, createdAt, updatedAt, detail (JSON)\n会話は非公開で保存し、アプリではログイン中の本人のチャットだけを再開できます。\n\n## 追加シートのデータ管理\n標準シートは各専用管理画面で扱います。それ以外の追加シートは店主専用の「データ管理」で一覧・検索・行追加・編集できます。1行目を重複のない列名（100列まで）、2行目以降をデータ（1000行まで）とします。行の追加は末尾へ行い、列名・列順・既存の数式は変更しません。値は RAW で変更セルだけ保存し、入力を新しい数式として解釈しません。行全体の削除はせず、編集元から更新されたセルがあれば競合として停止します。シートを直接編集する操作はアプリのロックに参加しないため、同時編集は避けてください。\n\nマスター・予約・問い合わせ・お客様・メンバー・記事は店主のシートから読み込みます。列名・列順は変更しないでください。キャンセルや参加解除は行を消さず状態変更で履歴を保持します。\n"),
  };
}
export const checklist = () => [
  tr("設定データの形式と参照関係を検証"),
  tr("認証・本人による絞り込みを固定の API で強制"),
  tr("店名・メニュー名などの HTML をエスケープ"),
  tr("顧客向けと運営向けの URL・ファイルを分離"),
  tr("モックを生成し、プレビューの書き込みを破棄"),
];
