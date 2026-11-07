import { regionOf, zonedDate } from "../shared/region.ts";
import { tr } from "../shared/i18n.ts";
import { paymentHolds } from "./payments.ts";
import { google } from "googleapis";
import { z } from "zod";
import { oauth, encrypt, decrypt } from "./google.ts";
import type { Store, Shop, User } from "./store.ts";
import { staffAccounts } from "./staff-accounts.ts";
import { demoGoogleUnavailable } from "./judge.ts";
import { slots, bookingDates, bookingStaff, menuSelection, ownerStaffId, type ShopConfig, type Booking } from "./domain.ts";

export const calendarScope = "https://www.googleapis.com/auth/calendar.freebusy";
/** Optional: lets gemihub keep a secondary calendar of each staff member's bookings. Busy times still come from `primary` only. */
export const calendarMirrorScope = "https://www.googleapis.com/auth/calendar.app.created";
/** Scopes requested wherever a calendar is connected; only `calendarScope` is required. */
export const calendarScopes = [calendarScope, calendarMirrorScope];
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
        timeMin, timeMax, timeZone: "UTC", items: [{ id: "primary" }],
      },
    });
    const calendar = data.calendars?.primary;
    if (!calendar || calendar.errors?.length || !calendar.busy)
      throw new Error(tr("空き状況を取得できません"));
    return busySchema.parse(calendar.busy);
  },
  mirror: undefined as CalendarMirrorGateway | undefined,
};
/** One booking as an event in a staff member's gemihub calendar. */
export type MirrorEvent = { id: string; summary: string; description: string; start: string; end: string };
export type CalendarMirrorGateway = {
  /** Returns the calendar to write to, creating it when `calendarId` is missing or was deleted. */
  ensureCalendar(connection: CalendarConnection, calendarId: string | undefined, summary: string, timeZone: string): Promise<string>;
  listEvents(connection: CalendarConnection, calendarId: string, timeMin: string): Promise<MirrorEvent[]>;
  putEvent(connection: CalendarConnection, calendarId: string, event: MirrorEvent): Promise<void>;
  deleteEvent(connection: CalendarConnection, calendarId: string, eventId: string): Promise<void>;
  deleteCalendar(connection: CalendarConnection, calendarId: string): Promise<void>;
};
const googleStatus = (error: unknown) => Number((error as { response?: { status?: number }; code?: unknown })?.response?.status ?? (error as { code?: unknown })?.code);
const gone = (error: unknown) => [404, 410].includes(googleStatus(error));
function calendarApi(connection: CalendarConnection) {
  const auth = oauth();
  auth.setCredentials({ refresh_token: decrypt(connection.refreshToken) });
  return google.calendar({ version: "v3", auth });
}
const mirrorBody = (event: MirrorEvent) => ({
  id: event.id,
  summary: event.summary,
  description: event.description,
  start: { dateTime: event.start },
  end: { dateTime: event.end },
  status: "confirmed",
  // Shown as free, so nothing that reads this calendar treats a booking as a second blocker.
  transparency: "transparent",
  extendedProperties: { private: { gemihub: "1" } },
});
export const googleCalendarMirror: CalendarMirrorGateway = {
  async ensureCalendar(connection, calendarId, summary, timeZone) {
    const api = calendarApi(connection);
    if (calendarId) {
      try {
        await api.calendars.get({ calendarId });
        return calendarId;
      } catch (error) {
        if (!gone(error)) throw error;
      }
    }
    const { data } = await api.calendars.insert({ requestBody: { summary, timeZone } });
    if (!data.id) throw new Error(tr("カレンダーを作成できません"));
    return data.id;
  },
  async listEvents(connection, calendarId, timeMin) {
    const api = calendarApi(connection);
    const events: MirrorEvent[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await api.events.list({ calendarId, timeMin, privateExtendedProperty: ["gemihub=1"], singleEvents: true, maxResults: 2500, pageToken });
      for (const item of data.items || [])
        if (item.id && item.start?.dateTime && item.end?.dateTime)
          events.push({ id: item.id, summary: item.summary || "", description: item.description || "", start: new Date(item.start.dateTime).toISOString(), end: new Date(item.end.dateTime).toISOString() });
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
    return events;
  },
  async putEvent(connection, calendarId, event) {
    const api = calendarApi(connection);
    try {
      await api.events.insert({ calendarId, requestBody: mirrorBody(event) });
    } catch (error) {
      // The ID already exists, including an event deleted earlier: update it back to confirmed.
      if (googleStatus(error) !== 409) throw error;
      await api.events.update({ calendarId, eventId: event.id, requestBody: mirrorBody(event) });
    }
  },
  async deleteEvent(connection, calendarId, eventId) {
    try { await calendarApi(connection).events.delete({ calendarId, eventId }); } catch (error) { if (!gone(error)) throw error; }
  },
  async deleteCalendar(connection, calendarId) {
    try { await calendarApi(connection).calendars.delete({ calendarId }); } catch (error) { if (!gone(error)) throw error; }
  },
};
calendarGateway.mirror = googleCalendarMirror;
/** Errors that will not clear by retrying: the grant was revoked or the mirror scope was not granted. */
export function mirrorAccessDenied(error: unknown) {
  const status = googleStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const reasons = ((error as { response?: { data?: { error?: { errors?: { reason?: string }[] } } } })?.response?.data?.error?.errors || []).map(item => item.reason);
  if (/invalid_grant/.test(message) || status === 401) return true;
  return status === 403 && !reasons.some(reason => reason && /rateLimit|quota/i.test(reason));
}
export type CalendarGateway = Omit<typeof calendarGateway, "mirror"> & { mirror?: CalendarMirrorGateway };
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
/** A solo owner needs no staff registration; explicit staff assignments remain supported. */
export async function connectOwnerCalendar(store: Store, shop: Shop, config: ShopConfig) {
  const owner = await store.get<User>("user", shop.owner);
  if (!owner?.calendarRefreshToken) return false;
  const account = (await staffAccounts(store, shop)).find(account => account.email === shop.owner);
  const staffId = config.ownerBooking || !config.staff.length ? ownerStaffId : account?.staffId;
  if (!staffId || !bookingStaff(config).some(staff => staff.id === staffId)) return false;
  if ((await connections(store, shop)).some(connection => connection.staffId === staffId && connection.email !== shop.owner)) return false;
  await store.put("calendar", `${shop.id}:${shop.owner}`, { shopId: shop.id, email: shop.owner, staffId, refreshToken: owner.calendarRefreshToken } satisfies CalendarConnection);
  return true;
}
export async function bookingCalendars(store: Store, shop: Shop, config: ShopConfig) {
  const linked = await connections(store, shop);
  if (config.staff.length && !config.ownerBooking) return linked;
  const owner = shop.judge ? undefined : await store.get<User>("user", shop.owner);
  // Resolve the shared judge credential on every request so rotation and disconnect take effect immediately.
  const refreshToken = shop.judge ? await store.ownerToken(shop)
    : owner?.calendarRefreshToken || linked.find(connection => connection.email === shop.owner)?.refreshToken;
  if (!refreshToken && !store.memory) throw Object.assign(new Error(shop.judge ? demoGoogleUnavailable() : tr("店主のGoogleカレンダーへの接続が必要です。店主にGoogleへの再ログインを依頼してください。")), {status:503});
  return [...linked.filter(connection => connection.email !== shop.owner), ...(refreshToken ? [{ shopId: shop.id, email: shop.owner, staffId: ownerStaffId, refreshToken }] : [])];
}
export async function availableSlots(
  store: Store, shop: Shop, config: ShopConfig, date: string, menu: string,
  staff: string | undefined, gateway: CalendarGateway, excludeCheckout?: string,
  optionIds: string[] = [],
) {
  const selection = menuSelection(config, menu, optionIds);
  if (!selection) return [];
  const bookings = [...await store.bookings(shop.id), ...await paymentHolds(store, shop.id, excludeCheckout)];
  // Allocate after adding all busy intervals, so unspecified staff can be assigned.
  if (!z.iso.date().safeParse(date).success) return [];
  // The shop's own day: midnight to midnight in its time zone (23 or 25 hours on US daylight-saving days).
  const timeZone = regionOf(config).timeZone;
  const start = zonedDate(date, "00:00", timeZone);
  const end = zonedDate(new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), "00:00", timeZone);
  bookings.push(...await calendarConflicts(store, shop, config, menu, staff, optionIds, gateway, start.toISOString(), end.toISOString()));
  return slots(config, bookings, date, menu, staff, undefined, optionIds);
}

