import { tr } from "../shared/i18n.ts";
import { z } from "zod";
import { paymentRulesSchema, type BookingPayment } from "./payment-domain.ts";
import { pageSchema, headerSchema, footerSchema, defaultHeader, defaultFooter } from "./pages.ts";
import { regionSchema, regionOf, currencyOf, validPrice, dateIn, zonedDate, weekdayOf } from "../shared/region.ts";
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
        }),
      )
      .min(1)
      .max(30),
    hours: z.object({
      start: clock,
      end: clock,
      closedWeekdays: z.array(z.number().int().min(0).max(6)),
      holidays: z.array(z.iso.date()),
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
    for (const m of s.menus)
      if (!validPrice(m.price, currency)) fail(currency === "JPY" ? tr("料金は1円単位で入力してください") : tr("料金はセント単位（小数2桁まで）で入力してください"));
    for (const m of s.menus.filter((m) => m.active))
      if (!s.staff.some((p) => p.menuIds.includes(m.id)))
        fail(tr("{0} に対応するスタッフが必要です", m.name));
  });
export type ShopConfig = z.infer<typeof shopSchema>;
export type Booking = {
  id: string;
  requestKey?: string;
  shopId: string;
  customer: string;
  name: string;
  menuId: string;
  price: number;
  message: string;
  staffId: string;
  start: string;
  end: string;
  status: "active" | "cancelled" | "no_show";
  createdAt: string;
  payment?: BookingPayment;
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
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
export function slots(
  config: ShopConfig,
  bookings: Booking[],
  date: string,
  menuId: string,
  requestedStaff?: string,
  now = new Date(),
) {
  if (!z.iso.date().safeParse(date).success) return [];
  const menu = config.menus.find((m) => m.id === menuId && m.active);
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
  const closing = zonedDate(date, config.hours.end, timeZone).getTime();
  for (
    let t = minutes(config.hours.start);
    t < minutes(config.hours.end);
    t += config.rules.interval
  ) {
    const hhmm = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    const start = zonedDate(date, hhmm, timeZone);
    const end = new Date(start.getTime() + menu.duration * 60000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(closing) || end.getTime() > closing || start.getTime() < now.getTime() + config.rules.leadMinutes * 60000)
      continue;
    const staff = config.staff.find(
      (p) =>
        (!requestedStaff || p.id === requestedStaff) &&
        p.menuIds.includes(menuId) &&
        p.weekdays.includes(weekday) &&
        zonedDate(date, p.start, timeZone).getTime() <= start.getTime() &&
        zonedDate(date, p.end, timeZone).getTime() >= end.getTime() &&
        !bookings.some(
          (b) =>
            b.status === "active" &&
            b.staffId === p.id &&
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
export function documents(
  config: ShopConfig,
  history: { at: string; summary: string; request?: string }[],
) {
  return {
    spec: tr("# {0}\n\n{1}\n\n## お店の情報・予約ルール\n\n```json\n{2}\n```\n\n## 権限\nお客様は自分の予約のみ閲覧・キャンセルできます。運営は店主とGoogleログインを完了した登録済みスタッフのみです。\nキャンセル・無断キャンセルは状態変更で記録します。時刻はお店に設定したタイムゾーンの現地時刻です。\n\n## 予約時の決済と返金\nPayPal決済を有効にした店舗では予約時に全額を支払い、キャンセル時に予約時点の金額・条件で自動返金します。店都合は全額返金。返金額は開始までの残り時間で計算し、通貨の最小単位（1円・1セント）未満を切り捨てます。キャンセルの記録と返金状態は保持します。プレビューでは実際の支払い・返金はしません。\n\n## ブログ・お知らせ\n店主が管理メニューで記事を編集し、必要に応じてプレビューを見て、保存すると本番へ反映します。保存前の編集は公開内容に反映しません。ブログとお知らせの一覧・個別記事・新着5件を提供し、公開・非公開の変更は履歴に残します。原稿と生成ファイルも店主の Drive に保存します。\n\n## データとファイル\n予約・問い合わせ・お客様・メニュー等の正本は店主のスプレッドシート、画像・添付は店主の Drive に保存します。仕様・履歴・保存先は「お店をつくる・直す」にまとめて表示します。標準シートは各専用管理メニューで扱い、専用画面のない追加シートは店主専用の「データ管理」で一覧・検索・行追加・編集できます。列名・列順と既存の計算式を維持し、行全体の削除はしません。\n\n## 追加ページと本番データ\n追加ページは「AIとお店をつくる」の新ページ作成で内容と公開メニュー名を確認して追加します。追加後は画面単位で編集・反映します。メニュー・料金、スタッフ・勤務、営業時間・予約ルールは専用管理メニューの保存で本番へ反映します。\n", config.name, config.description, JSON.stringify(config, null, 2)),
    history: tr("# 変更履歴\n\n{0}\n", history.map((h) => `- ${h.at} ${h.summary}${h.request ? tr("\n  - 依頼：{0}", h.request.replace(/\s+/g, " ").slice(0, 1000)) : ""}`).join("\n")),
  };
}
export function planSummary(before: ShopConfig | null, next: ShopConfig) {
  if (!before)
    return [
      tr("お店の紹介とメニューのページ"),
      tr("お客様のログイン・予約・マイページ"),
      tr("予約一覧・キャンセル・お問い合わせの運営画面"),
      tr("Google スプレッドシートと仕様・変更履歴"),
      tr("予約確定とキャンセルのメール通知"),
    ];
  return ([...new Set([...Object.keys(before), ...Object.keys(next)])] as (keyof ShopConfig)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
    .map(
      (k) =>
        tr("{0}を更新", { name: tr("店名"), industry: tr("業種"), description: tr("お店の紹介"), address: tr("アクセス"), appearance: tr("ページの色・画像・配置"), notificationEmail: tr("通知先"), map: tr("地図"), screens: tr("画面のデザイン"), region: tr("国・タイムゾーン"), pages: tr("追加ページ"), header: tr("共通ヘッダー"), footer: tr("共通フッター"), menus: tr("メニュー"), staff: tr("スタッフ・勤務"), hours: tr("営業時間・休業日"), rules: tr("予約ルール") }[k]),
    );
}
