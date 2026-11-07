import { z } from "zod";

// Phone reception settings are shared with the owner screen. Keep this module free of server-only
// imports so the browser can parse and display the same schema.

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const phoneHoursSchema = z.object({
  start: clock,
  end: clock,
  /** ISO weekdays (0 = Sunday). Absent means every day. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
}).strict();
export const phoneSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** The Twilio number in E.164 form (for example +81...). Calls to it reach this shop. */
  twilioNumber: z.string().trim().max(30).default(""),
  /** When the AI answers. Absent means no time restriction while enabled. */
  hours: phoneHoursSchema.optional(),
  /** Whether cash bookings may be taken by phone. Rules still decide which dates are allowed. */
  cashBookings: z.boolean().default(true),
  /** Optional extra opening line. */
  greeting: z.string().trim().max(300).optional(),
}).strict();
export type PhoneSettings = z.infer<typeof phoneSettingsSchema>;
export const defaultPhoneSettings: PhoneSettings = { enabled: false, twilioNumber: "", cashBookings: true };
export function phoneSettingsOf(shop: { phone?: unknown } | null | undefined): PhoneSettings {
  const parsed = phoneSettingsSchema.safeParse(shop?.phone || {});
  return parsed.success ? parsed.data : { ...defaultPhoneSettings };
}
/** Local time check for the AI's configured reception hours. */
export function withinPhoneHours(settings: PhoneSettings, now = new Date(), timeZone = "Asia/Tokyo") {
  if (!settings.hours) return true;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  if (weekday < 0) return true;
  if (settings.hours.weekdays && !settings.hours.weekdays.includes(weekday)) return false;
  const time = `${get("hour")}:${get("minute")}`;
  return time >= settings.hours.start && time < settings.hours.end;
}

const anonymousCallers = new Set(["anonymous", "restricted", "unavailable", "private", "blocked", "unknown"]);
/** Returns the caller ID in a usable form, or undefined for withheld/blocked callers. */
export function callerNumber(from: string | null | undefined): string | undefined {
  const value = (from || "").trim();
  if (!value || anonymousCallers.has(value.toLowerCase())) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 ? digits : undefined;
}
export const normalizeNumber = (value: string | null | undefined) => (value || "").replace(/\D/g, "");
/** Canonical forms for the supported shop countries, Japan and the US/NANP. */
function comparablePhone(value: string) {
  const digits = normalizeNumber(value.normalize("NFKC"));
  if (/^81[1-9]\d{8,9}$/.test(digits)) return `+${digits}`;
  if (/^0[1-9]\d{8,9}$/.test(digits)) return `+81${digits.slice(1)}`;
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (!value.trim().startsWith("+") && /^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  return digits ? `+${digits}` : "";
}
export function samePhoneNumber(a: string | null | undefined, b: string | null | undefined) {
  const left = comparablePhone(a || ""), right = comparablePhone(b || "");
  return !!left && left === right;
}
/** The caller ID read back to the caller, digit groups separated for clarity. */
export function spokenPhoneNumber(caller: string) {
  return caller.replace(/\D/g, "").split("").join(" ");
}
