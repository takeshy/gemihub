import { tr } from "../shared/i18n.ts";
import { z } from "zod";
import { paymentRulesSchema, type BookingPayment } from "./payment-domain.ts";
import type { BookingTransfer } from "./transfer-domain.ts";
import { pageSchema, headerSchema, footerSchema, defaultHeader, defaultFooter } from "./pages.ts";
import { regionSchema, regionOf, currencyOf, validPrice, toMinor, fromMinor, dateIn, zonedDate, weekdayOf } from "../shared/region.ts";
import { themeSchema, compilePresentation } from "../shared/presentation.ts";
import { screensSchema } from "../shared/screens.ts";
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const shopSchema = z
  .object({
    name: z.string().min(1).max(100),
    industry: z.enum(["nail", "hair", "other"]),
    description: z.string().max(1500),
    address: z.string().max(300),
    appearance: z.object({
      accent: z.enum(["sage", "rose", "navy"]),
      layout: z.enum(["standard", "compact"]),
      imageUrl: z.union([z.literal(""), z.url({protocol: /^https$/}).max(2048)]),
      theme: themeSchema.optional(),
      articles: z.object({ blogs: z.boolean(), announcements: z.boolean() }).optional(),
    }).optional(),
    notificationEmail: z.email(),
    /** An embedded Google Map in the access section; `query` (place or address) defaults to the address. */
    map: z.object({ enabled: z.boolean(), query: z.string().max(300) }).optional(),
    /** Optional HTML/CSS layouts for built-in screens; working parts are inserted through slots. */
    screens: screensSchema.optional(),
    /** Country and time zone; absent means Japan. Decides currency, booking times and dates. */
    region: regionSchema.optional(),
    /** Owner is bookable without a staff registration; legacy shops keep their explicit assignments. */
    ownerBooking: z.literal(true).optional(),
    header: headerSchema.default(() => ({ ...defaultHeader })),
    footer: footerSchema.default(() => ({ ...defaultFooter })),
    pages: z.array(pageSchema).max(30).default([]),
    menus: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/),
          name: z.string().min(1).max(100),
          duration: z.number().int().min(15).max(480),
          price: z.number().min(0).max(1000000),
          active: z.boolean(),
          imageId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          /** Present only for add-ons; the IDs of standalone menus that allow this option. */
          optionFor: z.array(z.string().regex(/^[a-z0-9_-]+$/)).max(50).optional(),
          /** Only one option in the same group may be selected for a booking. */
          optionGroup: z.string().trim().min(1).max(80).optional(),
          /** false: bookings with this menu cannot be offered for transfer (absent means allowed). */
          transferable: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(50),
    staff: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/),
          name: z.string().min(1).max(100),
          menuIds: z.array(z.string()).min(1),
          weekdays: z.array(z.number().int().min(0).max(6)).min(1),
          start: clock,
          end: clock,
          imageId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
          /** Owner rows inherit shop availability until working conditions are explicitly edited. */
          customAvailability: z.literal(true).optional(),
        }),
      )
      .max(30),
    hours: z.object({
      start: clock,
      end: clock,
      closedWeekdays: z.array(z.number().int().min(0).max(6)),
      holidays: z.array(z.iso.date()),
      weekdayHours: z.array(z.object({ day: z.number().int().min(0).max(6), start: clock, end: clock })).max(7).optional(),
    }),
    rules: z.object({
      interval: z.number().int().min(5).max(120),
      advanceDays: z.number().int().min(1).max(365),
      leadMinutes: z.number().int().min(0).max(43200),
      sameDay: z.boolean(),
      cancelHours: z.number().int().min(0).max(720),
      payment: paymentRulesSchema.optional(),
    }),
  })
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (s.hours.start >= s.hours.end)
      fail(tr("営業時間の終了は開始より後にしてください"));
    if (new Set(s.hours.weekdayHours?.map(hours => hours.day)).size !== (s.hours.weekdayHours?.length || 0)) fail(tr("曜日別の営業時間が重複しています"));
    for (const hours of s.hours.weekdayHours || []) if (hours.start >= hours.end) fail(tr("曜日別の営業時間の終了は開始より後にしてください"));
    if (
      new Set(s.menus.map((m) => m.id)).size !== s.menus.length ||
      new Set(s.staff.map((m) => m.id)).size !== s.staff.length
    )
      fail(tr("メニュー・スタッフの ID が重複しています"));
    // Page bodies follow the same safe HTML subset as themes: no scripts, handlers, forms, embeds or external CSS.
    for (const page of s.pages)
      try { compilePresentation({ html: page.body, css: page.css || "" }); } catch (error) { fail(tr("{0} の本文（HTML）を確認してください。{1}", page.title, error instanceof Error ? error.message : "")); }
    if (new Set(s.pages.map(p => p.id)).size !== s.pages.length || new Set(s.pages.map(p => p.slug)).size !== s.pages.length) fail(tr("ページの ID・アドレスが重複しています"));
    for (const p of s.staff) {
      if (p.start >= p.end) fail(tr("勤務終了は開始より後にしてください"));
      if (p.menuIds.some((id) => !s.menus.some((m) => m.id === id)))
        fail(tr("スタッフの対応メニューが存在しません"));
    }
    const currency = currencyOf(regionOf(s));
    for (const menu of s.menus) {
      if (menu.optionFor) {
        if (menu.active && !menu.optionFor.length) fail(tr("追加メニューの対象を選択してください"));
        if (new Set(menu.optionFor).size !== menu.optionFor.length || menu.optionFor.some(id => !s.menus.some(base => base.id === id && !base.optionFor))) fail(tr("追加先には実在する通常メニューを指定してください"));
      } else if (menu.optionGroup) fail(tr("選択グループは追加メニューに設定してください"));
    }
    for (const m of s.menus)
      if (!validPrice(m.price, currency)) fail(currency === "JPY" ? tr("料金は1円単位で入力してください") : tr("料金はセント単位（小数2桁まで）で入力してください"));
    for (const m of s.menus.filter((m) => m.active && !m.optionFor))
      if (!s.ownerBooking && s.staff.length && !s.staff.some((p) => p.menuIds.includes(m.id)))
        fail(tr("{0} に対応するスタッフが必要です", m.name));
  });
