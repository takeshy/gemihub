import { tr } from "../shared/i18n.ts";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

export type ReadBuildAsset = (path: string) => string;
const readBuildAsset: ReadBuildAsset = path => {
  const root = resolve("dist");
  const file = resolve(root, path.replace(/^\//, ""));
  if (!file.startsWith(root + sep) || /[?#]/.test(path)) throw new Error(tr("Drive用のビルドファイルのパスを確認してください"));
  return readFileSync(file, "utf8");
};

// Only the Drive export gets the standalone runtime. The web build can share and lazy-load chunks;
// embedding its entry alone leaves unresolved imports that cannot load from a downloaded HTML file.
export function inlineDriveShell(shell: string, readAsset: ReadBuildAsset = readBuildAsset) {
  const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const localAsset = (path: string) => {
    if (!/^\/?(?:assets\/[a-zA-Z0-9_.\/-]+|drive\/preview\.(?:js|css))$/.test(path) || path.split("/").includes("..")) throw new Error(tr("Driveに同梱できないビルドファイルです: {0}", path));
    return readAsset(path);
  };
  let standalone = false;
  // Insert code after processing HTML tags so template strings inside JS/CSS remain data.
  const embedded: string[] = [];
  const embed = (text: string) => { embedded.push(text); return `\0drive-asset-${embedded.length - 1}\0`; };
  return shell
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, tag => {
      const opening = tag.slice(0, tag.indexOf(">") + 1);
      const src = attribute(opening, "src");
      if (!src) return embed(tag);
      const module = attribute(opening, "type") === "module";
      if (module) {
        // Validate the source even though the web entry is replaced rather than embedded.
        if (!/^\/?assets\/[a-zA-Z0-9_.\/-]+$/.test(src) || src.split("/").includes("..")) throw new Error(tr("Driveに同梱できないビルドファイルです: {0}", src));
        if (standalone) return "";
        standalone = true;
        const css = localAsset("/drive/preview.css").replace(/<\/style/gi, "<\\/style");
        const js = localAsset("/drive/preview.js").replace(/<\/script/gi, "<\\/script");
        return embed(`<style>${css}</style><script type="module">${js}</script>`);
      }
      return embed(`<script>${localAsset(src).replace(/<\/script/gi, "<\\/script")}</script>`);
    })
    .replace(/<link\b[^>]*>/gi, tag => {
      const rel = attribute(tag, "rel");
      const href = attribute(tag, "href");
      if (rel === "modulepreload") return "";
      if (rel === "icon" && href) {
        // The SVG icon stays self-contained when the export is opened from disk.
        return href.endsWith(".svg") ? embed(`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(localAsset(href))}">`) : "";
      }
      if (rel !== "stylesheet" || !href) return tag;
      if (standalone) return "";
      return embed(`<style>${localAsset(href).replace(/<\/style/gi, "<\\/style")}</style>`);
    })
    .replace(/\0drive-asset-(\d+)\0/g, (_match, index: string) => embedded[Number(index)]!);
}
