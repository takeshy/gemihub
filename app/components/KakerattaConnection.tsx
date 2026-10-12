import { useEffect, useState } from "react";
import { browserTimelineInput, applyBrowserTimelineResult } from "~/services/timeline-sync-client";
import type { UserSettings } from "~/types/settings";

/** Browser lifecycle only. Premium's independent scheduler also polls when closed. */
export function KakerattaConnection({ settings, offline = false }: { settings: UserSettings; offline?: boolean }) {
  const [status, setStatus] = useState("");
  const enabled = settings.kakeratta?.enabled === true;
  const periodic = settings.kakeratta?.pollEnabled !== false || settings.kakeratta?.timelineSync?.enabled === true;
  const ja = settings.language === "ja";
  useEffect(() => {
    if (!enabled || offline) return;
    const controller = new AbortController();
    let running = false;
    let firstTick = true;
    async function tick() {
      if (running || controller.signal.aborted || !navigator.onLine) return;
      running = true;
      try {
        const operation = !firstTick && settings.kakeratta?.pollEnabled === false ? "timeline" : "poll";
        firstTick = false;
        const timelineInput = await browserTimelineInput(settings.kakeratta);
        const response = await fetch("/api/kakeratta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, timelineFiles: timelineInput.timelineFiles, timelineRootFolderId: timelineInput.timelineRootFolderId }), signal: controller.signal });
        const result = await response.json();
        await applyBrowserTimelineResult(result.timeline, timelineInput);
        if (!response.ok) throw new Error("Connection failed");
        if (!controller.signal.aborted) setStatus(result.failed || result.unsubmitted || result.requests?.failed || result.requests?.incomplete || result.timeline?.error || result.timeline?.pending ? (ja ? "Kakeratta: 一部の処理に失敗しました" : "Kakeratta: some operations failed") : result.timeline?.backfillPending ? (ja ? "Kakeratta: 過去の投稿を同期中" : "Kakeratta: syncing historical posts") : (ja ? "Kakeratta: 接続中" : "Kakeratta: connected"));
      } catch {
        if (!controller.signal.aborted) setStatus(ja ? "Kakeratta: 接続に失敗しました。連携設定を確認してください。" : "Kakeratta: connection failed. Check integration settings.");
      } finally { running = false; }
    }
    void tick();
    const timer = periodic ? window.setInterval(() => void tick(), 60_000) : undefined;
    return () => { controller.abort(); if (timer !== undefined) window.clearInterval(timer); };
  }, [enabled, periodic, offline, ja, settings.kakeratta]);
  if (!enabled || offline || !status) return null;
  return <a href="/settings?tab=kakeratta" role="status" className="fixed bottom-1 left-2 z-40 rounded bg-white/90 px-2 py-1 text-xs text-gray-600 shadow dark:bg-gray-900/90 dark:text-gray-300">{status}</a>;
}
