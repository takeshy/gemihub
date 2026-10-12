import { FieldValue } from "@google-cloud/firestore";
import type { HubworkAccount } from "~/types/hubwork";
import { isActivePremiumAccount } from "~/types/hubwork";
import { getSettings } from "./user-settings.server";
import { commitSession, setTokens } from "./session.server";
import { decryptGeminiApiKey, getStoredRefreshToken, getTokensForAccount, tryAcquireScheduleLock, updateScheduleRuntime } from "./hubwork-accounts.server";

export function eligibleKakerattaAccount(account: HubworkAccount): boolean {
  return isActivePremiumAccount(account) && account.kakerattaEnabled === true && !!account.rootFolderId;
}

/** Runs under the existing scheduler's verified service-account authorization. */
export async function pollScheduledKakeratta(accounts: HubworkAccount[], schedulerRequest: Request): Promise<{ accountId: string; status: string }[]> {
  const results: { accountId: string; status: string }[] = [];
  // Bounded parallelism keeps one slow external agent from delaying every owner.
  const queue = accounts.filter(eligibleKakerattaAccount);
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length && !schedulerRequest.signal.aborted) {
      const account = queue.shift()!;
      const scheduleId = "__kakeratta_poll";
      let acquired = false;
      try {
        acquired = await tryAcquireScheduleLock({ accountId: account.id, scheduleId, timeoutSec: 600, policy: "forbid" });
        if (!acquired) continue;
        const tokens = await getTokensForAccount(account);
        const settings = await getSettings(tokens.accessToken, tokens.rootFolderId);
        if (!settings.kakeratta?.enabled || settings.kakeratta.pollEnabled === false) continue;
        const refreshToken = getStoredRefreshToken(account);
        if (!refreshToken) throw new Error("Missing background credentials");
        const request = new Request(new URL("/api/kakeratta", schedulerRequest.url), { method: "POST" });
        const session = await setTokens(request, {
          ...tokens, refreshToken, email: account.email, apiPlan: settings.apiPlan,
          geminiApiKey: account.encryptedGeminiApiKey ? decryptGeminiApiKey(account.encryptedGeminiApiKey) : "",
        });
        // The session stays inside the process; never send it to an external URL.
        const cookie = (await commitSession(session)).split(";")[0];
        const pollRequest = new Request(request.url, {
          method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
          signal: schedulerRequest.signal, body: JSON.stringify({ operation: "poll" }),
        });
        const { action } = await import("~/routes/api.kakeratta");
        const response = await action({ request: pollRequest, params: {}, context: {} } as Parameters<typeof action>[0]);
        const result = await response.json() as { failed?: number; unsubmitted?: number; requests?: { failed: number; incomplete: number } };
        const status = response.ok && !result.failed && !result.unsubmitted && !result.requests?.failed && !result.requests?.incomplete ? "completed" : "failed";
        await updateScheduleRuntime(account.id, scheduleId, { lastError: status === "failed" ? "Kakeratta poll failed" : FieldValue.delete() });
        results.push({ accountId: account.id, status });
      } catch {
        if (acquired) await updateScheduleRuntime(account.id, scheduleId, { lastError: "Kakeratta poll failed" }).catch(() => undefined);
        results.push({ accountId: account.id, status: "failed" });
      } finally {
        if (acquired) {
          await updateScheduleRuntime(account.id, scheduleId, { lockedUntil: FieldValue.delete() }).catch(() => {
            // The lease expires automatically; keep the other accounts running.
            results.push({ accountId: account.id, status: "lock_cleanup_failed" });
          });
        }
      }
    }
  }));
  return results;
}
