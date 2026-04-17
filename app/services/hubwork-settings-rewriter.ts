import type { UserSettings, HubworkAccountType } from "~/types/settings";

/**
 * Return an updated UserSettings where every hubwork spreadsheet reference
 * pointing at a discarded ID is rewritten to keptId. Returns null when no
 * references matched so callers can skip the saveSettings write.
 *
 * Used when the provisioner consolidates duplicate webpage_builder
 * spreadsheets: the surviving ID (keptId) is deterministic across racers,
 * but settings persisted by a losing racer can still point at a now-deleted
 * spreadsheet; this rewrite brings settings back in line with Drive.
 */
export function rewriteHubworkSpreadsheetRefs(
  settings: UserSettings,
  discardedIds: Set<string>,
  keptId: string,
): UserSettings | null {
  const hubwork = settings.hubwork;
  if (!hubwork) return null;
  let changed = false;

  const spreadsheets = hubwork.spreadsheets?.map((s) => {
    if (discardedIds.has(s.id)) {
      changed = true;
      return { ...s, id: keptId };
    }
    return s;
  });

  const accounts = hubwork.accounts
    ? Object.fromEntries(
        Object.entries(hubwork.accounts).map(([key, accountType]): [string, HubworkAccountType] => {
          const identity = accountType.identity;
          const identityRewrite =
            identity.spreadsheetId && discardedIds.has(identity.spreadsheetId)
              ? { ...identity, spreadsheetId: keptId }
              : identity;
          if (identityRewrite !== identity) changed = true;

          const data = accountType.data
            ? Object.fromEntries(
                Object.entries(accountType.data).map(([dataKey, source]) => {
                  if (source.spreadsheetId && discardedIds.has(source.spreadsheetId)) {
                    changed = true;
                    return [dataKey, { ...source, spreadsheetId: keptId }];
                  }
                  return [dataKey, source];
                })
              )
            : accountType.data;

          return [key, { ...accountType, identity: identityRewrite, data }];
        })
      )
    : hubwork.accounts;

  if (!changed) return null;
  return {
    ...settings,
    hubwork: {
      ...hubwork,
      ...(spreadsheets ? { spreadsheets } : {}),
      ...(accounts ? { accounts } : {}),
    },
  };
}
