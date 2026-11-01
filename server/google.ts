import { google } from "googleapis";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { artifacts } from "./artifacts.ts";
google.options({ timeout: 15000 });
import {
  documents,
  shopSchema,
  type ShopConfig,
  type Booking,
} from "./domain.ts";
import type { ReleaseScope } from "./pages.ts";
import type { Shop } from "./store.ts";
export function oauth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_ORIGIN || "http://localhost:3000"}/auth/google/callback`,
  );
}
const key = () =>
  createHash("sha256")
    .update(process.env.SESSION_SECRET || "development-only")
    .digest();
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function decrypt(value: string) {
  const b = Buffer.from(value, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    cipher.update(b.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function clients(refreshToken: string) {
  const auth = oauth();
  auth.setCredentials({ refresh_token: decrypt(refreshToken) });
  return {
    auth,
    drive: google.drive({ version: "v3", auth }),
    sheets: google.sheets({ version: "v4", auth }),
    gmail: google.gmail({ version: "v1", auth }),
  };
}
const tabs = [
  "menus",
  "staff",
  "settings",
  "reservations",
  "inquiries",
  "members",
  "posts",
  "pages",
  "customers",
  "customer_notes",
  "ai_chats",
  "ai_chat_messages",
];
const headers = [
  ["id", "name", "duration", "price", "active", "imageId"],
  ["id", "name", "menuIds", "weekdays", "start", "end", "imageId"],
  ["key", "value"],
  ["id", "record"],
];
export async function provision(shop: Shop, config: ShopConfig, token: string) {
  const { drive, sheets } = clients(token);
  if (shop.google) return shop.google;
  const folder = await drive.files.create({
    requestBody: {
      name: `${config.name} — omaiweb`,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  const file = await drive.files.create({
    requestBody: {
      name: `${config.name} 予約台帳`,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [folder.data.id!],
    },
    fields: "id",
  });
  const sheetId = file.data.id!;
  const existing = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: existing.data.sheets![0].properties!.sheetId,
              title: "menus",
            },
            fields: "title",
          },
        },
        ...tabs
          .slice(1)
          .map((title) => ({ addSheet: { properties: { title } } })),
      ],
    },
  });
  const make = async (name: string) =>
    (
      await drive.files.create({
        requestBody: { name, parents: [folder.data.id!] },
        media: { mimeType: "text/markdown", body: Readable.from([""]) },
        fields: "id",
      })
    ).data.id!;
  return {
    sheetId,
    folderId: folder.data.id!,
    specId: await make("spec.md"),
    historyId: await make("history.md"),
  };
}
export async function syncConfig(
  shop: Shop,
  config: ShopConfig,
  token: string,
  onProgress: () => void | Promise<void> = () => {},
  scope?: ReleaseScope,
  menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>,
) {
  if (!shop.google) throw new Error("Google の保存先が未作成です");
  const { sheets, drive } = clients(token);
  const doc = documents(config, shop.history);
  // Prepare the runnable export before writing any remote data.
  const allGenerated = artifacts(config, await readFile("dist/index.html", "utf8"), undefined, menuImages);
  const pageIndex = config.pages.map(({ id, slug, title, navigationLabel }) => ({ id, slug, title, navigationLabel }));
  if (scope?.kind === "part") {
    const settings = await sheets.spreadsheets.values.get({ spreadsheetId: shop.google.sheetId, range: "settings!A:A" });
    const rows = settings.data.values || [];
    const found = rows.findIndex(row => row[0] === scope.part);
    const row = found >= 0 ? found + 1 : Math.max(2, rows.length + 1);
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: shop.google.sheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `settings!A${row}:B${row}`, values: [[scope.part, JSON.stringify(config[scope.part])]] }] } });
  } else if (scope?.kind === "page") {
    const pageRows = await sheets.spreadsheets.values.get({ spreadsheetId: shop.google.sheetId, range: "pages!A:B" });
    const rows = pageRows.data.values || [];
    const existing = rows.findIndex(row => row[0] === scope.pageId);
    const selected = config.pages.find(p => p.id === scope.pageId);
    if (selected || existing >= 0) {
      const vacant = rows.findIndex((row, index) => index > 0 && !row[0]);
      const row = existing >= 0 ? existing + 1 : vacant >= 0 ? vacant + 1 : Math.max(2, rows.length + 1);
      await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: shop.google.sheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `pages!A${row}:B${row}`, values: [selected ? [selected.id, JSON.stringify(selected)] : ["", ""]] }] } });
    }
    const settings = await sheets.spreadsheets.values.get({ spreadsheetId: shop.google.sheetId, range: "settings!A:A" });
    const settingsRows = settings.data.values || [];
    const found = settingsRows.findIndex(row => row[0] === "pages");
    const row = found >= 0 ? found + 1 : settingsRows.length + 1;
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: shop.google.sheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `settings!A${row}:B${row}`, values: [["pages", JSON.stringify(pageIndex)]] }] } });
  } else {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: shop.google.sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          {
            range: "menus!A1:F1000",
            values: [
              ["id", "name", "duration", "price", "active", "imageId"],
              ...config.menus.map((m) => [
                m.id,
                m.name,
                m.duration,
                m.price,
                m.active,
                m.imageId || "",
              ]),
            ],
          },
          {
            range: "staff!A1:G1000",
            values: [
              ["id", "name", "menuIds", "weekdays", "start", "end", "imageId"],
              ...config.staff.map((p) => [
                p.id,
                p.name,
                JSON.stringify(p.menuIds),
                JSON.stringify(p.weekdays),
                p.start,
                p.end,
                p.imageId || "",
              ]),
            ],
          },
          { range: "pages!A1:B100", values: [["id", "record"], ...config.pages.map(p => [p.id, JSON.stringify(p)])] },
          {
            range: "settings!A1:B100",
            values: [
              ["key", "value"],
              ...Object.entries(config)
                .filter(([k]) => !["menus", "staff"].includes(k))
                .map(([k, v]) => [k, JSON.stringify(k === "pages" ? pageIndex : v)]),
            ],
          },
        ],
      },
    });
    // Clear trailing rows when a menu or staff member has been removed.
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: shop.google.sheetId,
      requestBody: {
        ranges: [
          `menus!A${config.menus.length + 2}:F1000`,
          `staff!A${config.staff.length + 2}:G1000`,
          `pages!A${config.pages.length + 2}:B100`,
        ],
      },
    });
  }
  await Promise.all([
    drive.files.update({
      fileId: shop.google.specId,
      media: { mimeType: "text/markdown", body: Readable.from([doc.spec]) },
    }),
    drive.files.update({
      fileId: shop.google.historyId,
      media: { mimeType: "text/markdown", body: Readable.from([doc.history]) },
    }),
  ]);
  const selectedPage = scope?.kind === "page" ? config.pages.find(p => p.id === scope.pageId) : undefined;
  const previousPage = scope?.kind === "page" ? shop.published?.pages.find(p => p.id === scope.pageId) : undefined;
  // These are one published snapshot, including after a page/part-only release.
  const snapshotPaths = ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json"];
  const generated = scope?.kind === "part"
    ? Object.fromEntries(Object.entries(allGenerated).filter(([path]) => snapshotPaths.includes(path) || [`web/parts/${scope.part}.html`, `web/parts/${scope.part}.json`].includes(path)))
    : scope?.kind === "page" ? Object.fromEntries(Object.entries(allGenerated).filter(([path]) => snapshotPaths.includes(path) || path === "web/pages/index.json" || selectedPage && [ `web/pages/${selectedPage.slug}.html`, `web/pages/${selectedPage.slug}.json` ].includes(path))) : allGenerated;
  shop.google.artifactIds ||= {};
  shop.google.artifactFolders ||= {};
  for (const folder of (scope?.kind === "part" ? ["web", "web/parts"] : scope?.kind === "page" ? ["web", "web/pages"] : ["web", "admin", "web/pages", "web/parts"])) {
    if (!shop.google.artifactFolders[folder])
      shop.google.artifactFolders[folder] = (
        await drive.files.create({
          requestBody: {
            name: folder,
            mimeType: "application/vnd.google-apps.folder",
            parents: [folder.includes("/") ? shop.google.artifactFolders[folder.slice(0, folder.lastIndexOf("/"))] : shop.google.folderId],
          },
          fields: "id",
        })
      ).data.id!;
    await onProgress();
  }
  for (const [path, content] of Object.entries(generated)) {
    const id = shop.google.artifactIds[path];
    const mimeType = path.endsWith(".html")
      ? "text/html"
      : path.endsWith(".svg")
        ? "image/svg+xml"
        : path.endsWith(".json")
          ? "application/json"
          : path.endsWith(".js")
            ? "text/javascript"
          : "text/markdown";
    if (id)
      await drive.files.update({
        fileId: id,
        media: { mimeType, body: Readable.from([content]) },
      });
    else
      shop.google.artifactIds[path] = (
        await drive.files.create({
          requestBody: {
            name: path.split("/").at(-1)!,
            parents: [
              path.includes("/")
                ? shop.google.artifactFolders[path.slice(0, path.lastIndexOf("/"))]
                : shop.google.folderId,
            ],
          },
          media: { mimeType, body: Readable.from([content]) },
          fields: "id",
        })
      ).data.id!;
    await onProgress();
  }
  for (const [path, id] of Object.entries(shop.google.artifactIds)) {
    if (scope?.kind !== "part" && path.startsWith("web/pages/") && !(path in allGenerated) && (scope?.kind !== "page" || previousPage && [ `web/pages/${previousPage.slug}.html`, `web/pages/${previousPage.slug}.json` ].includes(path))) {
      await drive.files.update({ fileId: id, requestBody: { trashed: true } });
      delete shop.google.artifactIds[path];
      await onProgress();
    }
  }
}
export async function readConfig(
  shop: Shop,
  token: string,
): Promise<ShopConfig> {
  const { sheets } = clients(token);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: shop.google!.sheetId,
    ranges: ["menus!A:F", "staff!A:G", "settings!A:B", "pages!A:B"],
  });
  for (let i = 0; i < headers.length; i++)
    if (
      JSON.stringify(res.data.valueRanges?.[i]?.values?.[0]) !==
      JSON.stringify(headers[i]) && !(i === 1 && JSON.stringify(res.data.valueRanges?.[i]?.values?.[0]) === JSON.stringify(headers[1].slice(0,6)))
    )
      throw Object.assign(
        new Error(
          "スプレッドシートの列構造が変更されています。schema.md の列順に戻してください。",
        ),
        { status: 409 },
      );
  const [menus, staff, settings, pages] = res.data.valueRanges!.map((r) =>
    (r.values || []).slice(1).filter((r) => r[0]),
  );
  const config = {
    ...Object.fromEntries(
      settings.map((r) => [r[0], JSON.parse(String(r[1]))]),
    ),
    pages: pages.map(r => { const page = JSON.parse(String(r[1])); if (page.id !== String(r[0])) throw new Error("ページのIDと行が一致しません"); return page; }),
    menus: menus.map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      duration: Number(r[2]),
      price: Number(r[3]),
      active: String(r[4]).toLowerCase() === "true",
      ...(r[5] ? { imageId: String(r[5]) } : {}),
    })),
    staff: staff.map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      menuIds: JSON.parse(String(r[2])),
      weekdays: JSON.parse(String(r[3])),
      start: String(r[4]),
      end: String(r[5]),
      ...(r[6] ? { imageId: String(r[6]) } : {}),
    })),
  };
  return shopSchema.parse(config);
}
export async function sendMail(
  token: string,
  to: string,
  subject: string,
  body: string,
) {
  if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(to))
    throw new Error("メール宛先が不正です");
  const { gmail } = clients(token);
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString("base64")}`,
  ).toString("base64url");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

