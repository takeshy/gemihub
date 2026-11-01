import React from "react";
import type { Plan } from "./App";
import { ScreenGallery } from "./ScreenGallery";
import { FunctionalOverview } from "./FunctionalOverview";
export function InitialPlanReview({shopId,plan,busy,onBack,onAccept}:{shopId:string;plan:Plan;busy:boolean;onBack:()=>void;onAccept:()=>void}) {
  return <section className="request-review" aria-label="下記の画面でいいですか？"><span className="pill">まだお客様には公開されません</span><h3>下記の画面でいいですか？</h3><p>まずは、お店のページでできることを確認しましょう。</p>
    <ScreenGallery config={plan.config} shopId={shopId}/><p>画面ごとの細かいデザイン調整は仮公開後に画面単位で行えます。</p><FunctionalOverview pages={plan.config.pages.map(page=>page.title)}/>
    <p>各種設定は、仮公開後にそれぞれの設定メニューで行えます。</p><p>デザインは各画面の編集画面で更新してください。全体的な表示や機能の修正は、仮公開したあと「AIとお店をつくる」で相談できます。</p><p>よければ「仮公開する」を押してください。仮公開中は、このページを用意したGoogleアカウントでログインした本人だけが見られます。</p>
    <div className="actions"><button disabled={busy} onClick={onBack}>直したいことを伝える</button><button className="primary" disabled={busy} onClick={onAccept}>{busy?"確認しています…":"仮公開する"}</button></div>
  </section>;
}
