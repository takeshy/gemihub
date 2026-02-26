/**
 * In-memory cache for the decrypted Gemini API key.
 * The key is decrypted from settings.encryptedApiKey on first use
 * (via password prompt) and kept in memory for the session.
 */

let cachedApiKey: string | null = null;

export function getCachedApiKey(): string | null {
  return cachedApiKey;
}

export function setCachedApiKey(key: string): void {
  cachedApiKey = key;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("api-key-cached"));
  }
}

export function clearCachedApiKey(): void {
  cachedApiKey = null;
}
