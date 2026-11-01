import { tr } from "../shared/i18n.ts";
import { paymentHolds } from "./payments.ts";
import { google } from "googleapis";
import { z } from "zod";
import { oauth, encrypt, decrypt } from "./google.ts";
import type { Store, Shop } from "./store.ts";
import { slots, type ShopConfig } from "./domain.ts";

export const calendarScope = "https://www.googleapis.com/auth/calendar.freebusy";
export type CalendarConnection = {
  shopId: string;
  email: string;
  staffId: string;
  refreshToken: string;
};
export const busySchema = z.array(
  z.object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  }).refine(b => Date.parse(b.start) < Date.parse(b.end)),
);
export type Busy = z.infer<typeof busySchema>;
export const calendarGateway = {
  async exchange(code: string, verifier: string): Promise<{ email: string; refreshToken: string; name?: string }> {
    const auth = oauth();
    const { tokens } = await auth.getToken({ code, codeVerifier: verifier });
    const identity = await auth.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const profile = identity.getPayload();
    if (
      !profile?.email_verified || !profile.email ||
      !tokens.scope?.split(" ").includes(calendarScope) || !tokens.refresh_token
    )
      throw Object.assign(
        new Error(tr("Google Calendar の空き状況へのアクセスを承認してください")),
        { status: 400 },
      );
    return {
      email: profile.email.toLowerCase(),
      name: profile.name || profile.email,
      refreshToken: encrypt(tokens.refresh_token),
    };
  },
  async busy(connection: CalendarConnection, timeMin: string, timeMax: string): Promise<Busy> {
    const auth = oauth();
    auth.setCredentials({ refresh_token: decrypt(connection.refreshToken) });
    const { data } = await google.calendar({ version: "v3", auth }).freebusy.query({
      requestBody: {
        timeMin, timeMax, timeZone: "Asia/Tokyo", items: [{ id: "primary" }],
      },
    });
    const calendar = data.calendars?.primary;
    if (!calendar || calendar.errors?.length || !calendar.busy)
      throw new Error(tr("空き状況を取得できません"));
    return busySchema.parse(calendar.busy);
  },
};
export type CalendarGateway = typeof calendarGateway;
export async function connections(store: Store, shop: Shop) {
  const members = await store.records<{
    email: string; accepted: boolean; status?: string;
  }>("member", shop);
  return (await store.list<CalendarConnection>("calendar")).filter(c =>
    c.shopId === shop.id && (c.email === shop.owner || members.some(m =>
      m.email === c.email && m.accepted && m.status !== "revoked",
    )),
  );
}
export async function availableSlots(
  store: Store, shop: Shop, config: ShopConfig, date: string, menu: string,
  staff: string | undefined, gateway: CalendarGateway, excludeCheckout?: string,
) {
  const bookings = [...await store.bookings(shop.id), ...await paymentHolds(store, shop.id, excludeCheckout)];
  // Allocate after adding all busy intervals, so unspecified staff can be assigned.
  if (!z.iso.date().safeParse(date).success) return [];
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86400000);
  const relevant = (await connections(store, shop)).filter(c =>
    config.staff.some(s => s.id === c.staffId && s.menuIds.includes(menu)) &&
    (!staff || c.staffId === staff),
  );
  try {
    const results = await Promise.all(relevant.map(async c => ({
      staffId: c.staffId,
      busy: busySchema.parse(await gateway.busy(c, start.toISOString(), end.toISOString())),
    })));
    for (const result of results)
      for (const b of result.busy)
        bookings.push({
          ...b, id: "calendar", shopId: shop.id, staffId: result.staffId,
          customer: "", name: "", menuId: "", price: 0, message: "", createdAt: "", status: "active",
        });
  } catch {
    throw Object.assign(
      new Error(tr("Google Calendar の空き状況を確認できません。運営メンバーに再接続を依頼してから再試行してください。")),
      { status: 503 },
    );
  }
  return slots(config, bookings, date, menu, staff);
}
