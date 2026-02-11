/**
 * SSRF defense: validate URLs used for MCP server connections.
 * Blocks private/internal IPs and enforces HTTPS in production.
 */

import { isIP } from "node:net";

const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
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

function isPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);

  if (BLOCKED_HOSTNAMES.has(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return PRIVATE_IPV4_RANGES.some((re) => re.test(normalized));
  }
  if (ipVersion === 6) {
    // Loopback, unique-local (fc00::/7), link-local (fe80::/10)
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return false;
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
