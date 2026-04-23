import type { gmail_v1 } from "googleapis";
import { createMagicToken } from "./hubwork-magic-link.server";
import { loadEmailTemplate, renderEmailTemplate } from "./hubwork-email-template.server";
import { sendHtmlEmail } from "./hubwork-mail-send.server";

export const MAGIC_LINK_EXPIRES_MINUTES = 10;

export function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}`;
}

/**
 * Core flow for sending a login magic link: mint a Firestore token, render the
 * login email template, send through Gmail. Shared between the /auth/login
 * action and the registration-duplicate silent-login fallback.
 */
export async function sendLoginMagicLink(params: {
  accessToken: string;
  rootFolderId: string;
  gmailClient: gmail_v1.Gmail;
  accountId: string;
  accountType: string;
  email: string;
  baseUrl: string;
  host: string;
  redirectPath: string;
}): Promise<void> {
  const token = await createMagicToken(params.email, params.accountId, params.accountType);
  const magicLink = `${params.baseUrl}/__gemihub/auth/verify/${token}?redirect=${encodeURIComponent(params.redirectPath)}`;

  const template = await loadEmailTemplate(
    params.accessToken,
    params.rootFolderId,
    params.accountType,
    "login",
  );
  const { subject, html } = renderEmailTemplate(template, {
    magicLink,
    email: params.email,
    accountType: params.accountType,
    siteName: params.host,
    expiresInMinutes: MAGIC_LINK_EXPIRES_MINUTES,
    redirectPath: params.redirectPath,
  });

  await sendHtmlEmail(params.gmailClient, { to: params.email, subject, html });
}

export function getAuthLoginErrorResponse(error: unknown): Response {
  const status =
    typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
        ? error.code
        : undefined;
  const hasScopeError =
    error instanceof Error && /insufficient authentication scopes/i.test(error.message);
  const message =
    hasScopeError
      ? "Hubwork Gmail/Sheets scopes are required"
      : "Failed to send login email";

  if (hasScopeError || status === 401 || status === 403) {
    return Response.json({ error: message }, { status: 403 });
  }
  return Response.json({ error: message }, { status: 500 });
}
