import { tr } from "../shared/i18n";
import React from "react";
import type { Plan } from "./App";
import { ScreenGallery } from "./ScreenGallery";
import { FunctionalOverview } from "./FunctionalOverview";
export function InitialPlanReview({shopId,plan,busy,onBack,onAccept}:{shopId:string;plan:Plan;busy:boolean;onBack:()=>void;onAccept:()=>void}) {
  return <section className="request-review" aria-label={tr("下記の画面でいいですか？")}><span className="pill">{tr("まだお客様には公開されません")}</span><h3>{tr("下記の画面でいいですか？")}</h3><p>{tr("まずは、お店のページでできることを確認しましょう。")}</p>
    <ScreenGallery config={plan.config} shopId={shopId}/>
    {plan.themeReview?.rendered && <p className="small muted">{tr("修正後のPC・スマートフォンの画面をAIで確認しました。")}</p>}
    <FunctionalOverview pages={plan.config.pages.map(page=>page.title)} articles={plan.config.appearance?.articles}/>
    <p>{tr("用意するページや機能を変更したい場合は、「聞き取りに戻る」から希望を伝えてください。")}</p>
    <aside className="initial-design-guidance">
      <h4>{tr("仮公開したあとにできること")}</h4>
      <p>{tr("仮公開したあと「AIとお店をつくる」を開くと、実際の画面を見ながらAIに指示して見た目を修正できます。")}</p>
      <p>{tr("「このボタンを大きく」「背景を明るく」などの指示で修正できます。")}</p>
      <p>{tr("各種設定は、仮公開後にそれぞれの設定メニューで行えます。")}</p>
    </aside>
    <p>{tr("よければ「仮公開する」を押してください。仮公開中は、このページを用意したGoogleアカウントでログインした本人だけが見られます。")}</p>
    <div className="actions"><button className="text-button" disabled={busy} onClick={onBack}>{tr("聞き取りに戻る")}</button><button className="primary" disabled={busy} onClick={onAccept}>{busy?tr("確認しています…"):tr("仮公開する")}</button></div>
  </section>;
}
