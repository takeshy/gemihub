import type { Route } from "./+types/api.settings.hubwork-provision";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { provisionHubworkSkill } from "~/services/hubwork-skill-provisioner.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";

/**
 * POST /api/settings/hubwork-provision
 * Provisions Webpage Builder skill and returns files for IndexedDB registration.
 * On first provision, also creates a spreadsheet and saves it + account type to settings.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  try {
    const body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : {};
    const force = body?.force === true;
    const result = await provisionHubworkSkill(validTokens.accessToken, validTokens.rootFolderId, force);

    // Save spreadsheet + account type to settings on first provision
    if (result.spreadsheetId) {
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const updatedSettings = {
        ...settings,
        hubwork: {
          ...settings.hubwork,
          spreadsheets: [{ id: result.spreadsheetId, label: "webpage_builder" }],
          accounts: {
            accounts: { identity: { spreadsheetId: result.spreadsheetId, sheet: "accounts", emailColumn: "email" } },
          },
        },
      };
      await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
    }

    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provisioning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
