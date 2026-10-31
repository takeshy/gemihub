import { shopSchema, type ShopConfig } from "./domain.ts";
import { renderCustomPage } from "./page-renderer.tsx";
import { renderChrome } from "./chrome-renderer.tsx";
import { systemSvg } from "./shop-system.ts";
import { driveMock, renderMockScript } from "./drive-mock.ts";
import { inlineDriveShell, type ReadBuildAsset } from "./drive-shell.ts";
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
  return shell
    .replace(
      /<title>.*?<\/title>/s,
      () => `<title>${escapeHtml(c.name)} — ご予約</title>`,
    )
    .replace(
      '<div id="root"></div>',
      () =>
        `<div id="root"></div><noscript><h1>${escapeHtml(c.name)}</h1><p>${escapeHtml(c.description)}</p><ul>${c.menus
          .filter((m) => m.active)
          .map(
            (m) =>
              `<li>${escapeHtml(m.name)} · ${m.duration}分 · ${m.price}円</li>`,
          )
          .join(
            "",
          )}</ul><p>予約には JavaScript を有効にしてください。</p></noscript>`,
    );
}
export function driveSnapshot(config: ShopConfig, shell: string, readAsset?: ReadBuildAsset): Record<string, string> {
  const mock = driveMock(config);
  let offline = renderShop(mock.shop, inlineDriveShell(shell, readAsset)).replace(
    /<div id="root"><\/div><noscript>([\s\S]*?)<\/noscript>/,
    (_match, fallback: string) => `<div id="root"><div class="public-shop">${fallback}</div></div>`,
  ).replace(
    '予約には JavaScript を有効にしてください。', '予約の操作には JavaScript と、同じフォルダーの data.js が必要です。',
  );
  const reference = '<script src="./data.js"></script>';
  offline = offline.includes('</head>') ? offline.replace('</head>', `${reference}\n</head>`) : reference + offline;
  return {
    "web/index.html": offline,
    "web/data.js": renderMockScript(mock),
    "web/shop.json": JSON.stringify(mock.shop, null, 2),
    "web/mock.json": JSON.stringify(mock, null, 2),
  };
}
export function artifacts(config: ShopConfig, shell: string, readAsset?: ReadBuildAsset): Record<string, string> {
  const c = shopSchema.parse(config);
  return {
    ...driveSnapshot(c, shell, readAsset),
    ...Object.fromEntries((["header", "footer"] as const).flatMap(part => [[`web/parts/${part}.html`, renderChrome(c, part)], [`web/parts/${part}.json`, JSON.stringify(c[part], null, 2)]])),
    ...Object.fromEntries(c.pages.flatMap(page => [[`web/pages/${page.slug}.html`, renderCustomPage(page, shell)], [`web/pages/${page.slug}.json`, JSON.stringify(page, null, 2)]])),
    "web/pages/index.json": JSON.stringify(c.pages.map(({ id, slug, title, navigationLabel }) => ({ id, slug, title, navigationLabel })), null, 2),
    "admin/system.svg": systemSvg(c),
    "admin/index.html": shell,
    "schema.md":
      "# データ構造 v1\n\n## menus\nid, name, duration (分), price (円), active (true/false)\n\n## staff\nid, name, menuIds (JSON配列), weekdays (JSON配列・日曜0), start (HH:mm), end (HH:mm)\n\n## settings\nkey, value (JSON)\n\n## reservations\nid, customer, name, menuId, staffId, start (ISO UTC), end (ISO UTC), status (active/cancelled/no_show), createdAt, updatedBy, updatedAt, requestKey\n\n## inquiries\nid, email, name, message, reply, status, at\n\n## members\nemail, accepted (true/false), status (invited/accepted/revoked), invitedAt, acceptedAt, revokedAt\n\n## posts\nid, record (JSON)\n\n## pages\nid, record (JSON) — ページごとに1行。settings.pages は見出しとアドレスの索引。\n\nマスター・予約・問い合わせ・メンバー・記事は店主のシートから読み込みます。列名・列順は変更しないでください。キャンセルや参加解除は行を消さず状態変更で履歴を保持します。\n",
  };
}
export const checklist = [
  "設定データの形式と参照関係を検証",
  "認証・本人による絞り込みを固定の API で強制",
  "店名・メニュー名などの HTML をエスケープ",
  "顧客向けと運営向けの URL・ファイルを分離",
  "モックを生成し、プレビューの書き込みを破棄",
];
