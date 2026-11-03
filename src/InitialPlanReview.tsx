import { tr } from "../shared/i18n";
import React, { useRef, useState } from "react";
import type { Plan } from "./App";
import { ScreenGallery } from "./ScreenGallery";
import { FunctionalOverview } from "./FunctionalOverview";
import { VisualRequest } from "./VisualRequest";
export function InitialPlanReview({shopId,plan,busy,onBack,onAccept,onPlan}:{shopId:string;plan:Plan;busy:boolean;onBack:()=>void;onAccept:()=>void;onPlan:(plan:Plan)=>void}) {
  const root = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [penActive, setPenActive] = useState(false);
  return <section className="request-review" aria-label={tr("下記の画面でいいですか？")}><span className="pill">{tr("まだお客様には公開されません")}</span><h3>{tr("下記の画面でいいですか？")}</h3><p>{tr("まずは、お店のページでできることを確認しましょう。")}</p>
    <ScreenGallery config={plan.config} shopId={shopId} themeRef={root}/>
    <p>{tr("テーマを直す場合は「修正する」を押し、赤ペンで囲んで希望を伝えてください。")}</p>
    <VisualRequest key={plan.id} shopId={shopId} config={plan.config} root={root} local={{base:plan.base,source:null}} initialPlanId={plan.id} onPlan={onPlan} onLocalChange={()=>{}} onBusyChange={setEditing} onActiveChange={setPenActive} screen={{id:"initial-theme",label:tr("ページの雰囲気"),file:"theme"}} />
    <p>{tr("画面ごとの細かいデザイン調整は仮公開後に画面単位で行えます。")}</p><FunctionalOverview pages={plan.config.pages.map(page=>page.title)} articles={plan.config.appearance?.articles}/>
    <p>{tr("各種設定は、仮公開後にそれぞれの設定メニューで行えます。")}</p><p>{tr("デザインは各画面の編集画面で更新してください。全体的な表示や機能の修正は、仮公開したあと「AIとお店をつくる」で相談できます。")}</p><p>{tr("よければ「仮公開する」を押してください。仮公開中は、このページを用意したGoogleアカウントでログインした本人だけが見られます。")}</p>
    <div className="actions"><button className="text-button" disabled={busy||editing||penActive} onClick={onBack}>{tr("聞き取りに戻る")}</button><button className="primary" disabled={busy||editing||penActive} onClick={onAccept}>{busy||editing?tr("確認しています…"):tr("仮公開する")}</button></div>
  </section>;
}
