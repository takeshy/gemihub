/**
 * SSRF defense: validate URLs used for MCP server connections.
 * Blocks private/internal IPs and enforces HTTPS in production.
 */

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^fd/,
  /^fe80:/,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "169.254.169.254",
]);

function isPrivateHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true;
  return PRIVATE_IP_RANGES.some((re) => re.test(hostname));
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
