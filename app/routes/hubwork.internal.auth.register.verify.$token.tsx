import type { Route } from "./+types/hubwork.internal.auth.register.verify.$token";
import { resolveAccountWithTokens } from "~/services/hubwork-account-resolver.server";
import { getSettings } from "~/services/user-settings.server";
import { checkRateLimit } from "~/services/hubwork-rate-limiter.server";
import { validateRedirectUrl } from "~/utils/security";
import {
  appendRegistrationRow,
  verifyPendingRegistration,
} from "~/services/hubwork-registration.server";
import { createContactSession } from "~/services/hubwork-session.server";
import { resolveAccountType } from "~/types/settings";
import { google } from "googleapis";

export async function loader({ request, params }: Route.LoaderArgs) {
  // HEAD short-circuit: email clients prefetch links and would otherwise
  // consume the token. Mirror the login verify route's behavior.
  if (request.method === "HEAD") {
    return new Response(null, { status: 200 });
  }

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`register-verify:ip:${clientIp}`, 10, 10 * 60 * 1000)) {
    throw new Response("Too many verification attempts. Please try again later.", { status: 429 });
  }

  const token = params.token;
  if (!token) {
    throw new Response("Invalid token", { status: 400 });
  }

  const result = await verifyPendingRegistration(token);
  if (!result) {
    throw new Response("Token is invalid or expired", { status: 401 });
  }

  const url = new URL(request.url);
  const redirectPath = validateRedirectUrl(url.searchParams.get("redirect"), "/");

  const { tokens } = await resolveAccountWithTokens(request);
  const { accessToken, rootFolderId } = tokens;

  const settings = await getSettings(accessToken, rootFolderId);
  const resolved = resolveAccountType(settings?.hubwork?.accounts, result.type);
  const spreadsheetId =
    resolved?.accountType.identity.spreadsheetId || settings?.hubwork?.spreadsheets?.[0]?.id;

  if (!resolved || !spreadsheetId) {
    throw new Response("Registration is not configured for this account type", { status: 500 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const sheetsClient = google.sheets({ version: "v4", auth: oauth2Client });

  await appendRegistrationRow(
    sheetsClient,
    spreadsheetId,
    resolved.accountType.identity.sheet,
    resolved.accountType.identity.emailColumn,
    result.email,
    result.fields,
  );

  return createContactSession(result.email, result.type, redirectPath);
}
