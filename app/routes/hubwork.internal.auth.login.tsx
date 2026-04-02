import type { Route } from "./+types/hubwork.internal.auth.login";
import { resolveAccountWithTokens } from "~/services/hubwork-account-resolver.server";
import { getSettings } from "~/services/user-settings.server";
import { createMagicToken } from "~/services/hubwork-magic-link.server";
import { checkRateLimit } from "~/services/hubwork-rate-limiter.server";
import { validateRedirectUrl, validateEmailHeader, validateOrigin } from "~/utils/security";
import { google } from "googleapis";

const ACCOUNT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim().replace(/\u3000/g, "").replace(/\s+/g, "");
}

export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const type = (body.type as string || "").trim();
  const rawEmail = (body.email as string || "").trim();
  const redirectPath = validateRedirectUrl(body.redirect as string | null, "/");

  if (!type || !ACCOUNT_TYPE_PATTERN.test(type)) {
    return Response.json({ error: "Valid account type is required" }, { status: 400 });
  }

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail);

  // Rate limit (after validation to prevent invalid requests consuming quota)
  if (!checkRateLimit(`magic:email:${email}`, 3, 10 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`magic:ip:${clientIp}`, 10, 10 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { account, tokens } = await resolveAccountWithTokens(request);
  if (account.plan !== "pro" && account.plan !== "granted") {
    return Response.json({ error: "Hubwork Pro subscription required" }, { status: 403 });
  }
  const { accessToken, rootFolderId } = tokens;
  const settings = await getSettings(accessToken, rootFolderId);

  const { resolveAccountType } = await import("~/types/settings");
  const resolved = resolveAccountType(settings?.hubwork?.accounts, type);
  const resolvedSpreadsheetId = resolved?.accountType.identity.spreadsheetId || settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
  if (!resolved || !resolvedSpreadsheetId) {
    console.warn(`[auth-login] accounts[${type}] not found or spreadsheetId missing`);
    return Response.json({ ok: true });
  }

  const { identity } = resolved.accountType;

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const sheetsClient = google.sheets({ version: "v4", auth: oauth2Client });

    console.log(`[auth-login] Looking up email in sheet "${identity.sheet}" column "${identity.emailColumn}"`);

    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: resolvedSpreadsheetId,
      range: `'${identity.sheet.replace(/'/g, "''")}'`,
    });
    const rows = res.data.values || [];
    if (rows.length < 2) {
      console.warn(`[auth-login] Sheet "${identity.sheet}" has no data rows`);
      return Response.json({ ok: true });
    }

    const headers = rows[0] as string[];
    const emailIdx = headers.indexOf(identity.emailColumn);
    if (emailIdx === -1) {
      console.warn(`[auth-login] Column "${identity.emailColumn}" not found in headers: ${headers.join(", ")}`);
      return Response.json({ ok: true });
    }

    const exists = rows.slice(1).some((row) =>
      normalizeEmail((row as string[])[emailIdx] || "") === email
    );

    if (!exists) {
      console.warn(`[auth-login] Email not found in sheet`);
      return Response.json({ ok: true });
    }

    console.log(`[auth-login] Email found, creating token and sending magic link`);

    const token = await createMagicToken(email, account.id, type);

    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    const baseUrl = `${proto}://${url.host}`;
    const magicLink = `${baseUrl}/__gemihub/auth/verify/${token}?redirect=${encodeURIComponent(redirectPath)}`;

    validateEmailHeader(email, "to");

    const gmailClient = google.gmail({ version: "v1", auth: oauth2Client });
    const subject = "Login Link";
    const bodyHtml = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Login</h2>
        <p>Click the link below to log in. This link expires in 10 minutes.</p>
        <p><a href="${magicLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Log In</a></p>
        <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;

    const messageParts = [
      `To: ${email}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      bodyHtml,
    ];
    const rawMessage = messageParts.join("\r\n");
    const encodedMessage = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmailClient.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedMessage },
    });
    console.log(`[auth-login] Magic link sent successfully`);
  } catch (e) {
    console.error(`[auth-login] Error:`, e);
  }

  return Response.json({ ok: true });
}
