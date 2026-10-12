import { useEffect, useState } from "react";
import type { UserSettings } from "~/types/settings";

/** Browser lifecycle only. Premium's independent scheduler also polls when closed. */
export function KakerattaConnection({ settings, offline = false }: { settings: UserSettings; offline?: boolean }) {
  const [status, setStatus] = useState("");
  const enabled = settings.kakeratta?.enabled === true;
  const periodic = settings.kakeratta?.pollEnabled !== false;
  const ja = settings.language === "ja";
  useEffect(() => {
    if (!enabled || offline) return;
    const controller = new AbortController();
    let running = false;
    async function tick() {
      if (running || controller.signal.aborted || !navigator.onLine) return;
      running = true;
      try {
        const response = await fetch("/api/kakeratta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "poll" }), signal: controller.signal });
        if (!response.ok) throw new Error("Connection failed");
        const result = await response.json();
        if (!controller.signal.aborted) setStatus(result.failed || result.unsubmitted || result.requests?.failed || result.requests?.incomplete ? (ja ? "Kakeratta: 一部の回答に失敗しました" : "Kakeratta: some answers failed") : (ja ? "Kakeratta: 接続中" : "Kakeratta: connected"));
      } catch {
        if (!controller.signal.aborted) setStatus(ja ? "Kakeratta: 接続に失敗しました。連携設定を確認してください。" : "Kakeratta: connection failed. Check integration settings.");
      } finally { running = false; }
    }
    void tick();
    const timer = periodic ? window.setInterval(() => void tick(), 60_000) : undefined;
    return () => { controller.abort(); if (timer !== undefined) window.clearInterval(timer); };
  }, [enabled, periodic, offline, ja]);
  if (!enabled || offline || !status) return null;
  return <a href="/settings?tab=kakeratta" role="status" className="fixed bottom-1 left-2 z-40 rounded bg-white/90 px-2 py-1 text-xs text-gray-600 shadow dark:bg-gray-900/90 dark:text-gray-300">{status}</a>;
}
