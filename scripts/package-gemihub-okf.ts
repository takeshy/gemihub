import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const SOURCE_DIR = path.resolve("docs");
const OUTPUT_DIR = path.resolve("dist/gemihub-okf");
const LOG_VERSION_RE = /^\s*\*\s+\*\*Version\*\*:\s+`([^`]+)`\s*$/m;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function collectMarkdown(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (prefix === "" && entry.name === "examples") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectMarkdown(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(relativePath);
    }
  }
  return files;
}

const log = await readFile(path.join(SOURCE_DIR, "log.md"), "utf8");
const version = log.match(LOG_VERSION_RE)?.[1]?.trim() ?? "";
if (!SEMVER_RE.test(version)) {
  throw new Error("docs/log.md must contain a '**Version**: x.y.z' item in its latest release entry");
}

const files = await collectMarkdown(SOURCE_DIR);
const zip = new JSZip();
const fileHashes: Record<string, string> = {};
for (const relativePath of files) {
  const content = await readFile(path.join(SOURCE_DIR, relativePath));
  zip.file(relativePath, content);
  fileHashes[relativePath] = sha256(content);
}

const bundle = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});
const releaseDirectory = path.join(OUTPUT_DIR, "releases", version);
await mkdir(releaseDirectory, { recursive: true });
await writeFile(path.join(releaseDirectory, "gemihub-okf.zip"), bundle);

const manifest = {
  name: "GemiHub",
  version,
  publishedAt: new Date().toISOString(),
  bundleUrl: `releases/${version}/gemihub-okf.zip`,
  sha256: sha256(bundle),
  files: Object.fromEntries(Object.entries(fileHashes).sort(([a], [b]) => a.localeCompare(b))),
};
await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(path.join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(`Packaged GemiHub OKF ${version}: ${files.length} files\n`);
