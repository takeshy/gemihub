import type { Route } from "./+types/hubwork.internal.auth.register";
import { resolveAccountWithTokens } from "~/services/hubwork-account-resolver.server";
import { getSettings } from "~/services/user-settings.server";
import { checkRateLimit } from "~/services/hubwork-rate-limiter.server";
import { validateRedirectUrl, validateOrigin } from "~/utils/security";
import { loadEmailTemplate, renderEmailTemplate } from "~/services/hubwork-email-template.server";
import { sendHtmlEmail } from "~/services/hubwork-mail-send.server";
import {
  createPendingRegistration,
  emailExistsInSheet,
  validateRegistrationFields,
} from "~/services/hubwork-registration.server";
import { resolveAccountType } from "~/types/settings";
import {
  MAGIC_LINK_EXPIRES_MINUTES,
  getBaseUrl,
  getAuthLoginErrorResponse,
  sendLoginMagicLink,
} from "./hubwork.internal.auth.login";
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
  const submittedFields = (body.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
    ? body.fields
    : {}) as Record<string, unknown>;
  const redirectPath = validateRedirectUrl(body.redirect as string | null, "/");

  if (!type || !ACCOUNT_TYPE_PATTERN.test(type)) {
    return Response.json({ error: "Valid account type is required" }, { status: 400 });
  }
  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail);

  if (!checkRateLimit(`register:email:${email}`, 3, 10 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`register:ip:${clientIp}`, 10, 10 * 60 * 1000)) {
    return Response.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { account, tokens } = await resolveAccountWithTokens(request);
  if (account.plan !== "pro" && account.plan !== "granted") {
    return Response.json({ error: "Hubwork Pro subscription required" }, { status: 403 });
  }
  const { accessToken, rootFolderId } = tokens;

  const settings = await getSettings(accessToken, rootFolderId);
  const resolved = resolveAccountType(settings?.hubwork?.accounts, type);
  const resolvedSpreadsheetId =
    resolved?.accountType.identity.spreadsheetId || settings?.hubwork?.spreadsheets?.[0]?.id;

  if (!resolved || !resolvedSpreadsheetId) {
    return Response.json({ error: "Registration is not configured for this account type" }, { status: 400 });
  }

  const register = resolved.accountType.register;
  if (!register) {
    return Response.json({ error: "Registration is not enabled for this account type" }, { status: 400 });
  }

  const validation = validateRegistrationFields(register.fields, submittedFields);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const sheetsClient = google.sheets({ version: "v4", auth: oauth2Client });
    const gmailClient = google.gmail({ version: "v1", auth: oauth2Client });

    const exists = await emailExistsInSheet(
      sheetsClient,
      resolvedSpreadsheetId,
      resolved.accountType.identity.sheet,
      resolved.accountType.identity.emailColumn,
      email,
    );

    if (exists) {
      const policy = register.duplicatePolicy || "silent-login";
      if (policy === "reject") {
        // Preserve a generic response to avoid leaking registration status.
        return Response.json({ ok: true });
      }
      // silent-login: send a login link instead of a registration link.
      const url = new URL(request.url);
      await sendLoginMagicLink({
        accessToken,
        rootFolderId,
        gmailClient,
        accountId: account.id,
        accountType: resolved.key,
        email,
        baseUrl: getBaseUrl(request),
        host: url.host,
        redirectPath,
      });
      return Response.json({ ok: true });
    }

    const token = await createPendingRegistration({
      accountId: account.id,
      type: resolved.key,
      email,
      fields: validation.values,
    });

    const baseUrl = getBaseUrl(request);
    const registerLink = `${baseUrl}/__gemihub/auth/register/verify/${token}?redirect=${encodeURIComponent(redirectPath)}`;

    const template = await loadEmailTemplate(accessToken, rootFolderId, resolved.key, "register");
    const url = new URL(request.url);
    // Spread user fields first so built-in variables (registerLink/email/etc.)
    // can't be overridden by a maliciously-named form field.
    const { subject, html } = renderEmailTemplate(template, {
      ...validation.values,
      registerLink,
      email,
      accountType: resolved.key,
      siteName: url.host,
      expiresInMinutes: MAGIC_LINK_EXPIRES_MINUTES,
      redirectPath,
    });

    await sendHtmlEmail(gmailClient, { to: email, subject, html });
    console.log(`[auth-register] Registration link sent to ${email}`);
  } catch (e) {
    console.error(`[auth-register] Error:`, e);
    return getAuthLoginErrorResponse(e);
  }

  return Response.json({ ok: true });
}
