import { tr } from "../shared/i18n";
import React from "react";
import { openingQuestions, initialFeatureQuestion, additionalPagesQuestion, finalDetailsQuestion } from "../server/request-intent";

export function OnboardingGuide() {
  return <aside className="onboarding-guide" aria-label={tr("お店づくりの進み方")}>
    <h3>{tr("こんな風にすすみます")}</h3>
    <p>{tr("AIの質問に答えながら、お店のページを用意します。ネイルサロンをつくる場合の例です。質問は、あなたの回答に合わせて変わります。")}</p>
    <ol className="onboarding-example-steps">
      <li><span className="example-step-number" aria-hidden="true">1</span><section><h4>{tr("「はじめる」を押す")}</h4><p>{tr("チャットが開き、AIから最初の質問が届きます。")}</p></section></li>
      <li><span className="example-step-number" aria-hidden="true">2</span><section><h4>{tr("AIの質問に答える")}</h4><div className="onboarding-example-dialogue" aria-label={tr("やりとりの例")}><p><b>AI</b><span>{openingQuestions["create-shop"]}</span></p><p><b>{tr("あなた")}</b><span>{tr("ネイルサロンです。")}</span></p><p><b>AI</b><span>{tr(initialFeatureQuestion)}</span></p><p><b>{tr("あなた")}</b><span>{tr("1、2、3をお願いします。")}</span></p><p><b>AI</b><span>{tr(additionalPagesQuestion)}</span></p><p><b>{tr("あなた")}</b><span>{tr("今はありません。")}</span></p><p><b>AI</b><span>{tr(finalDetailsQuestion)}</span></p><p><b>{tr("あなた")}</b><span>{tr("ありません。この内容でお願いします。")}</span></p></div><p className="small muted">{tr("「音声入力」で話した内容を入力欄に書き起こせます。末尾で「以上」と言うと送信します。AIの返答は画面で確認できます。")}</p></section></li>
      <li><span className="example-step-number" aria-hidden="true">3</span><section><h4>{tr("用意する画面を確かめる")}</h4><p>{tr("画面の一覧と、できることを確認します。直したいところは、AIに続けて伝えられます。")}</p><div className="example-page-tags"><span>{tr("お店の紹介")}</span><span>{tr("予約")}</span><span>{tr("ブログ")}</span></div></section></li>
      <li><span className="example-step-number" aria-hidden="true">4</span><section><h4>{tr("仮公開して、自分で試す")}</h4><p>{tr("「仮公開する」で、まずは本人だけが見られるページを用意します。各種設定やデザインを整え、最後に画面を確認して本番公開します。")}</p></section></li>
    </ol>
  </aside>;
}
