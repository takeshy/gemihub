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
    { id: "faq", slug: "faq", title: "よくある質問", navigationLabel: "よくある質問", body: "## もとの案内\n\n初めてのお客様へ。", layout: "standard", imageUrl: "" },
    { id: "about-us", slug: "about-us", title: "私たちのお店", navigationLabel: "店舗紹介", body: "## 大切にしていること\n\n一人ひとりに合った時間をご用意します。", layout: "compact", imageUrl: "" },
  ] satisfies ShopPage[];
  const source = structuredClone(config);
  if (state === "conflict") config.pages[0].body = "## ローカルの変更\n\nローカルで加えた案内です。";
  writeDraft(localStorage, key, { config, source, base: 0, fixtures: sampleFixtures(config), downloaded: ["faq", "about-us"] });
}
