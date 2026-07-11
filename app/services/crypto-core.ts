// Hybrid encryption utilities using Web Crypto API
// Ported from obsidian-gemini-helper
// This module is shared between client and server (no .server.ts suffix)

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/**
 * Generate RSA key pair for encryption
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  const publicKeyBuffer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKey: arrayBufferToBase64(publicKeyBuffer),
    privateKey: arrayBufferToBase64(privateKeyBuffer),
  };
}

/**
 * Derive key from password using PBKDF2
 */
async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt private key with password
 */
export async function encryptPrivateKey(
  privateKey: string,
  password: string
): Promise<{ encryptedPrivateKey: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedKey = await deriveKeyFromPassword(password, salt);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    encoder.encode(privateKey)
  );

  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);

  return {
    encryptedPrivateKey: arrayBufferToBase64(combined.buffer as ArrayBuffer),
    salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
  };
}

/**
 * Decrypt private key with password
 */
export async function decryptPrivateKey(
  encryptedPrivateKey: string,
  salt: string,
  password: string
): Promise<string> {
  const saltBuffer = base64ToArrayBuffer(salt);
  const derivedKey = await deriveKeyFromPassword(password, new Uint8Array(saltBuffer));

  const combined = new Uint8Array(base64ToArrayBuffer(encryptedPrivateKey));
  const iv = combined.slice(0, 12);
  const encryptedData = combined.slice(12);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Encrypt data with public key (hybrid encryption: AES-GCM + RSA-OAEP)
 */
export async function encryptData(data: string, publicKeyBase64: string): Promise<string> {
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encryptedDataBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(data)
  );

  const aesKeyBuffer = await crypto.subtle.exportKey("raw", aesKey);

  const publicKeyBuffer = base64ToArrayBuffer(publicKeyBase64);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );

  const encryptedAesKeyBuffer = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    aesKeyBuffer
  );

  const encryptedAesKey = new Uint8Array(encryptedAesKeyBuffer);
  const encryptedDataArr = new Uint8Array(encryptedDataBuffer);

  const result = new Uint8Array(2 + encryptedAesKey.length + iv.length + encryptedDataArr.length);
  const keyLength = encryptedAesKey.length;
  result[0] = (keyLength >> 8) & 0xff;
  result[1] = keyLength & 0xff;
  result.set(encryptedAesKey, 2);
  result.set(iv, 2 + encryptedAesKey.length);
  result.set(encryptedDataArr, 2 + encryptedAesKey.length + iv.length);

  return arrayBufferToBase64(result.buffer as ArrayBuffer);
}

/**
 * Decrypt data with private key (hybrid decryption)
 */
export async function decryptData(
  encryptedDataBase64: string,
  privateKeyBase64: string
): Promise<string> {
  const combined = new Uint8Array(base64ToArrayBuffer(encryptedDataBase64));

  const keyLength = (combined[0] << 8) | combined[1];
  const encryptedAesKey = combined.slice(2, 2 + keyLength);
  const iv = combined.slice(2 + keyLength, 2 + keyLength + 12);
  const encryptedData = combined.slice(2 + keyLength + 12);

  const privateKeyBuffer = base64ToArrayBuffer(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );

  const aesKeyBuffer = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    encryptedAesKey
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Verify password by attempting to decrypt private key
 */
export async function verifyPassword(
  encryptedPrivateKey: string,
  salt: string,
  password: string
): Promise<boolean> {
  try {
    await decryptPrivateKey(encryptedPrivateKey, salt, password);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap encrypted data with YAML frontmatter format
 */
export interface EncryptedFileMetadata {
  /** Searchable metadata. Stored outside the ciphertext, like the file name. */
  description?: string;
  publicMetadata?: Record<string, string>;
}

function descriptionLine(description: string): string {
  return `description: ${JSON.stringify(description)}`;
}

function normalizePublicMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (
      !normalizedKey ||
      typeof entryValue !== "string" ||
      ["description", "__proto__", "prototype", "constructor"].includes(normalizedKey)
    ) continue;
    result[normalizedKey] = entryValue;
  }
  return result;
}

function publicMetadataLine(metadata: Record<string, string>): string {
  return `publicMetadata: ${JSON.stringify(metadata)}`;
}

function parseDescription(frontmatter: string): string {
  const match = frontmatter.match(/^description:\s*(.*)$/m);
  if (!match) return "";
  const raw = match[1].trim();
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    // Accept manually-authored, unquoted descriptions for compatibility.
    return raw;
  }
}

function parsePublicMetadata(frontmatter: string): Record<string, string> {
  const match = frontmatter.match(/^publicMetadata:\s*(.*)$/m);
  if (!match) return {};
  try {
    return normalizePublicMetadata(JSON.parse(match[1].trim()));
  } catch {
    return {};
  }
}

