import { sampleConfig } from "./sample-data";
import { tr } from "../../shared/i18n";
import { draftKey, sampleFixtures, writeDraft } from "../local-preview";
import type { ShopPage } from "../../server/pages";
export function seedEditor(state: "unfetched" | "remote" | "conflict" | "local") {
  const key = draftKey("owner@example.com", "story-shop");
  localStorage.removeItem(key);
  if (state === "unfetched") return;
  const config = sampleConfig();
  config.hours.closedWeekdays = [];
  config.pages = [
    { id: "faq", slug: "faq", title: tr("よくある質問"), navigationLabel: tr("よくある質問"), body: tr("<h2>もとの案内</h2><p>初めてのお客様へ。</p>"), layout: "standard", imageUrl: "" },
    { id: "about-us", slug: "about-us", title: tr("私たちのお店"), navigationLabel: tr("店舗紹介"), body: tr("<h2>大切にしていること</h2><p>一人ひとりに合った時間をご用意します。</p>"), layout: "compact", imageUrl: "" },
  ] satisfies ShopPage[];
  const source = structuredClone(config);
  if (state === "local") {
    // The baseline matches the published page, so only this browser has a change: "変更あり", not a conflict.
    source.pages[0].body = tr("<h2>初めてでも予約できますか？</h2><p>初めてのお客様も歓迎しています。</p><h2>当日の持ち物は？</h2><p>特にありません。お気軽にお越しください。</p>");
    config.pages[0].body = tr("<h2>初めてでも予約できますか？</h2><p>初めてのお客様も歓迎しています。ご不安な点はお気軽にお問い合わせください。</p><h2>当日の持ち物は？</h2><p>特にありません。お気軽にお越しください。</p><h2>駐車場はありますか？</h2><p>近くのコインパーキングをご利用ください。</p>");
  }
  if (state === "conflict") config.pages[0].body = tr("<h2>ローカルの変更</h2><p>ローカルで加えた案内です。</p>");
  writeDraft(localStorage, key, { config, source, base: 0, fixtures: sampleFixtures(config), downloaded: ["faq", "about-us"] });
}
