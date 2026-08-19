/**
 * Rate limiting service — Phase 6.
 *
 * Firestore-backed sliding-window rate limiter. Works across Cloud Run
 * instances (unlike an in-memory map).
 *
 * Buckets:
 *   - per-user:   rate_limits/{scope}/{userHash}/users/{uid}
 *   - per-org:    rate_limits/{scope}/{userHash}/orgs/{orgId}
 *
 * Scope examples: "chat", "storage_write", "workflow_execute".
 *
 * Env:
 *   RATE_LIMIT_CHAT_PER_USER      default 60  (requests per window)
 *   RATE_LIMIT_CHAT_WINDOW_SEC    default 60
 *   RATE_LIMIT_STORAGE_PER_USER   default 120
 *   RATE_LIMIT_STORAGE_WINDOW_SEC default 60
 */

import { FieldValue } from "@google-cloud/firestore";
import { getFirestore } from "./firestore.server";

const RATE_LIMITS_COLLECTION = "rate_limits";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
  windowMs: number;
}

interface BucketConfig {
  limit: number;
  windowMs: number;
}

function getConfig(scope: string): BucketConfig {
  switch (scope) {
    case "chat":
      return {
        limit: parseInt(process.env.RATE_LIMIT_CHAT_PER_USER ?? "60", 10),
        windowMs: parseInt(process.env.RATE_LIMIT_CHAT_WINDOW_SEC ?? "60", 10) * 1000,
      };
    case "storage_write":
      return {
        limit: parseInt(process.env.RATE_LIMIT_STORAGE_PER_USER ?? "120", 10),
        windowMs: parseInt(process.env.RATE_LIMIT_STORAGE_WINDOW_SEC ?? "60", 10) * 1000,
      };
    case "workflow_execute":
      return {
        limit: parseInt(process.env.RATE_LIMIT_WORKFLOW_PER_USER ?? "30", 10),
        windowMs: parseInt(process.env.RATE_LIMIT_WORKFLOW_WINDOW_SEC ?? "60", 10) * 1000,
      };
    default:
      return {
        limit: parseInt(process.env.RATE_LIMIT_DEFAULT_PER_USER ?? "120", 10),
        windowMs: parseInt(process.env.RATE_LIMIT_DEFAULT_WINDOW_SEC ?? "60", 10) * 1000,
      };
  }
}

function docRef(scope: string, dimension: "users" | "orgs", key: string) {
  return getFirestore()
    .collection(RATE_LIMITS_COLLECTION)
    .doc(scope)
    .collection(dimension)
    .doc(key);
}

/**
 * Check and increment a rate-limit counter. Returns `allowed: false` when
 * the limit is exceeded.
 *
 * This is intentionally a best-effort limiter: Firestore contention on the
 * same doc is low because the key is per-user + per-scope. If Firestore is
 * down, we allow the request (fail-open) rather than block all traffic.
 */
export async function checkRateLimit(
  scope: string,
  dimension: "users" | "orgs",
  key: string,
): Promise<RateLimitResult> {
  const config = getConfig(scope);
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const resetAt = windowStart + config.windowMs * 2;

  try {
    const ref = docRef(scope, dimension, key);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        count: 1,
        windowStart: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt, windowMs: config.windowMs };
    }

    const data = snap.data() as { count?: number; windowStart?: FirebaseFirestore.Timestamp };
    const existingWindowStart = data.windowStart?.toMillis?.() ?? 0;

    if (existingWindowStart < windowStart) {
      // Window has rolled over — reset counter
      await ref.set({
        count: 1,
        windowStart: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { allowed: true, limit: config.limit, remaining: config.limit - 1, resetAt, windowMs: config.windowMs };
    }

    const currentCount = (data.count ?? 0) + 1;
    if (currentCount > config.limit) {
      return { allowed: false, limit: config.limit, remaining: 0, resetAt, windowMs: config.windowMs };
    }

    await ref.update({
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit - currentCount,
      resetAt,
      windowMs: config.windowMs,
    };
  } catch (err) {
    console.error("[rate-limiter] Firestore error (fail-open):", err instanceof Error ? err.message : String(err));
    // Fail-open: don't block traffic if Firestore is unreachable
    return { allowed: true, limit: config.limit, remaining: config.limit, resetAt, windowMs: config.windowMs };
  }
}

/**
 * Convenience: check per-user rate limit. Returns 429 response JSON when
 * exceeded, or undefined when allowed.
 */
export async function requireRateLimit(
  scope: string,
  uid: string,
): Promise<Response | undefined> {
  const result = await checkRateLimit(scope, "users", uid);
  if (!result.allowed) {
    return Response.json(
      {
        error: "Rate limit exceeded",
        scope,
        limit: result.limit,
        resetAt: result.resetAt,
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        },
      },
    );
  }
  return undefined;
}