export type ShopConfig = z.infer<typeof shopSchema>;
export const ownerStaffId = "owner";
/** Preserve automatic shop availability until the owner explicitly configures a shift. */
export function bookingStaff(config: Pick<ShopConfig, "staff" | "menus" | "hours" | "ownerBooking">): ShopConfig["staff"] {
  if (config.staff.length && !config.ownerBooking) return config.staff;
  const profile = config.staff.find(staff => staff.id === ownerStaffId);
  const opening = [config.hours, ...(config.hours.weekdayHours || [])];
  const owner = profile?.customAvailability ? profile : { id: ownerStaffId, name: profile?.name ?? tr("店主"), ...(profile?.imageId ? { imageId: profile.imageId } : {}), menuIds: config.menus.map(menu => menu.id), weekdays: [0, 1, 2, 3, 4, 5, 6], start: opening.map(hours => hours.start).sort()[0], end: opening.map(hours => hours.end).sort().at(-1)! };
  return [...config.staff.filter(staff => staff.id !== ownerStaffId), owner];
}
export const bookingStaffName = (config: ShopConfig | null | undefined, id: string) => config?.staff.find(staff => staff.id === id)?.name || (id === ownerStaffId ? tr("店主") : id);
export function menuSelection(config: ShopConfig, menuId: string, optionIds: readonly string[] = []) {
  const base = config.menus.find(menu => menu.id === menuId && menu.active && !menu.optionFor);
  if (!base || optionIds.length > 10 || new Set(optionIds).size !== optionIds.length) return undefined;
  const options = [...optionIds].sort().map(id => config.menus.find(menu => menu.id === id && menu.active && menu.optionFor?.includes(menuId)));
  if (options.some(option => !option)) return undefined;
  const selected = options as ShopConfig["menus"];
  const groups = selected.map(option => option.optionGroup).filter(Boolean);
  if (new Set(groups).size !== groups.length) return undefined;
  const currency = currencyOf(regionOf(config));
  const items = [base, ...selected].map(({id,name,price,duration}) => ({menuId:id,name,price,duration}));
  return { base, options: selected, optionIds: selected.map(option => option.id), items, duration: items.reduce((total,item)=>total+item.duration,0), price: fromMinor(items.reduce((total,item)=>total+toMinor(item.price,currency),0),currency) };
}
export const bookingMenuName = (config: ShopConfig | null | undefined, booking: Pick<Booking, "menuId" | "items">) => booking.items?.length ? booking.items.map(item=>item.name).join(" + ") : config?.menus.find(menu=>menu.id===booking.menuId)?.name || booking.menuId;
/** Every menu in the booking (base and add-ons) must exist and allow transfer. */
export const bookingTransferable = (config: Pick<ShopConfig, "menus">, booking: Pick<Booking, "menuId" | "optionIds">) =>
  [booking.menuId, ...(booking.optionIds || [])].every(id => { const menu = config.menus.find(menu => menu.id === id); return !!menu && menu.transferable !== false; });
