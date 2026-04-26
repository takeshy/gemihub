import type { HubworkAccount, ResolvedAccountTokens } from "~/types/hubwork";
import { isHubworkFeatureAvailable } from "~/types/hubwork";
import { getAccountByDomain, getAccountByDefaultDomain, getAccountBySlug, getTokensForAccount } from "./hubwork-accounts.server";

// In-memory cache: domain → account (60s TTL, max 1000 entries)
const domainCache = new Map<string, { account: HubworkAccount; expiresAt: number }>();
// Negative cache: domains with no account (avoids repeated Firestore queries for IDE domains)
const notFoundCache = new Map<string, number>(); // domain → expiresAt
const CACHE_TTL_MS = 60 * 1000;
const CACHE_MAX_SIZE = 1000;

export function extractAllowedSlugHost(domain: string): string | null {
  if (domain.endsWith(".gemihub.net")) {
    return domain.slice(0, -".gemihub.net".length);
  }
  if (domain.endsWith(".localhost")) {
    return domain.slice(0, -".localhost".length);
  }
  return null;
}

/**
 * Resolve a Hubwork account from the request's Host header.
 * Two-tier resolution: try customDomain first, then defaultDomain.
 * Throws 404 if no account matches the domain.
 */
export async function resolveHubworkAccount(
  request: Request
): Promise<HubworkAccount> {
  const host = request.headers.get("host");
  if (!host) {
    throw new Response("Missing Host header", { status: 400 });
  }

  // Strip port if present
  const domain = host.split(":")[0];

  // Check cache
  const cached = domainCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.account;
  }

  // Check negative cache (domains with no account)
  const notFoundExpiry = notFoundCache.get(domain);
  if (notFoundExpiry && notFoundExpiry > Date.now()) {
    throw new Response("Not Found", { status: 404 });
  }

  // Three-tier lookup: customDomain → defaultDomain → slug from subdomain
  let account = await getAccountByDomain(domain);
  if (!account) {
    account = await getAccountByDefaultDomain(domain);
  }
  // Fallback: allow slug-based routing only on explicitly supported suffixes.
  if (!account) {
    const slug = extractAllowedSlugHost(domain);
    if (slug) {
      account = await getAccountBySlug(slug);
    }
  }

  if (!account || !account.plan || !isHubworkFeatureAvailable(account)) {
    // Cache negative result
    if (notFoundCache.size >= CACHE_MAX_SIZE) {
      const firstKey = notFoundCache.keys().next().value;
      if (firstKey) notFoundCache.delete(firstKey);
    }
    notFoundCache.set(domain, Date.now() + CACHE_TTL_MS);
    throw new Response("Not Found", { status: 404 });
  }

  // Evict oldest entries if cache is full
  if (domainCache.size >= CACHE_MAX_SIZE) {
    const firstKey = domainCache.keys().next().value;
    if (firstKey) domainCache.delete(firstKey);
  }
  domainCache.set(domain, { account, expiresAt: Date.now() + CACHE_TTL_MS });
  return account;
}

/**
 * Resolve account and get valid access tokens in one call.
 */
export async function resolveAccountWithTokens(
  request: Request
): Promise<{ account: HubworkAccount; tokens: ResolvedAccountTokens }> {
  const account = await resolveHubworkAccount(request);
  const tokens = await getTokensForAccount(account);
  return { account, tokens };
}
