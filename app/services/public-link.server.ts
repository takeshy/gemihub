/**
 * Signed public file links.
 *
 * `/public/file/:fileId/:fileName` is an unauthenticated proxy: it streams a
 * publicly shared Drive file from the app's own origin. Without a signature it
 * accepts ANY Drive file id, which lets a third party host their own HTML/JS
 * on this origin and reach the IDE's IndexedDB cache and same-origin APIs.
 *
 * The signature is not viewer authentication — it travels in the URL, so
 * anyone holding the link can still open it without signing in. It only proves
 * that GemiHub minted the link for a file its owner published, which is what
 * pins the route to "files in someone's sync meta" instead of "any file id".
 */
import crypto from "node:crypto";

const rawSessionSecret = process.env.SESSION_SECRET;
if (!rawSessionSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET must be set in production");
}
const SIGNING_SECRET = rawSessionSecret || "dev-secret-change-in-production";

/** Query parameter carrying the signature. */
export const PUBLIC_LINK_SIG_PARAM = "s";

/**
 * File extensions that execute script in a top-level browsing context. These
 * are the ones that turn the proxy into same-origin code execution, so an
 * unsigned request for them is refused outright.
 */
const ACTIVE_EXTENSIONS = new Set(["html", "htm", "js", "mjs", "svg"]);

export function isActivePublicExtension(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext !== undefined && ACTIVE_EXTENSIONS.has(ext);
}

/** HMAC over the file id, base64url, truncated to 128 bits. */
export function signPublicFileId(fileId: string): string {
  return crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(`public-file:${fileId}`)
    .digest("base64url")
    .slice(0, 22);
}

export function verifyPublicFileSignature(
  fileId: string,
  signature: string | null | undefined
): boolean {
  if (!signature) return false;
  const expected = signPublicFileId(fileId);
  const provided = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

/**
 * Origin-relative signed path for a published file. Stored in sync meta
 * (`FileSyncMeta.publicPath`) so the client can show and copy the link without
 * a round trip.
 */
export function publicFilePath(fileId: string, fileName: string): string {
  const baseName = fileName.split("/").pop() ?? fileName;
  return `/public/file/${fileId}/${encodeURIComponent(baseName)}?${PUBLIC_LINK_SIG_PARAM}=${signPublicFileId(fileId)}`;
}
