import { z } from "zod";
import { tr } from "./i18n.ts";

// A shop's country decides its currency and time zone. Prices, slots, payments and dates all
// follow the shop, not the viewer; only the display language follows the viewer.

export const usTimeZones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"] as const;
export const countries = ["JP", "US"] as const;
export type Country = typeof countries[number];
export type Currency = "JPY" | "USD";
export const regionSchema = z.object({
  country: z.enum(countries),
  timeZone: z.string().max(64),
}).superRefine((value, ctx) => {
  if (value.country === "JP" ? value.timeZone !== "Asia/Tokyo" : !(usTimeZones as readonly string[]).includes(value.timeZone))
    ctx.addIssue({ code: "custom", message: tr("お店の国に対応するタイムゾーンを選んでください") });
});
export type Region = z.infer<typeof regionSchema>;
export const defaultRegion: Region = { country: "JP", timeZone: "Asia/Tokyo" };
/** The region of a shop; shops created before regions existed are Japanese. */
export const regionOf = (config?: { region?: Region } | null): Region => config?.region || defaultRegion;
export const currencyOf = (region: Region): Currency => region.country === "US" ? "USD" : "JPY";
export const currencyDigits = (currency: Currency) => currency === "USD" ? 2 : 0;

/** Prices are stored in major units (yen, dollars); payments in minor units (yen, cents). */
export const toMinor = (amount: number, currency: Currency) => Math.round(amount * 10 ** currencyDigits(currency));
export const fromMinor = (minor: number, currency: Currency) => minor / 10 ** currencyDigits(currency);
/** The PayPal amount string for a minor-unit amount, such as "5500" or "55.00". */
export const paypalValue = (minor: number, currency: Currency) => fromMinor(minor, currency).toFixed(currencyDigits(currency));
/** Whether a price is representable in the currency: whole yen, or dollars with at most two decimals. */
export const validPrice = (price: number, currency: Currency) => Number.isFinite(price) && price >= 0 && Number.isSafeInteger(toMinor(price, currency)) && Math.abs(toMinor(price, currency) - price * 10 ** currencyDigits(currency)) < 1e-6;

export function formatMoney(amount: number, currency: Currency, locale = "ja-JP") {
  // The ASCII yen sign matches the rest of the interface; ja-JP would render a full-width one.
  return new Intl.NumberFormat(currency === "JPY" ? "en-US" : locale, { style: "currency", currency, minimumFractionDigits: currencyDigits(currency), maximumFractionDigits: currencyDigits(currency) }).format(amount);
}
export const formatMinor = (minor: number, currency: Currency, locale?: string) => formatMoney(fromMinor(minor, currency), currency, locale);

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(instant: number, timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timeZone, format);
  }
  const value = Object.fromEntries(format.formatToParts(new Date(instant)).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  return value as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}
/** Minutes the zone is ahead of UTC at an instant (540 for Japan; DST-aware for the US). */
export function offsetMinutes(instant: number, timeZone: string) {
  const p = parts(instant, timeZone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000) / 60000);
}
/** Wall-clock time in a zone. Gaps are invalid; repeated times use the earlier occurrence. */
export function zonedDate(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([-86400000, 0, 86400000].map(delta => offsetMinutes(wall + delta, timeZone)));
  const candidates = [...offsets].map(offset => wall - offset * 60000).filter(instant => {
    const p = parts(instant, timeZone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
  });
  return new Date(candidates.length ? Math.min(...candidates) : NaN);
}
/** The calendar date ("YYYY-MM-DD") of an instant in a zone. */
export function dateIn(instant: Date | number | string, timeZone: string) {
  const p = parts(new Date(instant).getTime(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
/** The wall-clock "YYYY-MM-DDTHH:MM" of an instant in a zone, for datetime-local inputs. */
export function localDateTime(instant: Date | number | string, timeZone: string) {
  const p = parts(new Date(instant).getTime(), timeZone);
  return `${dateIn(instant, timeZone)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
/** The weekday (0 = Sunday) of a calendar date; it does not depend on the zone. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** A new shop's region from the first visit: Japanese browsers get Japan, every other browser the US. */
export function regionForBrowser(language: string | undefined, timeZone: string | undefined): Region {
  if (!language || language === "*" || /^ja\b/i.test(language)) return defaultRegion;
  return { country: "US", timeZone: timeZone && (usTimeZones as readonly string[]).includes(timeZone) ? timeZone : "America/New_York" };
}