export type Booking = {
  id: string;
  requestKey?: string;
  shopId: string;
  customer: string;
  name: string;
  menuId: string;
  optionIds?: string[];
  items?: { menuId: string; name: string; price: number; duration: number }[];
  price: number;
  message: string;
  staffId: string;
  start: string;
  end: string;
  status: "active" | "cancelled" | "no_show";
  createdAt: string;
  payment?: BookingPayment;
  /** Holder changes through transfer listings, oldest first; `payment` is always the current holder's. */
  transfers?: BookingTransfer[];
  /** Customer view only: set instead of `transfers`, which carries earlier holders' details. */
  transferredIn?: boolean;
  updatedBy?: string;
  updatedAt?: string;
};
export const sample: ShopConfig = {
  get name() { return tr("nail atelier 凪"); },
  industry: "nail",
  get description() { return tr("日常に、少しのときめきを。小さなプライベートネイルサロンです。"); },
  get address() { return tr("東京都世田谷区（詳しいアクセスは予約後にご案内）"); },
  notificationEmail: "owner@example.com",
  pages: [],
  header: { ...defaultHeader },
  footer: { ...defaultFooter },
  menus: [
    {
      id: "simple",
      get name() { return tr("シンプルネイル"); },
      duration: 60,
      price: 5500,
      active: true,
    },
    {
      id: "design",
      get name() { return tr("季節のデザイン"); },
      duration: 90,
      price: 7800,
      active: true,
    },
  ],
  staff: [
    {
      id: "aoi",
      get name() { return tr("あおい"); },
      menuIds: ["simple", "design"],
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: "10:00",
      end: "18:00",
    },
    {
      id: "haru",
      get name() { return tr("はる"); },
      menuIds: ["simple", "design"],
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: "10:00",
      end: "18:00",
    },
  ],
  hours: { start: "10:00", end: "18:00", closedWeekdays: [2], holidays: [] },
  rules: {
    interval: 30,
    advanceDays: 30,
    leadMinutes: 60,
    sameDay: true,
    cancelHours: 24,
  },
};
export const dateJST = (now = new Date()) => dateIn(now, "Asia/Tokyo");
/** Today's date (or the date of an instant) in the shop's time zone. */
export const shopDate = (config: Pick<ShopConfig, "region"> | null | undefined, now: Date | number | string = new Date()) => dateIn(now, regionOf(config).timeZone);
/** Calendar dates in the booking window, independent of UTC offset and DST. */
export function bookingDates(config: ShopConfig, now = new Date()) {
  const today = shopDate(config, now);
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: config.rules.advanceDays + 1 }, (_, day) => new Date(start + day * 86400000).toISOString().slice(0, 10)).filter(date => config.rules.sameDay || date !== today);
}
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export const hoursForDate = (config: Pick<ShopConfig, "hours">, date: string) => config.hours.weekdayHours?.find(hours => hours.day === weekdayOf(date)) || config.hours;
export function hoursText(config: Pick<ShopConfig, "hours">) {
  const days = [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
  return [`${config.hours.start} – ${config.hours.end}`, ...(config.hours.weekdayHours || []).map(hours => `${tr("{0}曜", days[hours.day])} ${hours.start} – ${hours.end}`)].join(" / ");
}
export function slots(
  config: ShopConfig,
  bookings: Booking[],
  date: string,
  menuId: string,
  requestedStaff?: string,
  now = new Date(),
  optionIds: readonly string[] = [],
) {
  if (!z.iso.date().safeParse(date).success) return [];
  const menu = menuSelection(config, menuId, optionIds);
  // Dates, weekdays and opening hours are the shop's wall clock in its own time zone.
  const timeZone = regionOf(config).timeZone;
  const weekday = weekdayOf(date);
  const today = dateIn(now, timeZone);
  const max = new Date(Date.parse(`${today}T00:00:00Z`) + config.rules.advanceDays * 86400000).toISOString().slice(0, 10);
  if (
    !menu ||
    date < today ||
    date > max ||
    (!config.rules.sameDay && date === today) ||
    config.hours.closedWeekdays.includes(weekday) ||
    config.hours.holidays.includes(date)
  )
    return [];
  const result: { start: string; end: string; staffId: string }[] = [];
  const hours = hoursForDate(config, date);
  const closing = zonedDate(date, hours.end, timeZone).getTime();
  for (
    let t = minutes(hours.start);
    t < minutes(hours.end);
    t += config.rules.interval
  ) {
    const hhmm = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    const start = zonedDate(date, hhmm, timeZone);
    const end = new Date(start.getTime() + menu.duration * 60000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(closing) || end.getTime() > closing || start.getTime() < now.getTime() + config.rules.leadMinutes * 60000)
      continue;
    const staff = bookingStaff(config).find(
      (p) =>
        (!requestedStaff || p.id === requestedStaff) &&
        p.menuIds.includes(menuId) &&
        menu.options.every(option => p.menuIds.includes(option.id)) &&
        p.weekdays.includes(weekday) &&
        zonedDate(date, p.start, timeZone).getTime() <= start.getTime() &&
        zonedDate(date, p.end, timeZone).getTime() >= end.getTime() &&
        !bookings.some(
          (b) =>
            b.status === "active" &&
            (b.staffId === p.id || !config.staff.length || (p.id === ownerStaffId && config.ownerBooking && !config.staff.some(staff => staff.id === b.staffId))) &&
            Date.parse(b.start) < end.getTime() &&
            Date.parse(b.end) > start.getTime(),
        ),
    );
    if (staff)
      result.push({
        start: start.toISOString(),
        end: end.toISOString(),
        staffId: staff.id,
      });
  }
  return result;
}
export function firstAvailableSlots(config: ShopConfig, bookings: Booking[], menu: string, staff?: string, optionIds: string[] = [], now = new Date()) {
  for (const date of bookingDates(config, now)) {
    const times = slots(config, bookings, date, menu, staff, now, optionIds);
    if (times.length) return { date, slots: times };
  }
  return { date: "", slots: [] };
}
export function documents(
  config: ShopConfig,
  history: { at: string; summary: string; request?: string }[],
) {
  return {
    spec: tr("# {0}\n\n{1}\n\n## お店の情報・予約ルール\n\n```json\n{2}\n```\n\n## 権限\nお客様は自分の予約のみ閲覧・キャンセルできます。運営は店主とGoogleログインを完了した登録済みスタッフのみです。\nキャンセル・無断キャンセルは状態変更で記録します。時刻はお店に設定したタイムゾーンの現地時刻です。\n\n## 予約時の決済と返金\nPayPal決済を有効にした店舗では予約時に全額を支払い、キャンセル時に予約時点の金額・条件で自動返金します。店都合は全額返金。返金額は開始までの残り時間で計算し、通貨の最小単位（1円・1セント）未満を切り捨てます。キャンセルの記録と返金状態は保持します。プレビューでは実際の支払い・返金はしません。\n\n## ブログ・お知らせ\n店主が管理メニューで記事を編集し、必要に応じてプレビューを見て、保存すると本番へ反映します。保存前の編集は公開内容に反映しません。ブログとお知らせの一覧・個別記事・新着5件を提供し、公開・非公開の変更は履歴に残します。原稿と生成ファイルも店主の Drive に保存します。\n\n## データとファイル\n予約・問い合わせ・お客様・メニュー・AIチャット等の正本はFirestoreに保存し、画像や添付は店主のDriveに保存します。設定と記録はアプリの専用メニューで編集します。店主は「公開の設定」から全体をJSON、記録の種類ごとにCSVで書き出せます。写真・添付の本体は書き出しに含まず、Driveに保持します。書き出したファイルの編集は本番データに反映しません。\n\n## 追加ページと本番データ\n追加ページは「AIとお店をつくる」の新ページ作成で内容と公開メニュー名を確認して追加します。追加後は画面単位で編集・反映します。メニュー・料金、スタッフ・勤務、営業時間・予約ルールは専用管理メニューの保存で本番へ反映します。\n", config.name, config.description, JSON.stringify(config, null, 2)),
    history: tr("# 変更履歴\n\n{0}\n", history.map((h) => `- ${h.at} ${h.summary}${h.request ? tr("\n  - 依頼：{0}", h.request.replace(/\s+/g, " ").slice(0, 1000)) : ""}`).join("\n")),
  };
}
export function planSummary(before: ShopConfig | null, next: ShopConfig) {
  if (!before)
    return [
      tr("お店の紹介とメニューのページ"),
      tr("お客様のログイン・予約・マイページ"),
      tr("予約一覧・キャンセル・お問い合わせの運営画面"),
      tr("お店の記録と仕様・変更履歴"),
      tr("予約確定とキャンセルのメール通知"),
    ];
  return ([...new Set([...Object.keys(before), ...Object.keys(next)])] as (keyof ShopConfig)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
    .map(
      (k) =>
        tr("{0}を更新", { name: tr("店名"), industry: tr("業種"), description: tr("お店の紹介"), address: tr("アクセス"), appearance: tr("ページの色・画像・配置"), notificationEmail: tr("通知先"), map: tr("地図"), screens: tr("画面のデザイン"), region: tr("国・タイムゾーン"), ownerBooking: tr("店主の予約受付"), pages: tr("追加ページ"), header: tr("共通ヘッダー"), footer: tr("共通フッター"), menus: tr("メニュー"), staff: tr("スタッフ・勤務"), hours: tr("営業時間・休業日"), rules: tr("予約ルール") }[k]),
    );
}
