import type { Route } from "./+types/api.settings.hubwork-provision";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { provisionHubworkSkill } from "~/services/hubwork-skill-provisioner.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { rewriteHubworkSpreadsheetRefs } from "~/services/hubwork-settings-rewriter";
import { resolveLanguage } from "~/i18n/resolve-language";

/**
 * POST /api/settings/hubwork-provision
 * Provisions Webpage Builder skill and returns files for IndexedDB registration.
 * On first provision, also creates a spreadsheet and saves it + account type to settings.
 * On subsequent calls, rewrites any stale spreadsheet references if duplicate
 * spreadsheets were consolidated (so settings don't point at a deleted sheet).
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

    // Resolve the UI language the user is currently on so the baked-in
    // response-language directive in SKILL.md matches. Use the shared
    // resolveLanguage() helper so the fallback parsing of Accept-Language
    // (quality values, multiple tags, subtag splitting) stays consistent
    // with how root.tsx / _index.tsx / settings.tsx pick the UI locale.
    const currentSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
    const language = resolveLanguage(
      currentSettings.language,
      request.headers.get("accept-language"),
    );

    const result = await provisionHubworkSkill(validTokens.accessToken, validTokens.rootFolderId, force, language);

    if (result.spreadsheetId) {
      // First provision: write the initial hubwork config block
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
    } else if (result.spreadsheetKeptId && result.discardedSpreadsheetIds?.length) {
      // Consolidation path: if settings reference a spreadsheet we just deleted,
      // rewrite those references to the surviving ID so hubwork flows don't
      // blow up reading a non-existent spreadsheet.
      const settings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
      const rewritten = rewriteHubworkSpreadsheetRefs(
        settings,
        new Set(result.discardedSpreadsheetIds),
        result.spreadsheetKeptId,
      );
      if (rewritten) {
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, rewritten);
      }
    }

    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Provisioning failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

