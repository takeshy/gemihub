import React, { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "../App";
import { ApiProvider, type ApiClient } from "../api";
import { createMockClient, scenarioProps } from "./mock";
import { getLocale, tr } from "../../shared/i18n";
import type { PayPalAlertItem, PayPalAlertState, PayPalProposal } from "../../server/paypal-ops";

type Case = "empty" | "attention";
const ja = () => getLocale() === "ja";

/** Alerts as the hourly check would leave them: one per kind of fix the owner can approve. */
function attentionItems(): PayPalAlertItem[] {
  const hoursAgo = (value: number) => new Date(Date.now() - value * 3600000).toISOString();
  const item = (input: Omit<PayPalAlertItem, "fingerprint" | "proposal"> & { operation?: PayPalProposal["operation"]; targetKind?: PayPalProposal["targetKind"]; targetId?: string; expected: string }): PayPalAlertItem => {
    const { operation, targetKind, targetId, expected, ...rest } = input;
    const fingerprint = `fp-${input.id}`;
    return {
      ...rest, fingerprint,
      ...(operation ? { proposal: {
        id: `proposal-${input.id}`, operation, alertId: input.id, bookingId: input.bookingId, targetId, targetKind,
        target: input.target, amount: input.amount, currency: input.currency, expected, fingerprint,
      } } : {}),
    };
  };
  return [
    item({
      id: "alert-capture", kind: "capture_stalled", severity: "high", bookingId: "b7c41e09-5d2a-4c1e-9b7f-2e8a61c0d4f3", bookingLabel: tr("予約 {0}", "b7c41e09"),
      target: tr("決済（予約 {0}）", "b7c41e09"), amount: 6500, currency: "JPY", paypalId: "5O190127TN364715T", paypalKind: "order",
      since: hoursAgo(0.5), elapsedHours: 0.5, operation: "resync", targetKind: "order", targetId: "5O190127TN364715T",
      expected: tr("PayPalから決済状態を取り直して台帳を更新します。"),
    }),
    item({
      id: "alert-funds", kind: "awaiting_funds", severity: "medium", bookingId: "a3f9d2c1-5d2a-4c1e-9b7f-2e8a61c0d4f3", bookingLabel: tr("予約 {0}", "a3f9d2c1"),
      target: tr("返金 {0}（予約 {1}）", "9c2e41aa", "a3f9d2c1"), amount: 4550, currency: "JPY",
      since: hoursAgo(5.2), elapsedHours: 5.2, operation: "retry_refund", targetKind: "refund", targetId: "9c2e41aa",
      expected: tr("残高を確認してから、同じ返金処理IDで再試行します。"),
    }),
    item({
      id: "alert-review", kind: "manual_review", severity: "high", bookingId: "e81b5f30-5d2a-4c1e-9b7f-2e8a61c0d4f3", bookingLabel: tr("予約 {0}", "e81b5f30"),
      target: tr("返金 {0}（予約 {1}）", "1JU08902781691411", "e81b5f30"), amount: 3250, currency: "JPY", paypalId: "1JU08902781691411", paypalKind: "refund",
      since: hoursAgo(26), elapsedHours: 26, operation: "complete_manual_review", targetKind: "refund", targetId: "1JU08902781691411",
      expected: tr("PayPalで返金が完了していることを確認し、台帳を完了にします。"),
    }),
    item({
      id: "alert-unsold", kind: "unsold_slot", severity: "low", bookingId: "c05d7a62-5d2a-4c1e-9b7f-2e8a61c0d4f3",
      target: tr("割引枠（予約 {0}）", "c05d7a62"), amount: 1950, currency: "JPY",
      since: hoursAgo(-1.5), operation: "close_transfer", targetKind: "transfer", targetId: "transfer-c05d7a62",
      expected: tr("受付を今終了し、キャンセル受付時の返金額で確定します。"),
    }),
  ];
}

const attentionSummary = () => ja()
  ? "要対応は4件です。最優先は予約 b7c41e09 の決済で、PayPalの承認後30分たっても台帳が確定していません。予約 e81b5f30 の返金は手動確認待ちが26時間続いています。予約 a3f9d2c1 の返金は残高不足で止まっており、残高を補充してから再試行してください。割引枠 c05d7a62 は締切まで1時間半で、まだ買い手がいません。"
  : "4 items need attention. Most urgent: the payment for booking b7c41e09 has not been confirmed in the ledger 30 minutes after PayPal approval. The refund for booking e81b5f30 has waited 26 hours for a manual check. The refund for booking a3f9d2c1 is waiting for funds; add funds before retrying. The discounted slot c05d7a62 closes in 1.5 hours with no buyer yet.";

function Example({ initialLanguage = "current", alertsCase = "empty" }: { initialLanguage?: "current" | "ja"; alertsCase?: Case }) {
  const client = useMemo<ApiClient>(() => {
    const base = createMockClient("owner-paid");
    const empty = () => initialLanguage === "ja" ? "対応が必要な項目はありません。" : tr("対応が必要な項目はありません。");
    let items = alertsCase === "attention" ? attentionItems() : [];
    let alerts: PayPalAlertState = {
      shopId: "story-shop", checkedAt: new Date(Date.now() - 20 * 60000).toISOString(),
      locale: initialLanguage === "ja" ? "ja" : getLocale(), summary: items.length ? attentionSummary() : empty(), items,
    };
    const refresh = () => { alerts = { ...alerts, checkedAt: new Date().toISOString(), locale: getLocale(), summary: items.length ? attentionSummary() : tr("対応が必要な項目はありません。"), items }; };
    return (async (path: string, data?: unknown) => {
      if (path.endsWith("/paypal/alerts/check")) { refresh(); return alerts; }
      if (path.endsWith("/paypal/alerts/settings")) return { ok: true };
      if (path.endsWith("/paypal/proposals/execute")) {
        const { alertId } = data as { alertId: string };
        items = items.filter(item => item.id !== alertId);
        refresh();
        return { ok: true, state: alerts };
      }
      if (path.endsWith("/assistant")) {
        const question = String((data as { question?: string })?.question || "");
        const asked = items.find(item => item.bookingId && question.includes(item.bookingId));
        if (asked?.kind === "capture_stalled") return {
          answer: ja()
            ? "予約 b7c41e09 の注文 5O190127TN364715T は、PayPalでは COMPLETED（6,500円）で支払いが確定しています。台帳はまだ「確定処理中」のままで、30分たっても更新されていません。お客様の支払いは済んでいるため、台帳をPayPalの状態に合わせれば予約が確定します。\n\n下の提案を承認すると、サーバーがもう一度PayPalの状態を確認してから台帳を更新します。AIはPayPalを読むだけで、書き込みはしません。"
            : "Order 5O190127TN364715T for booking b7c41e09 is COMPLETED in PayPal (¥6,500), so the customer has paid. The ledger still shows the capture as in progress after 30 minutes. Syncing the ledger with PayPal will confirm the booking.\n\nIf you approve the proposal below, the server checks PayPal again and then updates the ledger. The AI only reads PayPal and never writes to it.",
          sources: [{ path: "sheet:paypal", title: tr("PayPalの台帳") }, { path: "paypal:order:5O190127TN364715T", title: ja() ? "PayPal注文 5O190127TN364715T" : "PayPal order 5O190127TN364715T" }],
          paypalProposals: asked.proposal ? [asked.proposal] : [],
        };
        if (asked) return {
          answer: ja() ? `${asked.target} について、台帳とPayPalの記録を確認しました。下の提案を承認すると、サーバーが状態を再確認してから実行します。` : `I checked the ledger and PayPal for ${asked.target}. If you approve the proposal below, the server re-checks the state before running it.`,
          sources: [{ path: "sheet:paypal", title: tr("PayPalの台帳") }],
          paypalProposals: asked.proposal ? [asked.proposal] : [],
        };
        return {
          answer: getLocale() === "en" ? "Refund EXAMPLE-REFUND is COMPLETED for USD 55.00." : "返金ID EXAMPLE-REFUND は、PayPalで COMPLETED（USD 55.00）です。",
          sources: [{ path: "sheet:paypal", title: tr("PayPalの台帳") }, { path: "paypal:refund:EXAMPLE-REFUND", title: tr("PayPal返金 {0}", "EXAMPLE-REFUND") }],
        };
      }
      const result = await base(path, data);
      if (path === "/api/workspace") {
        const workspace = result as unknown as { shops: { paypalAlerts?: PayPalAlertState }[] };
        for (const shop of workspace.shops) shop.paypalAlerts = alerts;
      }
      return result;
    }) as ApiClient;
  }, [initialLanguage, alertsCase]);
  return <ApiProvider value={client}><App {...scenarioProps("owner-paid")} initialTab="dashboard" navigate={() => {}} /></ApiProvider>;
}

/** Waits for an enabled element, so the play step runs after the workspace has loaded. */
async function find<T extends HTMLElement>(root: HTMLElement, selector: string, match: (element: T) => boolean = () => true) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = [...root.querySelectorAll<T>(selector)].find(element => match(element) && !(element as unknown as HTMLButtonElement).disabled);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`${selector} did not appear`);
}

const meta = { title: "運営/ダッシュボード/PayPal", component: Example, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { name: "正常・確認日時と結果" };
export const CachedJapanese: Story = { name: "日本語で保存された要約・表示言語に追従", args: { initialLanguage: "ja" } };
export const Attention: Story = { name: "要対応と対応提案（承認して実行）", args: { alertsCase: "attention" } };
export const AttentionConsulted: Story = {
  name: "要対応をAIに相談・提案を承認する前",
  args: { alertsCase: "attention" },
  play: async ({ canvasElement }) => {
    (await find<HTMLButtonElement>(canvasElement, ".paypal-alert-list button", button => button.textContent === tr("相談する"))).click();
    await find(canvasElement, ".paypal-proposals");
  },
};
