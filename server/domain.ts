import { z } from "zod";
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
    }).optional(),
    notificationEmail: z.email(),
    menus: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_-]+$/),
          name: z.string().min(1).max(100),
          duration: z.number().int().min(15).max(480),
          price: z.number().int().min(0).max(1000000),
          active: z.boolean(),
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
      mode: z.enum(["designated", "any"]),
      interval: z.number().int().min(5).max(120),
      advanceDays: z.number().int().min(1).max(365),
      leadMinutes: z.number().int().min(0).max(43200),
      sameDay: z.boolean(),
      cancelHours: z.number().int().min(0).max(720),
    }),
  })
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (s.hours.start >= s.hours.end)
      fail("営業時間の終了は開始より後にしてください");
    if (
      new Set(s.menus.map((m) => m.id)).size !== s.menus.length ||
      new Set(s.staff.map((m) => m.id)).size !== s.staff.length
    )
      fail("メニュー・スタッフの ID が重複しています");
    for (const p of s.staff) {
      if (p.start >= p.end) fail("勤務終了は開始より後にしてください");
      if (p.menuIds.some((id) => !s.menus.some((m) => m.id === id)))
        fail("スタッフの対応メニューが存在しません");
    }
    for (const m of s.menus.filter((m) => m.active))
      if (!s.staff.some((p) => p.menuIds.includes(m.id)))
        fail(`${m.name} に対応するスタッフが必要です`);
  });
export type ShopConfig = z.infer<typeof shopSchema>;
export type Booking = {
  id: string;
  requestKey?: string;
  shopId: string;
  customer: string;
  name: string;
  menuId: string;
  staffId: string;
  start: string;
  end: string;
  status: "active" | "cancelled" | "no_show";
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
};
export const sample: ShopConfig = {
  name: "nail atelier 凪",
  industry: "nail",
  description: "日常に、少しのときめきを。小さなプライベートネイルサロンです。",
  address: "東京都世田谷区（詳しいアクセスは予約後にご案内）",
  notificationEmail: "owner@example.com",
  menus: [
    {
      id: "simple",
      name: "シンプルネイル",
      duration: 60,
      price: 5500,
      active: true,
    },
    {
      id: "design",
      name: "季節のデザイン",
      duration: 90,
      price: 7800,
      active: true,
    },
  ],
  staff: [
    {
      id: "aoi",
      name: "あおい",
      menuIds: ["simple", "design"],
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: "10:00",
      end: "18:00",
    },
    {
      id: "haru",
      name: "はる",
      menuIds: ["simple", "design"],
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: "10:00",
      end: "18:00",
    },
  ],
  hours: { start: "10:00", end: "18:00", closedWeekdays: [2], holidays: [] },
  rules: {
    mode: "designated",
    interval: 30,
    advanceDays: 30,
    leadMinutes: 60,
    sameDay: true,
    cancelHours: 24,
  },
};
export const dateJST = (now = new Date()) =>
  new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
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
  const day = new Date(`${date}T00:00:00+09:00`).getUTCDay();
  // getUTCDay on JST midnight falls on the previous UTC day.
  const weekday = (day + 1) % 7;
  const today = dateJST(now);
  const max = dateJST(
    new Date(now.getTime() + config.rules.advanceDays * 86400000),
  );
  if (
    !menu ||
    date < today ||
    date > max ||
    (!config.rules.sameDay && date === today) ||
    config.hours.closedWeekdays.includes(weekday) ||
    config.hours.holidays.includes(date)
  )
    return [];
  if (config.rules.mode === "designated" && !requestedStaff) return [];
  const result: { start: string; end: string; staffId: string }[] = [];
  for (
    let t = minutes(config.hours.start);
    t + menu.duration <= minutes(config.hours.end);
    t += config.rules.interval
  ) {
    const hhmm = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    const start = new Date(`${date}T${hhmm}:00+09:00`);
    const end = new Date(start.getTime() + menu.duration * 60000);
    if (start.getTime() < now.getTime() + config.rules.leadMinutes * 60000)
      continue;
    const staff = config.staff.find(
      (p) =>
        (config.rules.mode === "any" || p.id === requestedStaff) &&
        p.menuIds.includes(menuId) &&
        p.weekdays.includes(weekday) &&
        minutes(p.start) <= t &&
        minutes(p.end) >= t + menu.duration &&
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
  history: { at: string; summary: string }[],
) {
  return {
    spec: `# ${config.name}\n\n${config.description}\n\n## お店の情報・予約ルール\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\n## 権限\nお客様は自分の予約のみ閲覧・キャンセルできます。運営は店主と招待されたメンバーのみです。\nキャンセル・無断キャンセルは状態変更で記録します。時刻は日本時間です。\n\n## ブログ・お知らせ\n店主が記事の下書きを作成し、プレビューで確認・承認して公開します。下書きは非公開で、公開中の本文は次の承認まで維持します。ブログとお知らせの一覧・個別記事・新着5件を提供し、公開・非公開の変更は履歴に残します。原稿と生成ファイルも店主の Drive に保存します。\n`,
    history: `# 変更履歴\n\n${history.map((h) => `- ${h.at} ${h.summary}`).join("\n")}\n`,
  };
}
export function planSummary(before: ShopConfig | null, next: ShopConfig) {
  if (!before)
    return [
      "お店の紹介とメニューのページ",
      "お客様のログイン・予約・マイページ",
      "予約一覧・キャンセル・お問い合わせの運営画面",
      "Google スプレッドシートと仕様・変更履歴",
      "予約確定とキャンセルのメール通知",
    ];
  return ([...new Set([...Object.keys(before), ...Object.keys(next)])] as (keyof ShopConfig)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]))
    .map(
      (k) =>
        `${{ name: "店名", industry: "業種", description: "お店の紹介", address: "アクセス", appearance: "ページの色・画像・配置", notificationEmail: "通知先", menus: "メニュー", staff: "スタッフ・勤務", hours: "営業時間・休業日", rules: "予約ルール" }[k]}を更新`,
    );
}
