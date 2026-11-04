import { serviceName, googleCallbackPath } from "../shared/brand.ts";
import { origin } from "./auth.ts";
import { tr } from "../shared/i18n.ts";
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
  type ShopConfig,
  type Booking,
} from "./domain.ts";
import type { ReleaseScope } from "./pages.ts";
import type { Shop } from "./store.ts";
export function oauth() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    new URL(googleCallbackPath, origin()).href,
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
    gmail: google.gmail({ version: "v1", auth }),
  };
}
/** Creates a Drive folder. Judge shops nest their folders under the operator's judge root. */
export async function createFolder(token: string, name: string, parent?: string) {
  const { drive } = clients(token);
  const folder = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) },
    fields: "id",
  });
  return folder.data.id!;
}
/** Reads a text file the app wrote to Drive, such as spec.md or history.md. */
export async function readDriveText(token: string, id: string) {
  const { drive } = clients(token);
  const response = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "text" });
  return String(response.data ?? "");
}
/** Moves a Drive file or folder, with its contents, to the trash. A missing file is already gone. */
export async function trashFile(token: string, id: string) {
  const { drive } = clients(token);
  try { await drive.files.update({ fileId: id, requestBody: { trashed: true }, fields: "id" }); }
  catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
}
export async function provision(shop: Shop, config: ShopConfig, token: string, parent?: string) {
  const { drive } = clients(token);
  if (shop.google) return shop.google;
  const folder = await drive.files.create({
    requestBody: {
      name: `${config.name} — ${serviceName}`,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
    },
    fields: "id",
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
    folderId: folder.data.id!,
    specId: await make("spec.md"),
    historyId: await make("history.md"),
  };
}
export async function syncShopDocuments(shop: Shop, config: ShopConfig, token: string) {
  if (!shop.google) throw new Error(tr("Google の保存先が未作成です"));
  const { drive } = clients(token);
  const doc = documents(config, shop.history);
  await Promise.all([
    drive.files.update({ fileId: shop.google.specId, media: { mimeType: "text/markdown", body: Readable.from([doc.spec]) } }),
    drive.files.update({ fileId: shop.google.historyId, media: { mimeType: "text/markdown", body: Readable.from([doc.history]) } }),
  ]);
}
export async function syncConfig(
  shop: Shop,
  config: ShopConfig,
  token: string,
  onProgress: () => void | Promise<void> = () => {},
  scope?: ReleaseScope,
  menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>,
) {
  if (!shop.google) throw new Error(tr("Google の保存先が未作成です"));
  const { drive } = clients(token);
  // Prepare the runnable export before writing any remote data.
  const allGenerated = artifacts(config, await readFile("dist/index.html", "utf8"), undefined, menuImages);
  await syncShopDocuments(shop, config, token);
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
export async function sendMail(
  token: string,
  to: string,
  subject: string,
  body: string,
  cc: string[] = [],
) {
  if ([to, ...cc].some(address => !/^[^\s@<>,;\r\n]+@[^\s@<>,;\r\n]+\.[^\s@<>,;\r\n]+$/.test(address)))
    throw new Error(tr("メール宛先が不正です"));
  const seen = new Set([to.toLowerCase()]);
  const copies = cc.filter(address => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const { gmail } = clients(token);
  const raw = Buffer.from(
    `To: ${to}\r\n${copies.length ? `Cc: ${copies.join(", ")}\r\n` : ""}Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString("base64")}`,
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
  const config = shop.published;
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