export function wrapEncryptedFile(
  data: string,
  key: string,
  salt: string,
  metadata: EncryptedFileMetadata = {},
): string {
  const description = metadata.description?.trim() ?? "";
  const descriptionField = description ? `${descriptionLine(description)}\n` : "";
  const publicMetadata = normalizePublicMetadata(metadata.publicMetadata);
  const publicMetadataField = Object.keys(publicMetadata).length > 0
    ? `${publicMetadataLine(publicMetadata)}\n`
    : "";
  return `---\nencrypted: true\n${descriptionField}${publicMetadataField}key: ${key}\nsalt: ${salt}\n---\n${data}`;
}

/**
 * Extract encryption info from YAML frontmatter format
 * Handles both \n and \r\n line endings
 */
export function unwrapEncryptedFile(content: string): {
  data: string;
  key: string;
  salt: string;
  description: string;
  publicMetadata: Record<string, string>;
} | null {
  // Normalize line endings to \n for reliable parsing
  const normalized = content.replace(/\r\n/g, "\n");
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatter) return null;

  const keyMatch = frontmatter[1].match(/key:\s*(.+)/);
  const saltMatch = frontmatter[1].match(/salt:\s*(.+)/);
  if (!keyMatch || !saltMatch) return null;

  return {
    key: keyMatch[1].trim(),
    salt: saltMatch[1].trim(),
    data: frontmatter[2].trim(),
    description: parseDescription(frontmatter[1]),
    publicMetadata: parsePublicMetadata(frontmatter[1]),
  };
}

export function getEncryptedFileMetadata(content: string): EncryptedFileMetadata {
  const parsed = unwrapEncryptedFile(content);
  return parsed
    ? { description: parsed.description, publicMetadata: parsed.publicMetadata }
    : {};
}

export function getEncryptedFileDescription(content: string): string {
  return unwrapEncryptedFile(content)?.description ?? "";
}

/** Update searchable metadata without decrypting or changing the ciphertext. */
export function setEncryptedFileMetadata(content: string, metadata: EncryptedFileMetadata): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match || !/^encrypted:\s*true\s*$/m.test(match[1])) {
    throw new Error("Invalid encrypted file format");
  }

  const lines = match[1].split("\n").filter((line) =>
    !/^description\s*:/.test(line) && !/^publicMetadata\s*:/.test(line)
  );
  const additions: string[] = [];
  const description = metadata.description?.trim() ?? "";
  if (description) additions.push(descriptionLine(description));
  const publicMetadata = normalizePublicMetadata(metadata.publicMetadata);
  if (Object.keys(publicMetadata).length > 0) additions.push(publicMetadataLine(publicMetadata));
  const encryptedIndex = lines.findIndex((line) => /^encrypted\s*:/.test(line));
  lines.splice(encryptedIndex + 1, 0, ...additions);
  return `---\n${lines.join("\n")}\n---\n${match[2]}`;
}

export function setEncryptedFileDescription(content: string, description: string): string {
  const metadata = getEncryptedFileMetadata(content);
  return setEncryptedFileMetadata(content, { ...metadata, description });
}

/**
 * Encrypt file content and wrap with YAML frontmatter.
 * Skips if content is already encrypted to prevent double-encryption.
 */
export async function encryptFileContent(
  content: string,
  publicKey: string,
  encryptedPrivateKey: string,
  salt: string,
  metadata: EncryptedFileMetadata = {},
): Promise<string> {
  if (isEncryptedFile(content)) {
    return content;
  }
  const encryptedData = await encryptData(content, publicKey);
  return wrapEncryptedFile(encryptedData, encryptedPrivateKey, salt, metadata);
}

/**
 * Decrypt file content from YAML frontmatter format
 */
export async function decryptFileContent(
  fileContent: string,
  password: string
): Promise<string> {
  const encrypted = unwrapEncryptedFile(fileContent);
  if (!encrypted) {
    throw new Error("Invalid encrypted file format");
  }

  const privateKey = await decryptPrivateKey(encrypted.key, encrypted.salt, password);
  return decryptData(encrypted.data, privateKey);
}

/**
 * Decrypt file content using an already-decrypted private key.
 * Unlike decryptFileContent(), this does NOT require a password — it uses the raw private key directly.
 */
export async function decryptWithPrivateKey(
  fileContent: string,
  privateKeyBase64: string
): Promise<string> {
  const encrypted = unwrapEncryptedFile(fileContent);
  if (!encrypted) throw new Error("Invalid encrypted file format");
  return decryptData(encrypted.data, privateKeyBase64);
}

/**
 * Check if file content is an encrypted file (has encrypted YAML frontmatter)
 * Handles both \n and \r\n line endings
 */
export function isEncryptedFile(content: string): boolean {
  return /^---\r?\nencrypted:\s*true/.test(content);
}
