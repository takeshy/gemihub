/**
 * Files that plugins must never reach through `PluginAPI.drive`.
 *
 * Plugins run with host privileges, so this is not a sandbox — it is the
 * boundary for the credential material the app deliberately keeps out of the
 * plugin surface:
 *
 * - `settings.json` / `_encrypted-auth.json` carry `encryptedApiKey`,
 *   `encryptedPrivateKey` and the PBKDF2 salt. They are ciphertext, but handing
 *   them to a plugin turns "steal the password" into an offline attack.
 * - `plugins/**` is other plugins' code — writable code is privilege escalation
 *   between plugins.
 * - `_sync-meta.json` is the sync registry; a plugin rewriting it corrupts the
 *   push/pull state machine.
 *
 * The decrypted API key (`api-key-cache.ts`) and private key (`crypto-cache.ts`)
 * are never exposed through `PluginAPI` at all — see `plugin-api.test.ts`.
 */

const DENIED_FILE_NAMES = new Set([
  "settings.json",
  "_sync-meta.json",
  "_encrypted-auth.json",
]);

const DENIED_PREFIXES = ["plugins/"];

/** True when a plugin must not read or write this path. */
export function isPluginDeniedPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const normalized = path.replace(/^\.?\//, "");
  if (DENIED_FILE_NAMES.has(normalized)) return true;
  return DENIED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export class PluginAccessDeniedError extends Error {
  constructor(path: string) {
    super(`Plugin access denied for protected file: ${path}`);
    this.name = "PluginAccessDeniedError";
  }
}

/** Throws when the path is protected; returns it otherwise. */
export function assertPluginPathAllowed(path: string | null | undefined): void {
  if (isPluginDeniedPath(path)) {
    throw new PluginAccessDeniedError(path as string);
  }
}
