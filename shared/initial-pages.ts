import { tr } from "./i18n.ts";
import type { ShopConfig } from "../server/domain.ts";
export function initialIntroductionPages(config: ShopConfig, choices?: { staff: boolean; products: boolean }) {
  if (!choices) return config;
  const kind = (value: string) => /^(?:staff|team|staffintroduction|スタッフ紹介|スタッフ)$/.test(value) ? "staff" : /^(?:products|product|services|productintroduction|商品紹介|商品サービス紹介)$/.test(value) ? "products" : undefined;
  const key = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s・_-]/g, "");
  const pageKind = (page: ShopConfig["pages"][number]) => kind(key(page.navigationLabel)) || kind(key(page.slug)) || kind(key(page.id));
  const pages = config.pages.filter(page => { const type = pageKind(page); return !type || choices[type]; });
  if (choices.staff && !pages.some(page => pageKind(page) === "staff")) pages.push({ id: "staff-introduction", slug: "staff", title: tr("スタッフ紹介"), navigationLabel: tr("スタッフ紹介"), body: tr("## スタッフ紹介\n\nスタッフの紹介は、ただいま準備中です。"), layout: "standard", imageUrl: "" });
  if (choices.products && !pages.some(page => pageKind(page) === "products")) pages.push({ id: "product-introduction", slug: "products", title: tr("商品・サービス紹介"), navigationLabel: tr("商品・サービス紹介"), body: tr("## 商品・サービス紹介\n\n商品やサービスの紹介は、ただいま準備中です。"), layout: "standard", imageUrl: "" });
  return { ...config, pages };
}
