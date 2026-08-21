import type { HubworkAccount, ResolvedAccountTokens } from "~/types/hubwork";
import type { UserSettings } from "~/types/settings";
import type { ProjectAccessContext } from "~/types/enterprise";
import { resolveHubworkAccount } from "./hubwork-account-resolver.server";
import { getTokensForAccount } from "./hubwork-accounts.server";
import { mountContextForHubworkAccount } from "./storage/account-mount.server";
import { getSettingsForTenant } from "./user-settings-tenant.server";

export interface HubworkRuntime {
  account: HubworkAccount;
  tokens: ResolvedAccountTokens;
  project: ProjectAccessContext;
  settings: UserSettings;
}

/** Resolve the GCS-backed Hubwork runtime; Drive is only used for Google OAuth integrations. */
export async function resolveHubworkRuntime(request: Request): Promise<HubworkRuntime> {
  const account = await resolveHubworkAccount(request);
  const mount = await mountContextForHubworkAccount(account);
  if (!mount?.gcs) {
    throw new Response("Hubwork Cloud Storage project is not configured", { status: 503 });
  }
  const [tokens, settings] = await Promise.all([
    getTokensForAccount(account),
    getSettingsForTenant(mount.gcs),
  ]);
  return { account, tokens, project: mount.gcs, settings };
}
