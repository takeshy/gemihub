import React, { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "../App";
import { ApiProvider, type ApiClient } from "../api";
import { createMockClient, scenarioProps } from "./mock";
import { getLocale, tr } from "../../shared/i18n";
import type { PayPalAlertState } from "../../server/paypal-ops";

function Example({ initialLanguage = "current" }: { initialLanguage?: "current" | "ja" }) {
  const client = useMemo<ApiClient>(() => {
    const base = createMockClient("owner-paid");
    let alerts: PayPalAlertState = { shopId: "story-shop", checkedAt: "2026-11-05T08:00:00Z", locale: initialLanguage === "ja" ? "ja" : getLocale(), summary: initialLanguage === "ja" ? "対応が必要な項目はありません。" : tr("対応が必要な項目はありません。"), items: [] };
    return (async (path: string, data?: unknown) => {
      if (path.endsWith("/paypal/alerts/check")) {
        alerts = { ...alerts, checkedAt: new Date().toISOString(), locale: getLocale(), summary: tr("対応が必要な項目はありません。") };
        return alerts;
      }
      if (path.endsWith("/assistant")) return {
        answer: getLocale() === "en" ? "Refund EXAMPLE-REFUND is COMPLETED for USD 55.00." : "返金ID EXAMPLE-REFUND は、PayPalで COMPLETED（USD 55.00）です。",
        sources: [{ path: "sheet:paypal", title: tr("PayPalの台帳") }, { path: "paypal:refund:EXAMPLE-REFUND", title: tr("PayPal返金 {0}", "EXAMPLE-REFUND") }],
      };
      const result = await base(path, data);
      if (path === "/api/workspace") {
        const workspace = result as unknown as { shops: { paypalAlerts?: PayPalAlertState }[] };
        for (const shop of workspace.shops) shop.paypalAlerts = alerts;
      }
      return result;
    }) as ApiClient;
  }, [initialLanguage]);
  return <ApiProvider value={client}><App {...scenarioProps("owner-paid")} initialTab="assistant" navigate={() => {}} /></ApiProvider>;
}

const meta = { title: "運営/相談・質問/PayPal", component: Example, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { name: "正常・確認日時と結果" };
export const CachedJapanese: Story = { name: "日本語で保存された要約・表示言語に追従", args: { initialLanguage: "ja" } };
