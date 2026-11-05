import { bookingStaff, type ShopConfig } from "../server/domain.ts";
import { policyText } from "../server/payment-domain.ts";
import { articleKinds } from "./article-features.ts";
import { tr } from "./i18n.ts";

/** Settings-derived content shared by the operating screen and exported diagram. */
export function shopInfographic(config: ShopConfig) {
  const payment = config.rules.payment?.enabled ? config.rules.payment : undefined;
  const bookingFlow = [
    { label: tr("ログイン"), detail: tr("メール認証またはGoogleログイン") },
    { label: tr("メニュー・指名・日時"), detail: tr("お客様が選ぶ") },
    { label: tr("空き時間を確認"), detail: tr("勤務と既存予約を照合") },
    ...(payment ? [{ label: tr("PayPalで決済"), detail: tr("有料の予約は全額お支払い") }] : []),
    { label: tr("予約確定"), detail: tr("お客様と店主にメール通知") },
  ];
  const pages = [
    { title: tr("予約"), count: 1 },
    { title: tr("お店のこと"), count: 1 },
    { title: tr("マイページ"), count: 1 },
    { title: tr("お問い合わせ"), count: 1 },
    ...articleKinds(config).map(kind => ({ title: kind === "blogs" ? tr("ブログ一覧・記事") : tr("お知らせ一覧・記事"), count: 2 })),
    ...config.pages.map(page => ({ title: page.title, count: 1 })),
  ];
  return {
    bookingFlow,
    payment: {
      enabled: !!payment,
      summary: payment ? tr("有料の予約はPayPalで全額決済してから確定します。") : tr("予約時のオンライン決済はありません。"),
      cancellation: payment ? tr("キャンセル時は予約時の条件で自動返金します。お店都合は全額返金します。") : tr("お客様のキャンセル：開始{0}時間前まで。自分の予約だけ確認・取消できます。", config.rules.cancelHours),
      policy: payment ? policyText(payment.refundTiers) : undefined,
    },
    staff: bookingStaff(config),
    pages,
    pageCount: pages.reduce((total, page) => total + page.count, 0),
  };
}
