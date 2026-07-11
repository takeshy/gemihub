import { Storage } from "@google-cloud/storage";
import {
  isSafeOkfRelativePath,
  parseGemihubOkfManifest,
  type GemihubOkfManifest,
} from "./gemihub-okf-manifest";

const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const storage = new Storage();

function configuredBucket(): { bucket: string; prefix: string } | null {
  const bucket = process.env.GEMIHUB_OKF_BUCKET?.trim();
  if (!bucket) return null;
  const prefix = process.env.GEMIHUB_OKF_PREFIX?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return { bucket, prefix };
}

function objectName(prefix: string, relativePath: string): string {
  if (!isSafeOkfRelativePath(relativePath)) throw new Error("Invalid GemiHub OKF object path");
  return prefix ? `${prefix}/${relativePath}` : relativePath;
}

async function downloadBucketObject(bucket: string, name: string, maxBytes: number): Promise<Buffer> {
  const file = storage.bucket(bucket).file(name);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size ?? 0) > maxBytes) throw new Error("GemiHub OKF object is too large");
  const [content] = await file.download();
  if (content.byteLength > maxBytes) throw new Error("GemiHub OKF object is too large");
  return content;
}

function configuredBaseUrl(): URL | null {
  const value = process.env.GEMIHUB_OKF_BASE_URL?.trim();
  if (!value) return null;
  const normalized = value.endsWith("/") ? value : `${value}/`;
  const url = new URL(normalized);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
    throw new Error("GEMIHUB_OKF_BASE_URL must use HTTPS");
  }
  return url;
}

function resolveBundleUrl(baseUrl: URL, bundleUrl: string): URL {
  const resolved = new URL(bundleUrl, baseUrl);
  if (resolved.origin !== baseUrl.origin || !resolved.pathname.startsWith(baseUrl.pathname)) {
    throw new Error("GemiHub OKF bundle URL must stay under its configured base URL");
  }
  return resolved;
}

export async function fetchGemihubOkfManifest(): Promise<GemihubOkfManifest | null> {
  const bucketConfig = configuredBucket();
  if (bucketConfig) {
    const content = await downloadBucketObject(
      bucketConfig.bucket,
      objectName(bucketConfig.prefix, "manifest.json"),
      1024 * 1024,
    );
    return parseGemihubOkfManifest(JSON.parse(content.toString("utf8")));
  }
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) return null;
  const response = await fetch(new URL("manifest.json", baseUrl), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GemiHub OKF manifest request failed (${response.status})`);
  return parseGemihubOkfManifest(await response.json());
}

export async function fetchGemihubOkfBundle(manifest: GemihubOkfManifest): Promise<ArrayBuffer> {
  const bucketConfig = configuredBucket();
  if (bucketConfig) {
    const content = await downloadBucketObject(
      bucketConfig.bucket,
      objectName(bucketConfig.prefix, manifest.bundleUrl),
      MAX_BUNDLE_BYTES,
    );
    return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  }
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) throw new Error("GemiHub OKF distribution is not configured");
  const bundleUrl = resolveBundleUrl(baseUrl, manifest.bundleUrl);
  const response = await fetch(bundleUrl, {
    headers: { Accept: "application/zip" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GemiHub OKF bundle request failed (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BUNDLE_BYTES) throw new Error("GemiHub OKF bundle is too large");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error("GemiHub OKF bundle is too large");
  return bytes;
}
