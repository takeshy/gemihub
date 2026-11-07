import { z } from "zod";
import { tr } from "./i18n.ts";

// Only presentation copy belongs here. Payment, consent, authentication and
// reservation status messages continue to describe the application's actual state.
export const storefrontCopyDefaults = {
  recentPosts: "お店からのお便り",
  navAbout: "お店のこと",
  navReserve: "ご予約",
  navMine: "マイページ",
  navContact: "お問い合わせ",
  navBlogs: "ブログ",
  navAnnouncements: "お知らせ",
  aboutMenus: "メニュー",
  aboutStaff: "スタッフ",
  aboutAccess: "アクセス",
  aboutHours: "営業時間",
  mineBookings: "あなたのご予約",
  bookingTitle: "自分のための、ひとときを。",
  bookingMenu: "01 メニューを選ぶ",
  bookingTime: "02 日時",
  bookingStaffTime: "02 スタッフと日時",
  bookingConfirm: "03 予約内容を確認",
  bookingSummary: "ご予約内容",
  contactTitle: "お問い合わせ",
  blogsIntro: "お店の日々や、季節のおすすめをお届けします。",
  announcementsIntro: "お店からの大切なご案内です。",
  headerEyebrow: "A LITTLE MOMENT, JUST FOR YOU.",
} as const;
export type StorefrontCopyKey = keyof typeof storefrontCopyDefaults;
export const storefrontCopyKeys = Object.keys(storefrontCopyDefaults) as StorefrontCopyKey[];
export const headerCopyKeys = storefrontCopyKeys.filter(key => key.startsWith("nav") || key === "headerEyebrow");
export const storefrontCopySchema = z.strictObject(Object.fromEntries(storefrontCopyKeys.map(key => [key, z.string().trim().min(1).max(500).optional()])) as Record<StorefrontCopyKey, z.ZodOptional<z.ZodString>>);
export type StorefrontCopy = z.infer<typeof storefrontCopySchema>;
type CopyConfig = { appearance?: { copy?: StorefrontCopy } } | null | undefined;
export function storefrontText(config: CopyConfig, key: StorefrontCopyKey): string {
  return config?.appearance?.copy?.[key] ?? tr(storefrontCopyDefaults[key]);
}
