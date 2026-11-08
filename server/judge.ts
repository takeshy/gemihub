import { tr, type Locale } from "../shared/i18n.ts";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { callerNumber, comparablePhone, type PhoneSettings } from "../shared/phone.ts";

// Hackathon judge access, operator administration and invitation-only sign-up.
// Secrets arrive through the environment (Secret Manager in production) and never reach the browser,
// except the invitation URL shown to administrators.

const sha = (value: string) => createHash("sha256").update(value).digest();
/** Constant-time comparison of a submitted secret against a configured one. */
export function secretMatches(input: string, configured: string) {
  return !!configured && timingSafeEqual(sha(input), sha(configured));
}

export const judgeInvite = () => process.env.JUDGE_INVITE || "";
export function judgeUntil(): Date | undefined {
  const value = process.env.JUDGE_UNTIL;
  if (!value) return;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
/** Judge access needs an unguessable invitation and a future end time. */
export function judgeActive(now = Date.now()) {
  const until = judgeUntil();
  return judgeInvite().length >= 32 && !!until && until.getTime() > now;
}
/** Accept US and Japanese national numbers, or international numbers with a country code. */
export function judgeCallerNumber(value: string) {
  const text = value.normalize("NFKC").trim();
  if (!/^\+?[\d ().-]+$/.test(text) || !callerNumber(text)) return undefined;
  const number = comparablePhone(text);
  const national = /^\+(?:1[2-9]\d{9}|81[1-9]\d{8,9})$/.test(number);
  const international = /^(?:\+|00)/.test(text) && /^\+[2-9]\d{7,14}$/.test(number);
  return (national || international) && callerNumber(number) ? number : undefined;
}
export function judgePhoneSettings(locale: Locale): PhoneSettings | undefined {
  const twilioNumber = judgeCallerNumber((locale === "ja" ? process.env.JUDGE_PHONE_NUMBER_JA : process.env.JUDGE_PHONE_NUMBER) || "");
  if (twilioNumber && judgeActive()) return { twilioNumber, enabled: true, cashBookings: true };
}
export type JudgePhoneRegistration = { shopId: string; caller: string };
/** Stable per shop, changes after a reset or invitation rotation; never derived from public IDs alone. */
export function judgePhonePin(shopId: string) {
  const secret = process.env.SESSION_SECRET;
  if (!judgeActive() || !secret || secret.length < 32) return "";
  // The invitation is shared with judges, so only the server's private key can derive other shops' PINs.
  const bytes = createHmac("sha256", secret).update(JSON.stringify(["judge-phone-pin", judgeInvite(), shopId])).digest();
  // 00000000 routes a shared number to its original, non-judge shop.
  return (bytes.readUInt32BE(0) % 100000000 || 1).toString().padStart(8, "0");
}
export function judgeAiLimit() {
  const value = Number(process.env.JUDGE_AI_LIMIT || 200);
  return Number.isInteger(value) && value > 0 ? value : 200;
}
export const judgeEmailDomain = "judge.gemihub.invalid";
export const isJudgeEmail = (email: string) => email.endsWith(`@${judgeEmailDomain}`);
export const isJudgeCustomerEmail = (email: string) => email.startsWith("judge-customer-") && isJudgeEmail(email);

export function adminEmails() {
  return new Set((process.env.ADMIN_EMAILS || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
}
export const isAdmin = (email: string | undefined) => !!email && !isJudgeEmail(email) && adminEmails().has(email.toLowerCase());

export const accessPasswordEnabled = () => !!process.env.ACCESS_PASSWORD;
export const accessPasswordMatches = (input: string) => secretMatches(input, process.env.ACCESS_PASSWORD || "");

/** The operator's Drive/Calendar connection for judge shops. Its refresh token is encrypted. */
export type DemoGoogle = { email: string; refreshToken: string; connectedAt: string; connectedBy: string; rootFolderId?: string };
/** A mail a judge shop would have sent. Judge access never sends mail. */
export type JudgeMail = { id: string; shopId: string; owner: string; to: string; cc?: string[]; subject: string; body: string; at: string };
export type JudgeUsage = { email: string; count: number; lastUsedAt?: string; resets?: { day: string; count: number } };

export const demoGoogleUnavailable = () => tr("デモ環境の準備中です。しばらくしてからお試しください。");
