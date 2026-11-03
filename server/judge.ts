import { tr } from "../shared/i18n.ts";
import { createHash, timingSafeEqual } from "node:crypto";

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
