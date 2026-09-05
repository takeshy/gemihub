/**
 * In-memory cache for the decrypted Gemini API key.
 *
 * The key is decrypted from settings.encryptedApiKey once (password prompt)
 * and stored in the server session; the browser keeps a copy in memory for
 * free-plan chat and local workflow execution. `ensureCachedApiKey` refills
 * that copy from the session after a reload, so the password is asked once
 * per session rather than once per page load.
 */

let cachedApiKey: string | null = null;
let inflight: Promise<string | null> | null = null;

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

/**
 * The cached key, or the session's key fetched from the server. Returns null
 * when the session holds no key (never unlocked, or locked out), in which
 * case callers fall back to the password prompt. Concurrent callers share one
 * request; a null result is not memoised so an unlock in another tab is
 * picked up by the next call.
 */
export async function ensureCachedApiKey(): Promise<string | null> {
  if (cachedApiKey) return cachedApiKey;
  if (typeof window === "undefined") return null;
  if (!inflight) {
    inflight = (async () => {
      try {
        const response = await fetch("/api/auth/api-key", { cache: "no-store" });
        if (!response.ok) return null;
        const data = (await response.json()) as { apiKey?: string | null };
        if (data.apiKey) {
          setCachedApiKey(data.apiKey);
          return data.apiKey;
        }
        return null;
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}
