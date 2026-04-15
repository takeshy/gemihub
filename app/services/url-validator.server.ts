/**
 * SSRF defense: validate URLs used for MCP server connections.
 * Blocks private/internal IPs and enforces HTTPS in production.
 */

import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";

const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,           // CGNAT 100.64.0.0/10
  /^(22[4-9]|23\d|2[4-5]\d)\./,                          // multicast + reserved 224-255
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

function normalizeHostname(hostname: string): string {
  const withoutBrackets = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return withoutBrackets.toLowerCase().replace(/\.$/, "");
}

function parseIpv4MappedIpv6(hostname: string): string | null {
  let suffix = "";
  if (hostname.startsWith("::ffff:")) {
    suffix = hostname.slice("::ffff:".length);
  } else if (hostname.startsWith("0:0:0:0:0:ffff:")) {
    suffix = hostname.slice("0:0:0:0:0:ffff:".length);
  } else {
    return null;
  }

  // Common dotted-decimal notation: ::ffff:127.0.0.1
  if (suffix.includes(".")) {
    return suffix;
  }

  // Hex notation from URL parser: ::ffff:7f00:1
  const parts = suffix.split(":").filter(Boolean);
  let value: number | null = null;

  if (parts.length === 2) {
    const hi = Number.parseInt(parts[0], 16);
    const lo = Number.parseInt(parts[1], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      value = ((hi & 0xffff) << 16) | (lo & 0xffff);
    }
  } else if (parts.length === 1) {
    const parsed = Number.parseInt(parts[0], 16);
    if (Number.isFinite(parsed)) {
      value = parsed >>> 0;
    }
  }

  if (value === null) return null;

  const a = (value >>> 24) & 0xff;
  const b = (value >>> 16) & 0xff;
  const c = (value >>> 8) & 0xff;
  const d = value & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (BLOCKED_HOSTNAMES.has(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return PRIVATE_IPV4_RANGES.some((re) => re.test(normalized));
  }
  if (ipVersion === 6) {
    const mappedIpv4 = parseIpv4MappedIpv6(normalized);
    if (mappedIpv4) {
      if (BLOCKED_HOSTNAMES.has(mappedIpv4)) return true;
      return PRIVATE_IPV4_RANGES.some((re) => re.test(mappedIpv4));
    }

    // Loopback, unique-local (fc00::/7), link-local (fe80::/10), multicast (ff00::/8)
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized === "::0" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  }

  return false;
}

/**
 * Signals that DNS resolution failed (ENOTFOUND / EAI_AGAIN / etc.).
 * Distinct from SSRF block errors so callers can return an upstream-style
 * 502 rather than misreporting resolve failures as policy rejections.
 */
export class DnsLookupError extends Error {
  readonly code: string;
  constructor(hostname: string, code: string) {
    super(`DNS lookup failed for ${hostname}: ${code}`);
    this.name = "DnsLookupError";
    this.code = code;
  }
}

/**
 * Resolve a hostname and throw if it is an IP literal in a blocked range,
 * a known blocked name, or resolves to a blocked IP via A/AAAA lookup.
 * A DNS-rebinding window remains because fetch() re-resolves.
 * Throws `DnsLookupError` on resolve failure (not a policy violation).
 */
export async function assertSafeFetchHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateHost(hostname)) throw new Error(`blocked IP literal ${hostname}`);
    return;
  }
  if (isPrivateHost(hostname)) throw new Error(`blocked hostname ${hostname}`);
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
      throw new DnsLookupError(hostname, err.code);
    }
    throw err;
  }
  for (const { address } of addresses) {
    if (isPrivateHost(address)) {
      throw new Error(`host ${hostname} resolves to blocked IP ${address}`);
    }
  }
}

/**
 * Validate a URL intended for MCP server communication.
 * Throws if the URL is invalid, points to a private IP (production only),
 * or uses HTTP in production.
 * Private/localhost hosts are allowed in development for local MCP servers.
 */
export function validateMcpServerUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid MCP server URL: ${url}`);
  }

  if (process.env.NODE_ENV === "production") {
    // Block private/internal hosts in production to prevent SSRF
    if (isPrivateHost(parsed.hostname)) {
      throw new Error(
        `MCP server URL points to a private/internal address: ${parsed.hostname}`
      );
    }

    // Enforce HTTPS in production
    if (parsed.protocol !== "https:") {
      throw new Error("MCP server URL must use HTTPS in production");
    }
  }
}
