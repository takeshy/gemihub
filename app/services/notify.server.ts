/**
 * Outbound notifications — Phase 5e-step3.
 *
 * Pluggable interface so we can swap SMTP / SendGrid / SES later without
 * touching call sites. Default behavior in dev (no SMTP_HOST configured)
 * is to log the invite URL to stderr — admins copy/paste during testing.
 */

import type { gmail_v1 } from "googleapis";
import type { OrgInvite } from "./invites.server";
import { sendHtmlEmail } from "./hubwork-mail-send.server";

export interface InviteEmailContext {
  invite: OrgInvite;
  /** Absolute URL the invitee should open. */
  inviteUrl: string;
  /** Display name for the org (falls back to the org id). */
  orgDisplayName: string;
  /** Gmail client authorized as the administrator sending the invitation. */
  gmailClient: gmail_v1.Gmail;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Send an organization invitation through the inviting administrator's
 * connected Google account.
 */
export async function sendInviteEmail(ctx: InviteEmailContext): Promise<void> {
  const orgName = escapeHtml(ctx.orgDisplayName);
  const inviter = escapeHtml(ctx.invite.invitedByEmail);
  const inviteUrl = escapeHtml(ctx.inviteUrl);
  const expiresAt = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(ctx.invite.expiresAt));

  await sendHtmlEmail(ctx.gmailClient, {
    to: ctx.invite.email,
    subject: `${ctx.orgDisplayName}への招待が届いています`,
    html: `<!doctype html><html lang="ja"><body style="font-family:system-ui,sans-serif;line-height:1.7;color:#1f2937"><h2>${orgName}へのご招待</h2><p>${inviter}さんから、GemiHubの組織「${orgName}」へ招待されました。</p><p><a href="${inviteUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none">招待を確認する</a></p><p style="font-size:13px;color:#6b7280">有効期限: ${escapeHtml(expiresAt)}<br>ボタンを開けない場合は、次のURLをブラウザへ貼り付けてください。<br><a href="${inviteUrl}">${inviteUrl}</a></p></body></html>`,
  });
}

/**
 * Build the absolute invite URL using the request's origin. The `/invite/:token`
 * route handles acceptance.
 */
export function inviteUrlFor(request: Request, token: string): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}/invite/${encodeURIComponent(token)}`;
}