export async function syncPostFiles(
  shop: Shop,
  posts: import("./post-domain.ts").Post[],
  token: string,
  onProgress: () => void | Promise<void>,
  readMenuImages?: (config: ShopConfig) => Promise<Record<string, import("./menu-image-domain.ts").MenuImageData>>,
) {
  if (!shop.google || !shop.published) return;
  const { postArtifacts } = await import("./post-renderer.tsx");
  const { drive } = clients(token);
  const config = await readConfig(shop, token);
  const files = postArtifacts(
    config,
    posts,
    await readFile("dist/index.html", "utf8"),
    readMenuImages ? await readMenuImages(config) : undefined,
  );
  const connection = shop.google;
  connection.artifactFolders ||= {};
  connection.artifactIds ||= {};
  async function folder(path: string): Promise<string> {
    if (connection.artifactFolders![path])
      return connection.artifactFolders![path];
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = parts.length
      ? await folder(parts.join("/"))
      : connection.folderId;
    const result = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parent],
      },
      fields: "id",
    });
    const id = result.data.id!;
    connection.artifactFolders![path] = id;
    await onProgress();
    return id;
  }
  async function move(fileId: string, parent: string) {
    const current =
      (await drive.files.get({ fileId, fields: "parents" })).data.parents || [];
    if (current.length !== 1 || current[0] !== parent)
      await drive.files.update({
        fileId,
        addParents: parent,
        removeParents:
          current.filter((p) => p !== parent).join(",") || undefined,
      });
  }
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = await folder(parts.join("/"));
    const mimeType = path.endsWith(".html")
      ? "text/html"
      : path.endsWith(".md")
        ? "text/markdown"
        : path.endsWith(".js")
          ? "text/javascript"
        : "application/json";
    const fileId = connection.artifactIds[path];
    if (fileId) {
      await move(fileId, parent);
      await drive.files.update({
        fileId,
        media: { mimeType, body: Readable.from([content]) },
      });
    } else {
      connection.artifactIds[path] = (
        await drive.files.create({
          requestBody: { name, parents: [parent] },
          media: { mimeType, body: Readable.from([content]) },
          fields: "id",
        })
      ).data.id!;
      await onProgress();
    }
  }
  for (const [path, fileId] of Object.entries(connection.artifactIds))
    if (
      /^web\/(blogs|announcements)\/\d{4}-\d{2}-\d{2}-.+\.html$/.test(path) &&
      !(path in files)
    )
      await move(fileId, await folder("admin/posts/unpublished"));
  const doc = documents(config, shop.history);
  await Promise.all([
    drive.files.update({
      fileId: connection.specId,
      media: { mimeType: "text/markdown", body: Readable.from([doc.spec]) },
    }),
    drive.files.update({
      fileId: connection.historyId,
      media: { mimeType: "text/markdown", body: Readable.from([doc.history]) },
    }),
  ]);
  await onProgress();
}
