import type { McpAppUiResource } from "~/types/settings";

function safeOrigins(values: string[] | undefined): string[] {
  return (values ?? []).filter((value) =>
    /^https:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d+)?$/i.test(value)
    || /^wss:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value)
  );
}

export function buildMcpAppCsp(resource: McpAppUiResource): string {
  const declared = resource._meta?.ui?.csp;
  const assets = safeOrigins(declared?.resourceDomains ?? declared?.resource_domains);
  const connections = safeOrigins(declared?.connectDomains ?? declared?.connect_domains);
  const frames = safeOrigins(declared?.frameDomains ?? declared?.frame_domains);
  const bases = safeOrigins(declared?.baseUriDomains ?? declared?.base_uri_domains);
  const assetSources = ["data:", "blob:", ...assets].join(" ");

  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${assetSources}`,
    `style-src 'unsafe-inline' ${assetSources}`,
    `img-src ${assetSources}`,
    `font-src ${assetSources}`,
    `media-src ${assetSources}`,
    "worker-src blob:",
    `connect-src ${connections.length ? connections.join(" ") : "'none'"}`,
    `frame-src ${frames.length ? frames.join(" ") : "'none'"}`,
    `base-uri ${bases.length ? bases.join(" ") : "'none'"}`,
    "form-action 'none'",
  ].join("; ");
}

export function applyMcpAppCsp(html: string, resource: McpAppUiResource): string {
  const withoutCsp = html.replace(
    /<meta\b[\s\S]*?>/gi,
    (tag) => /content-security-policy/i.test(tag) ? "" : tag,
  );
  const policy = buildMcpAppCsp(resource)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head\b[^>]*>/i.test(withoutCsp)) {
    return withoutCsp.replace(/<head\b[^>]*>/i, (head) => `${head}${meta}`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${withoutCsp}</body></html>`;
}
