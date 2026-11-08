import React, { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import { useApi } from "./api";
import type { VisualGenerationProgress, VisualStage } from "../shared/visual-progress";

export type VisualWork = { startedAt: number; stage: VisualStage; visualId?: string; requestId?: string };
export function VisualGenerationStatus({ shopId, work }: { shopId: string; work: VisualWork }) {
  const api = useApi();
  const [progress, setProgress] = useState<VisualGenerationProgress>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setProgress(undefined);
    if (!work.visualId || !work.requestId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api<VisualGenerationProgress | null>(`/api/shops/${shopId}/visual/${work.visualId}/progress?requestId=${work.requestId}`, undefined, { signal: controller.signal });
        if (!controller.signal.aborted && next && next.requestId === work.requestId) {
          setProgress(next);
          if (next.stage === "complete" || next.stage === "failed") return;
        }
      } catch { /* A transient progress read must not interrupt the running edit. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [shopId, work.visualId, work.requestId]);
  const stage = progress?.stage || work.stage;
  const labels: Record<VisualStage, string> = {
    preparing: tr("画面の情報を準備しています…"), identifying: tr("変更する箇所を確認しています…"),
    generating: tr("変更案を作成しています…"), reviewing: tr("PC・スマートフォンの表示を確認しています…"),
    repairing: tr("確認結果をもとに修正案を調整しています…"), complete: tr("修正案の確認が完了しました。"),
    failed: tr("修正案の作成を完了できませんでした。"),
  };
  return <div className="visual-generation-status" data-stage={stage}>
    <p role="status"><span className="visual-generation-indicator" aria-hidden="true" />{labels[stage]}</p>
    <div className="small muted"><span role="timer" aria-live="off">{tr("経過：{0}秒", Math.max(0, Math.floor((now - work.startedAt) / 1000)))}</span>{progress && progress.attempt > 1 && <span>{tr("調整：{0}回目", progress.attempt)}</span>}</div>
  </div>;
}
