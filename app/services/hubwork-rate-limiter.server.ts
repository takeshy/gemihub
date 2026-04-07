/**
 * In-memory sliding window rate limiter.
 * Resets on server restart. Suitable for single-instance per-account deployments.
 */
const windows = new Map<string, number[]>();

// Periodic cleanup every 5 minutes to prevent memory leaks from stale keys. unref() allows clean process exit.
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const MAX_WINDOW_MS = 15 * 60 * 1000; // 15 minutes (generous upper bound)
  for (const [key, timestamps] of windows) {
    const fresh = timestamps.filter((t) => t > now - MAX_WINDOW_MS);
    if (fresh.length === 0) {
      windows.delete(key);
    } else {
      windows.set(key, fresh);
    }
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (windows.get(key) || []).filter((t) => t > cutoff);

  if (timestamps.length >= maxRequests) {
    windows.set(key, timestamps);
    return false;
  }

  timestamps.push(now);
  windows.set(key, timestamps);
  return true;
}
