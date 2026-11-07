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
  /** Shop-specific conversation guidance; inventory and payment rules remain authoritative. */
  rules: z.string().trim().max(6000).optional(),
}).strict();
export const phoneRulesProposalSchema = z.object({
  rules: z.string().trim().max(6000),
  explanation: z.string().trim().min(1).max(1500),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
}).strict();
export type PhoneRulesProposal = z.infer<typeof phoneRulesProposalSchema>;
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
  const { start, end, weekdays } = settings.hours, time = `${get("hour")}:${get("minute")}`;
  // Hours such as 22:00-02:00 cross midnight; the early morning belongs to the day they started.
  const overnight = start > end, afterMidnight = overnight && time < end;
  if (weekdays && !weekdays.includes(afterMidnight ? (weekday + 6) % 7 : weekday)) return false;
  return overnight ? afterMidnight || time >= start : time >= start && time < end;
}

const anonymousCallers = new Set(["anonymous", "restricted", "unavailable", "private", "blocked", "unknown"]);
// Keypad spellings of ANONYMOUS, RESTRICTED, BLOCKED, UNKNOWN and UNAVAILABLE. Carriers can present
// these in place of a withheld number, so they must never identify a customer.
const withheldCallerDigits = new Set(["266696687", "7378742833", "2562533", "8656696", "86282452253"]);
/** Returns the caller ID in a usable form, or undefined for withheld/blocked callers. */
export function callerNumber(from: string | null | undefined): string | undefined {
  const value = (from || "").trim();
  if (!value || anonymousCallers.has(value.toLowerCase())) return undefined;
  const digits = value.replace(/\D/g, "");
  if (withheldCallerDigits.has(digits) || digits.length < 6 || digits.length > 15) return undefined;
  // The + is what separates an international number from a national one.
  return value.startsWith("+") ? `+${digits}` : digits;
}
export const normalizeNumber = (value: string | null | undefined) => (value || "").replace(/\D/g, "");
/** Canonical forms for the supported shop countries, Japan and the US/NANP. */
export function comparablePhone(value: string) {
  const text = value.normalize("NFKC").trim();
  let digits = normalizeNumber(text), international = text.startsWith("+");
  // 00 is the international dialling prefix, as in 0081...
  if (!international && digits.startsWith("00")) { digits = digits.slice(2); international = true; }
  // +81-90-... is also commonly written with the domestic trunk zero: +81-090-...
  if (/^810[1-9]\d{8,9}$/.test(digits)) digits = `81${digits.slice(3)}`;
  if (/^81[1-9]\d{8,9}$/.test(digits)) return `+${digits}`;
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (!international && /^0[1-9]\d{8,9}$/.test(digits)) return `+81${digits.slice(1)}`;
  if (!international && /^[2-9]\d{9}$/.test(digits)) return `+1${digits}`;
  return digits ? `+${digits}` : "";
}
export function samePhoneNumber(a: string | null | undefined, b: string | null | undefined) {
  const left = comparablePhone(a || ""), right = comparablePhone(b || "");
  return !!left && left === right;
}
