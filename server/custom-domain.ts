import { createHash } from "node:crypto";
import type { DomainConnection } from "../shared/custom-domain.ts";
import type { Shop } from "./store.ts";
export function currentDomainConnection(shop: Pick<Shop, "domain" | "domainToken" | "domainVerified">, connection?: DomainConnection) {
  return connection && shop.domainVerified && shop.domainToken && connection.domain === shop.domain &&
    connection.generation === createHash("sha256").update(shop.domainToken).digest("hex") ? connection : undefined;
}
export function domainReady(shop: Pick<Shop, "domain" | "domainVerified" | "domainManaged">, connection?: DomainConnection) {
  if (!shop.domainVerified) return false;
  const automatic = shop.domainManaged || connection || process.env.CUSTOM_DOMAINS_ENABLED === "true";
  return !automatic || connection?.status === "connected";
}
