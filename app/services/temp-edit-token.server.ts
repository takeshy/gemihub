import crypto from "node:crypto";

const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-secret-change-in-production";

export interface TempEditTokenData {
  accessToken: string;
  rootFolderId: string;
  fileId: string;
  fileName: string;
  createdAt: string; // ISO 8601
}

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptTempEditToken(data: TempEditTokenData): string {
  const key = deriveKey(SESSION_SECRET);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // base64url for URL-safe embedding
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptTempEditToken(token: string): TempEditTokenData {
  const key = deriveKey(SESSION_SECRET);
  const buf = Buffer.from(token, "base64url");
  if (buf.length < 29) throw new Error("Invalid token");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(decipher.update(ciphertext) + decipher.final("utf8"));
}
