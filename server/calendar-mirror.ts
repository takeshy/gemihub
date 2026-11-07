import { createHash } from "node:crypto";
import { regionOf } from "../shared/region.ts";
import { bookingStaff, type Booking, type ShopConfig } from "./domain.ts";
import type { Store, Shop, User } from "./store.ts";
import { bookingCalendars, connections, mirrorAccessDenied, type CalendarConnection, type CalendarGateway, type MirrorEvent } from "./calendar.ts";

/**
 * Staff calendar mirror: each connected staff member gets a secondary Google calendar created by gemihub,
 * holding their active bookings as events. It is for reading only. Availability still comes from each
 * member's primary calendar, so these events never block slots.
 */
export type CalendarMirror = {
  shopId: string;
  email: string;
  staffId: string;
  calendarId?: string;
  /** Digest of the refresh token in use, so a reconnection retries a calendar that was refused. */
  token: string;
  fingerprint?: string;
  syncedAt?: string;
  /** Set when Google refused access; nothing is retried until the member reconnects. */
  denied?: string;
};
const mirrorKind = "calendarMirror";
const mirrorKey = (shopId: string, email: string) => `${shopId}:${email}`;
/** Past bookings stay in the calendar as history; only this recent span is reconciled. */
const historyMs = 7 * 86400000;
/** Even with no booking changes, re-read the calendar this often to restore events someone deleted. */
const refreshMs = 6 * 3600000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
/** Event IDs allow base32hex characters; a hex digest of the booking ID is stable and valid. */
export const mirrorEventId = (bookingId: string) => `gh${hash(bookingId).slice(0, 40)}`;

export function mirrorEvents(config: ShopConfig, bookings: Booking[], staffId: string, now: Date, origin?: string): MirrorEvent[] {
  const since = now.getTime() - historyMs;
  return bookings
    .filter(booking => booking.staffId === staffId && booking.status === "active" && Date.parse(booking.end) >= since)
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
    .map(booking => {
      const menus = booking.items?.length ? booking.items.map(item => item.name) : [config.menus.find(menu => menu.id === booking.menuId)?.name || booking.menuId];
      // Name and service only: contact details stay in gemihub, not in a staff member's own Google account.
      const link = origin ? `${origin}/?shop=${encodeURIComponent(booking.shopId)}&tab=bookings` : "";
      return {
        id: mirrorEventId(booking.id),
        summary: `${booking.name} · ${menus.join(" + ")}`,
        description: [booking.message.trim(), link].filter(Boolean).join("\n\n"),
        start: new Date(booking.start).toISOString(),
        end: new Date(booking.end).toISOString(),
      };
    });
}

const same = (a: MirrorEvent, b: MirrorEvent) => a.summary === b.summary && a.description === b.description && a.start === b.start && a.end === b.end;

async function linkedCalendars(store: Store, shop: Shop, config: ShopConfig) {
  let linked: CalendarConnection[];
  try { linked = await bookingCalendars(store, shop, config); }
  // An owner who has not granted Calendar yet must not stop the staff calendars.
  catch { linked = (await connections(store, shop)).filter(connection => connection.email !== shop.owner); }
  const staff = new Set(bookingStaff(config).map(member => member.id));
  return linked.filter(connection => staff.has(connection.staffId));
}

/** The token that can still delete a member's calendar after their connection was removed from the shop. */
async function removalToken(store: Store, shop: Shop, email: string) {
  const stored = await store.get<CalendarConnection>("calendar", mirrorKey(shop.id, email));
  if (stored?.refreshToken) return stored.refreshToken;
  if (email !== shop.owner) return undefined;
  const owner = await store.get<User>("user", shop.owner);
  return owner?.calendarRefreshToken || owner?.refreshToken;
}

