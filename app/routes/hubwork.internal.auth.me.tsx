import type { Route } from "./+types/hubwork.internal.auth.me";
import { resolveAccountWithTokens } from "~/services/hubwork-account-resolver.server";
import { getSettings } from "~/services/user-settings.server";
import { getContactEmail } from "~/services/hubwork-session.server";
import { buildCurrentUser } from "~/services/hubwork-page-renderer.server";
import { readIdeMockFile } from "~/services/hubwork-ide-mock.server";

const ACCOUNT_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (!type || !ACCOUNT_TYPE_PATTERN.test(type)) {
    return Response.json({ error: "Valid query parameter 'type' is required" }, { status: 400 });
  }

  // Try Hubwork account resolution first
  let account, tokens;
  try {
    ({ account, tokens } = await resolveAccountWithTokens(request));
  } catch (e) {
    if (e instanceof Response && e.status === 404) {
      // No Hubwork account for this domain — IDE fallback
      return handleIdeMock(request, type);
    }
    throw e;
  }

  if (account.plan !== "pro" && account.plan !== "granted") {
    return Response.json({ error: "Hubwork Pro subscription required" }, { status: 403 });
  }

  const email = await getContactEmail(request, type);
  if (!email) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { accessToken, rootFolderId } = tokens;
  const settings = await getSettings(accessToken, rootFolderId);

  const { resolveAccountType } = await import("~/types/settings");
  const resolved = resolveAccountType(settings?.hubwork?.accounts, type);
  const resolvedSpreadsheetId = resolved?.accountType.identity.spreadsheetId || settings?.hubwork?.spreadsheets?.[0]?.id || settings?.hubwork?.spreadsheetId;
  if (!resolvedSpreadsheetId) {
    return Response.json({ error: "Hubwork not configured" }, { status: 500 });
  }

  if (!resolved) {
    return Response.json({ error: "Account type not configured" }, { status: 500 });
  }
  const accountType = resolved.accountType;

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

async function handleIdeMock(request: Request, type: string) {
  const content = await readIdeMockFile(request, "auth/me.json");
  if (!content) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const data = JSON.parse(content);
    const typeData = data[type];
    if (!typeData) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    return Response.json({ type, ...typeData });
  } catch {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
}
