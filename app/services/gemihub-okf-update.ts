import {
  findFileByNameLocal,
  readFileLocal,
  writeFileLocal,
} from "./drive-local";
import {
  compareOkfVersions,
  parseGemihubOkfManifest,
  type GemihubOkfManifest,
} from "./gemihub-okf-manifest";
import type { OkfBundle } from "./okf-loader";

const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;

export interface GemihubOkfUpdateInfo {
  bundle: OkfBundle;
  bundleRoot: string;
  currentVersion: string | null;
  manifest: GemihubOkfManifest;
}

function normalizeRoot(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function joinPath(...parts: string[]): string {
  return parts.map(normalizeRoot).filter(Boolean).join("/");
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof ArrayBuffer
    ? data
    : new Uint8Array(data).buffer;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readInstalledManifest(path: string): Promise<GemihubOkfManifest | null> {
  const file = await findFileByNameLocal(path);
  if (!file) return null;
  try {
    return parseGemihubOkfManifest(JSON.parse(await readFileLocal(file.id)));
  } catch {
    return null;
  }
}

export async function checkGemihubOkfUpdate(
  okfRoot: string,
  bundle: OkfBundle,
): Promise<GemihubOkfUpdateInfo | null> {
  const response = await fetch("/api/okf/gemihub?resource=manifest", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Failed to check the GemiHub OKF version");
  const payload = await response.json() as { available?: boolean; manifest?: unknown };
  if (!payload.available || !payload.manifest) return null;
  const manifest = parseGemihubOkfManifest(payload.manifest);
  const bundleRoot = joinPath(okfRoot, bundle.id);
  const installed = await readInstalledManifest(joinPath(bundleRoot, "manifest.json"));
  if (installed && compareOkfVersions(installed.version, manifest.version) >= 0) return null;
  return {
    bundle,
    bundleRoot,
    currentVersion: installed?.version ?? null,
    manifest,
  };
}

export async function installGemihubOkfUpdate(info: GemihubOkfUpdateInfo): Promise<void> {
  const response = await fetch(
    `/api/okf/gemihub?resource=bundle&version=${encodeURIComponent(info.manifest.version)}`,
    { headers: { Accept: "application/zip" }, cache: "no-store" },
  );
  if (!response.ok) throw new Error("Failed to download the GemiHub OKF bundle");
  const bundleBytes = await response.arrayBuffer();
  const bundleHash = await sha256Hex(bundleBytes);
  if (bundleHash !== info.manifest.sha256) {
    throw new Error("GemiHub OKF bundle checksum mismatch");
  }

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bundleBytes);
  const decodedFiles = new Map<string, string>();
  let totalBytes = 0;
  for (const [path, expectedHash] of Object.entries(info.manifest.files)) {
    const entry = zip.file(path);
    if (!entry || entry.dir) throw new Error(`GemiHub OKF bundle is missing ${path}`);
    const bytes = await entry.async("uint8array");
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("GemiHub OKF bundle is too large");
    if (await sha256Hex(bytes) !== expectedHash) {
      throw new Error(`GemiHub OKF file checksum mismatch: ${path}`);
    }
    decodedFiles.set(path, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  // Write the manifest last: its version means every listed document was
  // verified and staged successfully. Extra user-authored files are preserved.
  for (const [path, content] of decodedFiles) {
    await writeFileLocal(joinPath(info.bundleRoot, path), content);
  }
  await writeFileLocal(
    joinPath(info.bundleRoot, "manifest.json"),
    `${JSON.stringify(info.manifest, null, 2)}\n`,
  );
}