/** Deletes the gemihub calendar of a member who leaves or disconnects. Call it before their token is deleted. */
export async function removeStaffCalendar(store: Store, shop: Shop, email: string, gateway: CalendarGateway) {
  const state = await store.get<CalendarMirror>(mirrorKind, mirrorKey(shop.id, email));
  if (!state) return;
  const refreshToken = await removalToken(store, shop, email);
  if (state.calendarId && refreshToken && gateway.mirror) {
    try {
      await gateway.mirror.deleteCalendar({ shopId: shop.id, email, staffId: state.staffId, refreshToken }, state.calendarId);
    } catch (error) {
      // Without access the calendar can only be removed by its owner; anything else is retried by the scheduled sync.
      if (!mirrorAccessDenied(error)) throw error;
    }
  }
  await store.delete(mirrorKind, mirrorKey(shop.id, email));
}

const running = new Set<string>();
/**
 * Brings every connected member's gemihub calendar in line with their active bookings.
 * Runs every minute and calls Google only when a member's bookings changed or the calendar is due a re-read.
 */
export async function syncStaffCalendars(store: Store, shop: Shop, gateway: CalendarGateway, options: { now?: Date; origin?: string; report?: (error: unknown) => void } = {}) {
  const mirror = gateway.mirror;
  const config = shop.published;
  // Judge shops share one demo Google account, so they never get staff calendars.
  if (!mirror || !config || shop.judge || running.has(shop.id)) return;
  running.add(shop.id);
  try {
    const now = options.now || new Date();
    const linked = await linkedCalendars(store, shop, config);
    const states = (await store.list<CalendarMirror>(mirrorKind)).filter(state => state.shopId === shop.id);
    const bookings = await store.bookings(shop.id);
    const summary = `gemihub · ${config.name}`;
    const timeZone = regionOf(config).timeZone;
    for (const connection of linked) {
      const key = mirrorKey(shop.id, connection.email);
      let state = states.find(item => item.email === connection.email);
      const token = hash(connection.refreshToken);
      if (state?.denied && state.token === token) continue;
      const desired = mirrorEvents(config, bookings, connection.staffId, now, options.origin);
      const fingerprint = hash(JSON.stringify([connection.staffId, summary, desired]));
      if (state && !state.denied && state.token === token && state.staffId === connection.staffId && state.fingerprint === fingerprint
        && state.syncedAt && now.getTime() - Date.parse(state.syncedAt) < refreshMs) continue;
      try {
        const calendarId = await mirror.ensureCalendar(connection, state?.calendarId, summary, timeZone);
        // Save the calendar at once, so a failure below never leads to a second calendar.
        state = { shopId: shop.id, email: connection.email, staffId: connection.staffId, calendarId, token, ...(state?.calendarId === calendarId && state.fingerprint ? { fingerprint: state.fingerprint, syncedAt: state.syncedAt } : {}) };
        await store.put(mirrorKind, key, state);
        const existing = new Map((await mirror.listEvents(connection, calendarId, new Date(now.getTime() - historyMs).toISOString())).map(event => [event.id, event]));
        for (const event of desired) {
          const current = existing.get(event.id);
          if (!current || !same(current, event)) await mirror.putEvent(connection, calendarId, event);
          existing.delete(event.id);
        }
        // Cancelled, no-show, reassigned and deleted bookings.
        for (const id of existing.keys()) await mirror.deleteEvent(connection, calendarId, id);
        await store.put(mirrorKind, key, { ...state, fingerprint, syncedAt: now.toISOString() } satisfies CalendarMirror);
      } catch (error) {
        if (mirrorAccessDenied(error)) {
          await store.put(mirrorKind, key, { ...(state || { shopId: shop.id, email: connection.email }), staffId: connection.staffId, token, denied: error instanceof Error ? error.message : String(error) } satisfies CalendarMirror);
        } else options.report?.(error);
      }
    }
    // Members who left, disconnected or were removed from the staff list.
    for (const state of states.filter(item => !linked.some(connection => connection.email === item.email))) {
      try { await removeStaffCalendar(store, shop, state.email, gateway); } catch (error) { options.report?.(error); }
    }
  } finally {
    running.delete(shop.id);
  }
}
