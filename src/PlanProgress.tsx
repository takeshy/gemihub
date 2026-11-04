import React, { useEffect, useState } from "react";
import type { ChatGeneration } from "../server/shop-chat";
import { tr } from "../shared/i18n";
import { PreviewSurface } from "./ScreenGallery";

export function PlanProgress({ generation, shopId }: { generation: ChatGeneration; shopId: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - generation.startedAt) / 1000));
  const stage = generation.stage;
  const step = stage === "preparing" ? 0 : stage === "generating" ? 1 : 2;
  return <section className="plan-progress" aria-label={tr("プレビューの作成状況")} aria-busy={stage !== "failed"}>
    <div role="status"><strong>{stage === "failed" ? tr("作成を再試行できます") : stage === "preparing" ? tr("お店の情報とページの内容を整理しています…") : stage === "generating" ? tr("ページのデザインを作成しています…") : stage === "repairing" ? tr("確認で見つかった箇所を自動で修正しています…") : tr("デザインと表示を確認しています…")}</strong></div>
    <ol className="plan-progress-steps">{[tr("ページの内容"), tr("デザイン作成"), tr("確認・自動修正")].map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined}>{index < step ? "✓ " : `${index + 1}. `}{label}</li>)}</ol>
    {stage !== "failed" && <p className="small muted">{tr("目安は2〜4分です。経過 {0}分{1}秒", Math.floor(seconds / 60), seconds % 60)}{generation.attempts > 1 && " " + tr("自動調整 {0}回目", generation.attempts)}</p>}
    <p className="small muted">{tr("会話は保存されています。再読み込みしても続きから確認できます。")}</p>
    {generation.preview && <details open><summary>{tr("作成途中のページを見る")}</summary><p className="small muted">{tr("確認前の画面案です。自動修正で見た目が変わることがあります。予約などの操作は練習用です。")}</p><div className="generation-preview"><PreviewSurface key={JSON.stringify(generation.preview)} config={generation.preview} shopId={shopId} screen={{ id: "about", name: tr("お店のこと"), description: tr("お店の紹介"), pane: "about" }} /></div></details>}
  </section>;
}
