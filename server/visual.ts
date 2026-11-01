import { z } from "zod";
import { shopSchema, type ShopConfig } from "./domain.ts";
export const visualTargets = (c: ShopConfig) => [
  { id: "name", label: `店名：${c.name}` },
  { id: "description", label: `紹介文：${c.description}` },
  { id: "address", label: `アクセス：${c.address}` },
  { id: "appearance", label: "ページ全体の色・配置・紹介画像" },
  { id: "part:header", label: "共通ヘッダーの見出し・紹介文・画像・ナビゲーション" },
  { id: "part:footer", label: "共通フッターの本文・配置" },
  ...c.menus.filter(m => m.active).map(m => ({ id: `menu:${m.id}`, label: `メニュー名：${m.name}` })),
  ...c.staff.map(p => ({ id: `staff:${p.id}`, label: `スタッフ名：${p.name}` })),
  ...c.pages.flatMap(p => [{ id: `page:${p.id}:title`, label: `ページ見出し：${p.title}` }, { id: `page:${p.id}:body`, label: `ページ本文：${p.title}` }, { id: `page:${p.id}:design`, label: `ページの画像・配置：${p.title}` }]),
];
export const mediaSchema = z.object({
  mimeType: z.literal("image/png"),
  data: z.string().min(4).max(11200000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const identificationSchema = z.object({
  ids: z.array(z.string().max(120)).max(10),
  explanation: z.string().min(1).max(2000),
});
export type VisualRequest = {
  id: string; shopId: string; base: number; source: ShopConfig | null;
  config: ShopConfig; candidates: { id: string; label: string }[]; createdAt: number;
};
// A visual request can change its selected text or appearance, never booking rules or prices.
export function validateVisualChange(before: ShopConfig, input: ShopConfig, target: string) {
  const next = shopSchema.parse(input);
  const allowed = structuredClone(before);
  if (target === "name" || target === "description" || target === "address") allowed[target] = next[target];
  else if (target === "appearance") allowed.appearance = next.appearance;
  else if (target === "part:header") allowed.header = next.header;
  else if (target === "part:footer") allowed.footer = next.footer;
  else if (target.startsWith("page:")) {
    const [, id, field] = target.split(":");
    const page = allowed.pages.find(p => p.id === id);
    const updated = next.pages.find(p => p.id === id);
    if (!page || !updated) throw new Error("対象のページがありません");
    if (field === "title") page.title = updated.title;
    else if (field === "body") page.body = updated.body;
    else if (field === "design") { page.layout = updated.layout; page.imageUrl = updated.imageUrl; page.imageId = updated.imageId; }
    else throw new Error("ページの変更対象を選び直してください");
  }
  else if (target.startsWith("menu:")) {
    const id = target.slice(5);
    const item = allowed.menus.find(m => m.id === id);
    const updated = next.menus.find(m => m.id === id);
    if (!item || !updated) throw new Error("対象のメニューがありません");
    item.name = updated.name;
  } else if (target.startsWith("staff:")) {
    const id = target.slice(6);
    const item = allowed.staff.find(m => m.id === id);
    const updated = next.staff.find(m => m.id === id);
    if (!item || !updated) throw new Error("対象のスタッフがありません");
    item.name = updated.name;
  } else throw Object.assign(new Error("変更対象を選び直してください"), {status: 400});
  if (JSON.stringify(shopSchema.parse(allowed)) !== JSON.stringify(next))
    throw Object.assign(new Error("指定箇所以外の変更が含まれています。予約ルールや料金の変更は言葉で依頼してください。"), {status: 400});
  return next;
}
