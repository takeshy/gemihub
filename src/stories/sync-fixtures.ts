import { tr } from "../../shared/i18n";
import { sample } from "../../server/domain";
import { draftKey, sampleFixtures, writeDraft } from "../local-preview";
import type { ShopPage } from "../../server/pages";
export function seedEditor(state: "unfetched" | "remote" | "conflict") {
  const key = draftKey("owner@example.com", "story-shop");
  localStorage.removeItem(key);
  if (state === "unfetched") return;
  const config = structuredClone(sample);
  config.hours.closedWeekdays = [];
  config.pages = [
    { id: "faq", slug: "faq", title: tr("よくある質問"), navigationLabel: tr("よくある質問"), body: tr("<h2>もとの案内</h2><p>初めてのお客様へ。</p>"), layout: "standard", imageUrl: "" },
    { id: "about-us", slug: "about-us", title: tr("私たちのお店"), navigationLabel: tr("店舗紹介"), body: tr("<h2>大切にしていること</h2><p>一人ひとりに合った時間をご用意します。</p>"), layout: "compact", imageUrl: "" },
  ] satisfies ShopPage[];
  const source = structuredClone(config);
  if (state === "conflict") config.pages[0].body = tr("<h2>ローカルの変更</h2><p>ローカルで加えた案内です。</p>");
  writeDraft(localStorage, key, { config, source, base: 0, fixtures: sampleFixtures(config), downloaded: ["faq", "about-us"] });
}
