import { ArrowLeft } from "lucide-react";
import { useLocation } from "react-router";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export function headers() {
  return {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400, max-age=3600",
  };
}

export default function Tokushoho() {
  const { pathname } = useLocation();
  const lang: Language = pathname.endsWith("/ja") ? "ja" : "en";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <main className="mx-auto max-w-3xl px-4 py-16">
        <div className="mb-8 flex items-center justify-between">
          <a
            href={lang === "ja" ? "/lp/ja" : "/lp"}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={16} />
            Back
          </a>
          <LanguageSwitcher lang={lang} basePath="/tokushoho" />
        </div>

        {lang === "ja" ? <TokushohoJa /> : <TokushohoEn />}
      </main>
    </div>
  );
}

interface Row {
  label: string;
  value: React.ReactNode;
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <dl>
        {rows.map(({ label, value }, i) => (
          <div
            key={label}
            className={`grid grid-cols-1 gap-2 px-5 py-4 sm:grid-cols-[200px_1fr] sm:gap-6 ${
              i % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-900/60"
            }`}
          >
            <dt className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</dt>
            <dd className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TokushohoJa() {
  const rows: Row[] = [
    { label: "販売事業者", value: "森田 剛志（屋号：takeshy.work）" },
    { label: "運営統括責任者", value: "森田 剛志" },
    { label: "所在地", value: "〒222-0032 神奈川県横浜市港北区大豆戸町964-1 フェンテ大倉山101" },
    { label: "電話番号", value: "050-1792-0976（受付時間：平日10:00〜18:00）" },
    { label: "メールアドレス", value: (
      <a href="mailto:takeshy.work@gmail.com" className="text-blue-600 hover:underline dark:text-blue-400">
        takeshy.work@gmail.com
      </a>
    )},
    { label: "ホームページURL", value: (
      <a href="https://gemihub.online/lp" className="text-blue-600 hover:underline dark:text-blue-400">
        https://gemihub.online/lp
      </a>
    )},
    { label: "販売価格", value: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Free プラン：¥0</li>
        <li>Lite プラン：月額 300円（税込）</li>
        <li>Pro プラン：月額 2,000円（税込）</li>
      </ul>
    )},
    { label: "商品代金以外の必要料金", value: (
      <>
        インターネット接続料金、通信料金等はお客様のご負担となります。<br />
        Gemini API の利用料金はお客様ご自身の Google Cloud アカウントから請求されます（GemiHub は API 利用料を代理請求しません）。
      </>
    )},
    { label: "お支払い方法", value: "クレジットカード決済（Stripe 経由：Visa / Mastercard / American Express / JCB / Diners Club / Discover）" },
    { label: "お支払い時期", value: "初回：ご契約時に即時課金／次回以降：毎月の契約更新日に自動課金" },
    { label: "サービスの提供時期", value: "決済完了後、ただちにご利用いただけます。" },
    { label: "解約・返金について", value: (
      <>
        本サービスはデジタルサービスのため、<strong>原則として返金は承っておりません</strong>。<br />
        サブスクリプションは Stripe カスタマーポータル（設定画面内のリンクよりアクセス）または本サービスの設定画面からいつでも解約できます。解約後も、次回更新日までは引き続きご利用いただけます。<br />
        当社の責に帰すべき重大なサービス不具合があった場合のみ、個別にご相談のうえ対応いたします。
      </>
    )},
    { label: "動作環境", value: "最新版の Google Chrome / Safari / Firefox / Microsoft Edge。Google アカウントおよび Google Drive の利用環境が必要です。" },
    { label: "特別な販売条件", value: "20歳未満の方は、保護者の同意を得たうえでご利用ください。" },
  ];

  return (
    <>
      <h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-gray-50">特定商取引法に基づく表記</h1>
      <Table rows={rows} />
      <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">最終更新日：2026年4月20日</p>
    </>
  );
}

function TokushohoEn() {
  const rows: Row[] = [
    { label: "Seller", value: "Takeshi Morita (Trade name: takeshy.work)" },
    { label: "Managing Operator", value: "Takeshi Morita" },
    { label: "Address", value: "Fente Okurayama 101, 964-1 Mamedo-cho, Kohoku-ku, Yokohama-shi, Kanagawa 222-0032, Japan" },
    { label: "Phone", value: "+81-50-1792-0976 (Business hours: Weekdays 10:00–18:00 JST)" },
    { label: "Email", value: (
      <a href="mailto:takeshy.work@gmail.com" className="text-blue-600 hover:underline dark:text-blue-400">
        takeshy.work@gmail.com
      </a>
    )},
    { label: "Website", value: (
      <a href="https://gemihub.online/lp" className="text-blue-600 hover:underline dark:text-blue-400">
        https://gemihub.online/lp
      </a>
    )},
    { label: "Pricing", value: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Free plan: ¥0</li>
        <li>Lite plan: ¥300/month (tax included)</li>
        <li>Pro plan: ¥2,000/month (tax included)</li>
      </ul>
    )},
    { label: "Additional Fees", value: (
      <>
        Customers are responsible for their own internet connection and communication fees.<br />
        Gemini API usage fees are billed directly to the customer&apos;s own Google Cloud account (GemiHub does not bill for API usage).
      </>
    )},
    { label: "Payment Methods", value: "Credit card via Stripe (Visa / Mastercard / American Express / JCB / Diners Club / Discover)" },
    { label: "Payment Timing", value: "Initial: charged immediately upon subscription. Subsequent: automatically charged on the monthly renewal date." },
    { label: "Service Delivery", value: "Available immediately upon successful payment." },
    { label: "Cancellation & Refunds", value: (
      <>
        As this is a digital service, <strong>refunds are not provided as a general rule</strong>.<br />
        Subscriptions can be canceled at any time via the Stripe Customer Portal (link available in the settings screen) or the Service&apos;s settings screen. After cancellation, you may continue to use the Service until the next renewal date.<br />
        Refunds may be considered on a case-by-case basis only in the event of a significant service failure attributable to us.
      </>
    )},
    { label: "System Requirements", value: "Latest versions of Google Chrome / Safari / Firefox / Microsoft Edge. A Google account and Google Drive access are required." },
    { label: "Special Conditions", value: "Users under the age of 20 must obtain consent from a guardian before using the Service." },
  ];

  return (
    <>
      <h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-gray-50">Commercial Transactions Act Disclosure</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        This page provides the disclosures required under the Act on Specified Commercial Transactions of Japan.
      </p>
      <Table rows={rows} />
      <p className="mt-10 text-sm text-gray-400 dark:text-gray-500">Last updated: April 20, 2026</p>
    </>
  );
}
