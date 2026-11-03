import { formatMoney, currencyOf, regionOf } from "../shared/region.ts";
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
              tr("<li>{0} · {1}分 · {2}</li>", escapeHtml(m.name), m.duration, escapeHtml(formatMoney(m.price, currencyOf(regionOf(c)), "en-US"))),
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
    ...Object.fromEntries(c.pages.flatMap(page => [[`web/pages/${page.slug}.html`, renderCustomPage(inline.pages.find(item => item.id === page.id)!, shell, "", inline)], [`web/pages/${page.slug}.json`, JSON.stringify(page, null, 2)]])),
    "web/pages/index.json": JSON.stringify(c.pages.map(({ id, slug, title, navigationLabel }) => ({ id, slug, title, navigationLabel })), null, 2),
    "admin/system.svg": systemSvg(c),
    "admin/index.html": shell,
    "schema.md":
      tr("# データ構造 v1\n\n設定・予約・問い合わせ・お客様・メンバー・記事・AIチャットの正本はFirestoreです。Google Sheetsは使用しません。\n\n## 書き出し\n店主は「公開の設定」からJSON全体またはCSVをダウンロードできます。JSONにはschemaVersion、exportedAt、shop（設定・下書き・変更履歴）、records、本人のchatsとmessagesが含まれます。CSVは予約・お客様・お問い合わせ・メモ・メンバー・記事・メニュー・スタッフを選べます。\n\n## ファイルと権限\n画像・添付・仕様書・変更履歴・オフラインページは店主のDriveに保存します。書き出しには画像・添付の参照を含みますが、本体・認証情報・他人の非公開チャットは含みません。JSON・CSVの編集では本番データは変わりません。予約の取消やメンバーの解除はアプリから操作します。\n"),
  };
}
export const checklist = () => [
  tr("設定データの形式と参照関係を検証"),
  tr("認証・本人による絞り込みを固定の API で強制"),
  tr("店名・メニュー名などの HTML をエスケープ"),
  tr("顧客向けと運営向けの URL・ファイルを分離"),
  tr("モックを生成し、プレビューの書き込みを破棄"),
];
