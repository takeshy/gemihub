import assert from "node:assert/strict";
import test from "node:test";

/**
 * checkRateLimit is the primitive used by /api/workflow/http-fetch to apply
 * per-plan limits (2/min free, 60/min Premium). The production guard means
 * we need NODE_ENV=production for it to do anything; restore afterward so
 * other tests don't observe the override.
 *
 * Module-level Map state persists across tests, so each case uses a unique
 * key prefix to stay independent.
 */

const originalNodeEnv = process.env.NODE_ENV;

test.before(() => {
  process.env.NODE_ENV = "production";
});

test.after(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

async function loadRateLimiter() {
  const mod = await import("./hubwork-rate-limiter.server");
  return mod.checkRateLimit;
}

test("checkRateLimit: free-plan cap of 2/min allows first 2 and blocks the 3rd", async () => {
  const checkRateLimit = await loadRateLimiter();
  const key = "test:free:" + Math.random();
  const WINDOW_MS = 60_000;
  const FREE_MAX = 2;

  assert.equal(checkRateLimit(key, FREE_MAX, WINDOW_MS), true);
  assert.equal(checkRateLimit(key, FREE_MAX, WINDOW_MS), true);
  assert.equal(checkRateLimit(key, FREE_MAX, WINDOW_MS), false);
  assert.equal(checkRateLimit(key, FREE_MAX, WINDOW_MS), false);
});

test("checkRateLimit: Premium cap of 60/min admits 60 requests and blocks the 61st", async () => {
  const checkRateLimit = await loadRateLimiter();
  const key = "test:premium:" + Math.random();
  const WINDOW_MS = 60_000;
  const PREMIUM_MAX = 60;

  for (let i = 0; i < PREMIUM_MAX; i++) {
    assert.equal(
      checkRateLimit(key, PREMIUM_MAX, WINDOW_MS),
      true,
      `request ${i + 1} should succeed under 60/min cap`,
    );
  }
  assert.equal(checkRateLimit(key, PREMIUM_MAX, WINDOW_MS), false);
});

test("checkRateLimit: keys are independent — a free user hitting the cap does not block Premium", async () => {
  const checkRateLimit = await loadRateLimiter();
  const suffix = String(Math.random());
  const freeKey = "test:free-iso:" + suffix;
  const premiumKey = "test:premium-iso:" + suffix;
  const WINDOW_MS = 60_000;

  assert.equal(checkRateLimit(freeKey, 2, WINDOW_MS), true);
  assert.equal(checkRateLimit(freeKey, 2, WINDOW_MS), true);
  assert.equal(checkRateLimit(freeKey, 2, WINDOW_MS), false);

  for (let i = 0; i < 60; i++) {
    assert.equal(checkRateLimit(premiumKey, 60, WINDOW_MS), true);
  }
  assert.equal(checkRateLimit(premiumKey, 60, WINDOW_MS), false);
});

test("checkRateLimit: timestamps outside the window are dropped so fresh requests succeed", async () => {
  const checkRateLimit = await loadRateLimiter();
  const key = "test:sliding:" + Math.random();
  const SHORT_WINDOW_MS = 50;
  const MAX = 2;

  assert.equal(checkRateLimit(key, MAX, SHORT_WINDOW_MS), true);
  assert.equal(checkRateLimit(key, MAX, SHORT_WINDOW_MS), true);
  assert.equal(checkRateLimit(key, MAX, SHORT_WINDOW_MS), false);

  await new Promise((resolve) => setTimeout(resolve, SHORT_WINDOW_MS + 20));

  // Previous timestamps have aged out; the window is empty again.
  assert.equal(checkRateLimit(key, MAX, SHORT_WINDOW_MS), true);
  assert.equal(checkRateLimit(key, MAX, SHORT_WINDOW_MS), true);
  assert.equal(checkRateLimit(key, MAX, SHORT_WINDOW_MS), false);
});
