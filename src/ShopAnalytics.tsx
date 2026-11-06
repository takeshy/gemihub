import { tr } from "../shared/i18n";
import { ShopAccess, type AccessView } from "./ShopAccess";
import type { AnalyticsUnit } from "../shared/analytics-grouping";

/** Operator-only destination, rendered inside the authenticated management dashboard. */
export function ShopAnalytics({ shopId, initialView = "daily", initialUnit = "day" }: { shopId: string; initialView?: AccessView; initialUnit?: AnalyticsUnit }) {
  return <section className="shop-analytics" aria-label={tr("分析")} style={{ minWidth: 0 }}>
    <h2>{tr("分析")}</h2><ShopAccess key={`${shopId}:${initialView}:${initialUnit}`} shopId={shopId} initialView={initialView} initialUnit={initialUnit} initialOpen />
  </section>;
}
