/**
 * Shared pure helpers for scheduled workflow execution
 * (`hubwork.api.workflow.scheduled.tsx`). Kept out of the route file because
 * React Router strips server-only imports only from the route's own server
 * exports — an extra route-level export touching a `.server` module breaks
 * the client bundle.
 */

import type { HubworkAccount } from "~/types/hubwork";
import type { UserSettings } from "~/types/settings";
import { AiBudgetExceededError } from "./ai-budget.server";
import { personalVertexRunForUser, type PersonalVertexRun } from "./ai/personal-vertex.server";

type UserSettingsShape = Pick<
  UserSettings,
  "usePersonalVertex" | "personalVertexSource" | "personalVertexProjectId" | "personalVertexLocation"
>;

/** Scheduled execution covers Pro (Drive mount) and Business/granted (org GCS). */
export function selectScheduledAccounts(accounts: Iterable<HubworkAccount>): HubworkAccount[] {
  return Array.from(accounts).filter(
    (account) => account.plan === "pro" || account.plan === "business" || account.plan === "granted",
  );
}

/**
 * Personal Vertex AI for a scheduled run. An account that selected Vertex AI
 * in settings runs on it whether or not a Gemini API key is also stored —
 * the same "Vertex only" rule as the interactive routes. Prepaid runs on our
 * project against the user's balance (`emailToUid` is the balance key); the
 * own-project source uses the refresh token stored at connect time, so it
 * works unattended too. Undefined means "use the API key path".
 */
export function personalVertexRunForSchedule(
  settings: UserSettingsShape | undefined | null,
  email: string,
): PersonalVertexRun | undefined {
  return personalVertexRunForUser(email, settings) ?? undefined;
}

/**
 * Whether a caught error should trigger a "balance exhausted" notification.
 * Only the first occurrence of this specific failure notifies — an
 * exhausted balance otherwise fails every retry and every subsequent cron
 * tick, and re-sending mail on each of those would spam the account owner.
 * `previousLastError` is the schedule's stored `lastError` before this run;
 * it differs (or is unset) only when this is a new failure.
 */
export function shouldNotifyPersonalVertexExhausted(
  error: unknown,
  previousLastError: string | undefined,
): boolean {
  return error instanceof AiBudgetExceededError
    && error.scope === "personal"
    && previousLastError !== error.message;
}

/** Content for the "personal Vertex AI balance exhausted" notification email. */
export function personalVertexExhaustedEmail(
  to: string,
  settingsUrl: string,
): { to: string; subject: string; html: string } {
  const url = escapeHtml(settingsUrl);
  return {
    to,
    subject: "スケジュール実行が停止しています — Vertex AI残高が不足しています",
    html: `<!doctype html><html lang="ja"><body style="font-family:system-ui,sans-serif;line-height:1.7;color:#1f2937"><h2>Vertex AI残高不足によりスケジュール実行が失敗しました</h2><p>個人のVertex AI残高が0になったため、Gemini APIキー未設定のスケジュール実行でAI呼び出しが失敗しました。残高を追加購入するか、Gemini APIキーを設定すると次回から再開します。</p><p><a href="${url}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none">設定を開く</a></p><p style="font-size:13px;color:#6b7280">ボタンを開けない場合は、次のURLをブラウザへ貼り付けてください。<br><a href="${url}">${url}</a></p></body></html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
