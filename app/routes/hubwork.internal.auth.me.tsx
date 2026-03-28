import type { Route } from "./+types/hubwork.internal.auth.me";
import { resolveAccountWithTokens } from "~/services/hubwork-account-resolver.server";
import { getSettings } from "~/services/user-settings.server";
import { getContactEmail } from "~/services/hubwork-session.server";
import { buildCurrentUser } from "~/services/hubwork-page-renderer.server";

const ACCOUNT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (!type || !ACCOUNT_TYPE_PATTERN.test(type)) {
    return Response.json({ error: "Valid query parameter 'type' is required" }, { status: 400 });
  }

  const email = await getContactEmail(request, type);
  if (!email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { account, tokens } = await resolveAccountWithTokens(request);
  if (account.plan !== "pro" && account.plan !== "granted") {
    return Response.json({ error: "Hubwork Pro subscription required" }, { status: 403 });
  }
  const { accessToken, rootFolderId } = tokens;
  const settings = await getSettings(accessToken, rootFolderId);

  const accountType = settings?.hubwork?.accounts?.[type];
  const resolvedSpreadsheetId = accountType?.identity?.spreadsheetId || settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
  if (!resolvedSpreadsheetId) {
    return Response.json({ error: "Hubwork not configured" }, { status: 500 });
  }

  if (!accountType) {
    return Response.json({ error: "Account type not configured" }, { status: 500 });
  }

  try {
    const userData = await buildCurrentUser(
      accessToken,
      resolvedSpreadsheetId,
      email,
      accountType.data,
    );
    return Response.json({ type, email, ...userData });
  } catch (e) {
    console.error("[hubwork-auth-me] Failed to build currentUser:", e);
    return Response.json({ error: "Failed to load user data" }, { status: 500 });
  }
}