async function calendarConflicts(store: Store, shop: Shop, config: ShopConfig, menu: string, staff: string | undefined, optionIds: string[], gateway: CalendarGateway, start: string, end: string): Promise<Booking[]> {
  const selection = menuSelection(config, menu, optionIds);
  if (!selection) return [];
  const bookings: Booking[] = [];
  const linked = await bookingCalendars(store, shop, config);
  const relevant = linked.filter(c =>
    bookingStaff(config).some(s => s.id === c.staffId && s.menuIds.includes(menu) && selection.options.every(option => s.menuIds.includes(option.id))) &&
    (!staff || c.staffId === staff),
  );
  try {
    const results = await Promise.all(relevant.map(async c => ({
      staffId: c.staffId,
      busy: busySchema.parse(await gateway.busy(c, start, end)),
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
  return bookings;
}

/** Search the booking window with one Calendar lookup per relevant member. */
export async function nextAvailableSlots(store: Store, shop: Shop, config: ShopConfig, menu: string, staff: string | undefined, gateway: CalendarGateway, optionIds: string[] = [], now = new Date()) {
  const bookings = [...await store.bookings(shop.id), ...await paymentHolds(store, shop.id)];
  const dates = bookingDates(config, now).filter(date => slots(config, bookings, date, menu, staff, now, optionIds).length);
  if (!dates.length) return { date: "", slots: [] };
  const timeZone = regionOf(config).timeZone;
  const start = zonedDate(dates[0], "00:00", timeZone).toISOString();
  const dayAfter = new Date(Date.parse(`${dates.at(-1)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const end = zonedDate(dayAfter, "00:00", timeZone).toISOString();
  bookings.push(...await calendarConflicts(store, shop, config, menu, staff, optionIds, gateway, start, end));
  for (const date of dates) {
    const times = slots(config, bookings, date, menu, staff, now, optionIds);
    if (times.length) return { date, slots: times };
  }
  return { date: "", slots: [] };
}
