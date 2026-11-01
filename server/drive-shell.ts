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

// Only the Drive export gets embedded code. The served build shell stays intact.
export function inlineDriveShell(shell: string, readAsset: ReadBuildAsset = readBuildAsset) {
  const attribute = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const localAsset = (path: string) => {
    if (!/^\/?assets\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.split("/").includes("..")) throw new Error(tr("Driveに同梱できないビルドファイルです: {0}", path));
    return readAsset(path);
  };
  return shell
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, tag => {
      const opening = tag.slice(0, tag.indexOf(">") + 1);
      const src = attribute(opening, "src");
      if (!src) return tag;
      const module = attribute(opening, "type") === "module";
      return `<script${module ? ' type="module"' : ""}>${localAsset(src).replace(/<\/script/gi, "<\\/script")}</script>`;
    })
    .replace(/<link\b[^>]*>/gi, tag => {
      const rel = attribute(tag, "rel");
      const href = attribute(tag, "href");
      if (rel === "modulepreload") return "";
      if (rel !== "stylesheet" || !href) return tag;
      return `<style>${localAsset(href).replace(/<\/style/gi, "<\\/style")}</style>`;
    });
}
