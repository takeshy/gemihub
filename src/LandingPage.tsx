import React from "react";
import { getLocale, tr } from "../shared/i18n";
import { Brand } from "./Brand";
import { LanguageSwitcher } from "./LanguageSwitcher";

export const landingTitle = () => tr("gemihub — お店のWeb制作と相談を、AIといつでも自由に。");
export const landingDescription = () => tr("人に依頼するように、AIといつでも自由にお店のWebページを制作。赤丸で示して修正を頼み、お店のデータ・設定・仕組みを理解したAIに、おしゃべりしながら相談できます。");

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} /></svg>;
}
function Flower({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1.2"><ellipse cx="80" cy="80" rx="20" ry="63" /><ellipse cx="80" cy="80" rx="20" ry="63" transform="rotate(45 80 80)" /><ellipse cx="80" cy="80" rx="20" ry="63" transform="rotate(90 80 80)" /><ellipse cx="80" cy="80" rx="20" ry="63" transform="rotate(135 80 80)" /></g><circle cx="80" cy="80" r="12" fill="currentColor" /></svg>;
}
const appLink = () => `/?lang=${getLocale()}`;

function HeroPreview() {
  return <div className="lp-hero-art" aria-label={tr("AIとの会話からお店のWebページを作る画面イメージ")}>
    <div className="lp-orbit" aria-hidden="true" />
    <div className="lp-preview-label"><span className="lp-dot" />{tr("あなたのお店に、合わせてつくる。")}</div>
    <div className="lp-sample-site">
      <div className="lp-window-bar"><span>● ● ●</span><span>{tr("nail atelier 凪")}</span><Arrow diagonal /></div>
      <div className="lp-sample-nav"><b>Nagi.</b><span>NAIL & CARE</span></div>
      <div className="lp-salon-hero"><div><span>NAIL ATELIER</span><p>{tr("指先に、")}<br />{tr("小さなときめき。")}</p><span className="lp-sample-book">{tr("ご予約はこちら")}<Arrow /></span></div><div className="lp-botanical"><Flower /><span className="lp-vase" /></div></div>
      <div className="lp-sample-service"><div><span>01 / HAND CARE</span><strong>{tr("わたしに似合う、ネイルを。")}</strong></div><span>¥5,500 <Arrow diagonal /></span></div>
      <div className="lp-sample-caption">{tr("架空のお店の画面イメージ")}</div>
    </div>
    <div className="lp-chat-note"><span className="lp-chat-avatar">g✳</span><div><small>{tr("たとえば、こんなふうに。")}</small><p>{tr("落ち着いた雰囲気のネイルサロンです。お店の紹介と予約ができるページをつくりたい。")}</p></div></div>
    <div className="lp-confirm-note"><span>✓</span><div><b>{tr("AIがお店のページを用意しました")}</b><small>{tr("画面を確かめてから、公開できます。")}</small></div></div>
  </div>;
}

function WebsiteCreation() {
  const steps = [
    { id: "create", label: tr("AIに制作を頼む"), title: tr("イメージを伝えて、相談しながらつくる。"), text: tr("人にWeb制作を依頼するときのように、つくりたいページやお店の雰囲気を伝える。AIの質問に答え、画面を見ながら希望を相談する。時間を気にせず、自分のペースでお店のページをつくれます。"), image: "02-interview.jpg", alt: tr("AIの質問に答えて、お店のWebページをつくる会話画面"), guide: "interview" },
    { id: "red-circle", label: tr("赤丸で囲んで直す"), title: tr("ここを変えたい。赤丸とひと言で、AIに伝わる。"), text: tr("気になる場所を画面上で赤丸で囲んで、「この見出しを変えて」「この色をもっと明るく」とAIに伝えます。修正する箇所と内容を確認し、画面で見比べてから反映できます。"), image: "22-pen.jpg", alt: tr("変更したい店名を赤丸で囲み、右のチャットでAIに修正を頼む画面"), guide: "pen" },
  ];
  return <section id="features" className="lp-section lp-container" aria-labelledby="lp-features-heading">
    <div className="lp-section-heading"><div><span className="lp-kicker">01 — {tr("制作も、修正も、お店の相談も")}</span><h2 id="lp-features-heading">{tr("頼んで、話して、")}<br />{tr("お店に合うかたちへ。")}</h2></div><p>{tr("イメージを伝える。気になる場所を示して、直してもらう。お店のことをわかっているAIと、いつでもおしゃべりしながら進められます。")}</p></div>
    <div className="lp-feature-preview lp-creation-features">{steps.map(step => <article key={step.id} className="lp-feature-layout" data-creation={step.id} aria-labelledby={`lp-creation-${step.id}`}>
      <div className="lp-feature-copy"><span className="lp-kicker">{step.label}</span><h3 id={`lp-creation-${step.id}`}>{step.title}</h3><p>{step.text}</p><a href={`/manual?lang=${getLocale()}#guide-${step.guide}`}>{tr("使い方を見てみる")}<Arrow /></a></div>
      <div className="lp-product-frame"><div className="lp-window-bar"><span>● ● ●</span><span>gemihub / {step.label}</span></div><img src={`/manual/${getLocale() === "en" ? "en/" : ""}${step.image}`} alt={step.alt} width="1280" height="950" loading="lazy" /></div>
    </article>)}
      <article className="lp-feature-layout" data-creation="review" aria-labelledby="lp-creation-review">
        <div className="lp-feature-copy"><span className="lp-kicker">{tr("確認してから反映")}</span><h3 id="lp-creation-review">{tr("変更前後も、PC・スマホも。確かめてから公開。")}</h3><p>{tr("修正案を確認して採用したあとも、変更前後を比較できます。PC・スマートフォンの表示を切り替えて確認し、「反映する」から最後の確認へ。内容に納得してから本番に反映できます。")}</p><a href={`/manual?lang=${getLocale()}#guide-pen`}>{tr("使い方を見てみる")}<Arrow /></a></div>
        <div className="lp-review-screens">{[{ image: "61-design-compare.jpg", caption: tr("本番と編集後を並べて、変更内容を確認する画面") }, { image: "62-design-mobile.jpg", caption: tr("PC・スマートフォンの切り替えで、スマホ表示を確認する画面") }].map(shot => <figure className="lp-product-frame" key={shot.image}><img src={`/manual/${getLocale() === "en" ? "en/" : ""}${shot.image}`} alt={shot.caption} width="1280" height="900" loading="lazy" /><figcaption>{shot.caption}</figcaption></figure>)}</div>
      </article>
      <article className="lp-feature-layout" data-creation="consult" aria-labelledby="lp-creation-consult">
        <div className="lp-feature-copy"><span className="lp-kicker">{tr("お店を理解したAIに相談する")}</span><h3 id="lp-creation-consult">{tr("お店のことをわかっているから、おしゃべりから相談に。")}</h3><p>{tr("お店のデータも、今の設定も、予約や支払いの仕組みも。事情を理解しているAIに、いつでも相談できます。「最近の予約はどう？」「この設定だとどうなる？」。日々の疑問や次にやりたいことを、気軽に話してください。")}</p><a href={`/manual?lang=${getLocale()}#guide-system`}>{tr("使い方を見てみる")}<Arrow /></a></div>
        <div className="lp-consult-preview"><span className="lp-kicker">{tr("たとえば、こんな相談")}</span><div className="lp-consult-context"><span>{tr("お店のデータ")}</span><span>{tr("現在の設定")}</span><span>{tr("お店の仕組み")}</span></div><div className="lp-consult-question">{tr("指名なしの予約って、誰に入るの？")}</div><div className="lp-consult-answer"><b>AI</b><p>{tr("今のお店では、対応できるスタッフの勤務時間と、すでに入っている予約を確認して、空いている枠をご案内します。")}</p></div><div className="lp-consult-question">{tr("じゃあ、スタッフを増やしたいときは？")}</div><p className="lp-consult-caption">{tr("お店の設定に合わせた相談のイメージ")}</p></div>
      </article>
    </div>
  </section>;
}

function FeatureOverview() {
  const features = [
    { id: "booking", label: tr("予約管理"), title: tr("予約を、ひと目で。"), text: tr("メニューも、スタッフの勤務も、お休みも。お店のルールに合う空き時間だけを、お客様にご案内します。"), image: "09-bookings.jpg", alt: tr("日付やスタッフで絞り込める予約管理画面"), guide: "bookings" },
    { id: "customers", label: tr("お客様情報"), title: tr("次の「いらっしゃいませ」に。"), text: tr("氏名・メール、予約・お問い合わせ、来店回数・利用金額をお客様ごとに。メモと施術写真も残して、次の接客につなげられます。"), image: "57-customer-detail.jpg", alt: tr("お客様の基本情報・来店実績・接客メモをまとめて確認する詳細画面"), guide: "customer-notes" },
    { id: "analytics", label: tr("売上・アクセス分析"), title: tr("お店の変化が、見えてくる。"), text: tr("スタッフ別・メニュー別の売上を、日別・月別で比較。予約ページの閲覧から確定まで、アクセスの変化と合わせて、お店の今を確かめられます。"), image: "56-sales-comparison.jpg", alt: tr("スタッフごとの売上推移を色分けして比較するグラフ"), guide: "staff-sales" },
    { id: "posts", label: tr("ブログ・お知らせ"), title: tr("お店の今を、届ける。"), text: tr("季節のメニューも、臨時休業のお知らせも。自分で書いても、AIと一緒に考えても。写真を添えて、お店のページへ。"), image: "58-blog-editor.jpg", alt: tr("写真と文章を編集するブログ画面"), guide: "post-edit" },
    { id: "phone", label: tr("AI電話受付"), title: tr("手が離せないときも、電話を受け付ける。"), text: tr("施術中など手が離せないときも、AIが電話を受け、対応可能な予約や問い合わせを受け付けます。Twilioの電話番号との連携・受付設定が必要です。予約は来店時の現金払い。前払いを使うお店は当日の空き枠のみ、使わないお店は予約可能期間内が対象です。再募集枠は電話では扱いません。"), image: "59-phone-settings.jpg", alt: tr("電話番号・受付時間・応対ルールを設定するAI電話受付の画面"), guide: "phone-reception" },
  ] as const;
  return <div className="lp-operation-grid">
    {features.map(feature => <article key={feature.id} className="lp-feature-layout" data-feature={feature.id} aria-labelledby={`lp-feature-${feature.id}`}>
      <div className="lp-feature-copy"><span className="lp-kicker">{feature.label}</span><h3 id={`lp-feature-${feature.id}`}>{feature.title}</h3><p>{feature.text}</p><a href={`/manual?lang=${getLocale()}#guide-${feature.guide}`}>{tr("使い方を見てみる")}<Arrow /></a></div>
      <div className="lp-product-frame"><div className="lp-window-bar"><span>● ● ●</span><span>gemihub / {feature.label}</span></div><img src={`/manual/${getLocale() === "en" ? "en/" : ""}${feature.image}`} alt={feature.alt} width="1280" height="900" loading="lazy" /></div>
    </article>)}
  </div>;
}

export function LandingPage() {
  const start = appLink();
  return <div className="lp">
    <a className="lp-skip" href="#lp-main">{tr("本文へ移動")}</a>
    <header className="lp-header"><Brand href="/lp" /><nav className="lp-nav" aria-label={tr("サービス紹介のメニュー")}><a href="#features">{tr("AIでつくる")}</a><a href="#operations">{tr("公開後の機能")}</a><a href="#faq">{tr("よくある質問")}</a></nav><div className="lp-header-actions"><LanguageSwitcher /><div className="lp-header-invite"><small>{tr("現在は招待制です")}</small><a className="lp-header-start" href={start}>{tr("はじめる")}<Arrow diagonal /></a></div></div></header>
    <main id="lp-main">
      <section className="lp-hero lp-container" aria-labelledby="lp-heading">
        <div className="lp-hero-copy"><span className="lp-kicker"><span className="lp-dot" />{tr("人に頼むように、AIに頼めるWeb制作。")}</span><h1 id="lp-heading">{tr("お店のWebページを、")}<br /><span>{tr("いつでも、自由に。")}</span></h1><p className="lp-hero-lead">{tr("イメージを伝え、画面を見ながら相談し、修正を頼む。")}<br />{tr("人に制作を依頼するようなやり方で、AIとつくれます。")}</p><p className="lp-hero-lead lp-hero-consult">{tr("お店のデータ・設定・仕組みを理解しているAIに、")}<br />{tr("おしゃべりしながら、いつでも相談できます。")}</p><a className="lp-button" href={start}>{tr("AIとWebページをつくる")}<Arrow /></a><p className="lp-cta-note">{tr("現在は招待制です。招待パスワードをご用意ください。")}<br />{tr("まずは画面を確かめるところから。公開はそのあとで。")}</p><a className="lp-scroll-link" href="#features"><span>↓</span>{tr("AIでのつくり方を見る")}</a></div>
        <HeroPreview />
      </section>
      <div className="lp-intro-strip"><span>{tr("つくる時間を、向き合う時間に。")}</span><div><span>{tr("AIと話してつくる")}</span><i>→</i><span>{tr("赤丸で囲んで直す")}</span><i>→</i><span>{tr("確かめて公開")}</span></div></div>
      <WebsiteCreation />
      <section id="operations" className="lp-section lp-container" aria-labelledby="lp-operations-heading"><div className="lp-section-heading"><div><span className="lp-kicker">02 — {tr("公開したあとも、お店を支える")}</span><h2 id="lp-operations-heading">{tr("つくったページで、")}<br />{tr("お店の毎日も、スムーズに。")}</h2></div><p>{tr("予約受付、お客様の記録、お知らせ、売上やアクセスの確認。ページを公開したあとに必要な機能も、ひとつにつながります。")}</p></div><FeatureOverview /></section>
      <section className="lp-payments lp-container" aria-labelledby="lp-payments-heading"><div><span className="lp-kicker">03 — {tr("お金のやりとりも、やさしく")}</span><h2 id="lp-payments-heading">{tr("キャンセル枠を、次のお客様へ。")}<br />{tr("予約が入ると、返金アップ。")}</h2><p>{tr("キャンセル → 割引で再募集 → 成立すると返金アップ。対象の予約は、代わりのお客様を募集できます。お店都合のキャンセルは、全額返金します。")}</p><p>{tr("PayPalで支払済みで、すべてのメニュー・追加メニューが再募集可、かつ受付期限内の予約が対象です。全額返金の期間など、返金アップの条件を満たさない場合は通常のキャンセルになります。")}</p><a href={`/manual?lang=${getLocale()}#guide-cancellation`}>{tr("使い方を見てみる")}<Arrow /></a><p className="lp-payment-note">{tr("再予約は保証されません。受付期限と返金予定額はキャンセルの確認画面に表示します。事前決済にはPayPalの設定が必要です。")}</p></div>
        <div className="lp-refund-card"><div className="lp-refund-top"><span className="lp-kicker">{tr("既定の返金条件での例")}</span><span className="lp-paypal">PayPal</span></div><p className="lp-refund-amount"><span>{tr("予約時のお支払い")}</span><b>¥10,000</b></p><ol className="lp-resale-steps"><li><b>{tr("① 18時間前にキャンセル")}</b><span>{tr("通常の返金予定額は7,000円（70%）。")}</span></li><li><b>{tr("② 10%OFFで再募集")}</b><span>{tr("9,000円の枠として、開始12時間前まで募集。")}</span></li><li><b>{tr("③ 成立すると9,000円を返金")}</b><span>{tr("返金額が7,000円から9,000円に増えます。")}</span></li></ol><p className="lp-refund-footnote">{tr("期限までに成立しなければ、キャンセル時に確認した7,000円で返金します。返金額・割引率・期限は予約時の条件により異なります。")}</p></div>
      </section>
      <section className="lp-data"><div className="lp-container lp-data-inner"><Flower className="lp-data-flower" /><div><span className="lp-kicker">{tr("お店が育てたものは、お店のもの。")}</span><h2>{tr("データも、あなたの手の中に。")}</h2><p>{tr("予約・お客様情報はサービス側に保存し、JSON・CSVで書き出せます。")}</p><p>{tr("写真や書き出したページは、お店のGoogle Driveに保存されます。")}</p><p>{tr("公開ページはサービス側から配信します。Driveにある保存用コピーとは別です。")}</p><a href={`/manual?lang=${getLocale()}#guide-data`}>{tr("データの保存について知る")}<Arrow /></a></div><div className="lp-data-labels"><span>JSON / CSV</span><span>Google Drive</span></div></div></section>
      <section id="faq" className="lp-section lp-container lp-faq" aria-labelledby="lp-faq-heading"><div><span className="lp-kicker">Q & A</span><h2 id="lp-faq-heading">{tr("はじめる前に、")}<br />{tr("気になること。")}</h2></div><div className="lp-faq-list">{[
        [tr("パソコンやシステムに詳しくなくても使えますか？"), tr("はい。お店のことや変更したいことを、文章や声で伝えられます。できあがった内容を画面で確認してから、公開や変更を進めます。")],
        [tr("作りかけのページがお客様に見えてしまいませんか？"), tr("最初は、ログインした本人だけが見られる仮公開です。内容を確かめて、明示的に本番公開に切り替えるまで、お客様には公開されません。")],
        [tr("公開したあとも、メニューや営業時間を変えられますか？"), tr("はい。管理画面で編集できるほか、AIに言葉で変更を依頼できます。変更する内容を確認してから、お客様のページへ反映します。")],
        [tr("お客様の情報は誰が見られますか？"), tr("お客様情報や非公開の接客メモは、店主と許可されたスタッフが運営画面で確認できます。お客様には、ご本人向けの予約情報などを表示します。")],
        [tr("売上や予約の傾向も確認できますか？"), tr("はい。「分析」でスタッフ別・メニュー別の売上、予約ページの閲覧と確定、アクセスを日別・月別で確認できます。期間は過去7・30・90日で、売上は施術終了済みの有効な予約が対象です。")],
        [tr("どんな準備が必要ですか？"), tr("現在は招待制で、招待パスワードとGoogleアカウントが必要です。予約・お客様情報はサービス側に保存し、書き出せます。写真や書き出したページはGoogle Driveに保存し、公開ページはサービス側から配信します。事前決済にはPayPal、AI電話受付にはTwilioとの連携・受付設定が必要です。")],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">＋</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="lp-final"><div className="lp-container"><Flower /><span className="lp-kicker">YOUR SHOP, YOUR WORDS.</span><h2>{tr("あなたのお店のWebページを、")}<br />{tr("AIと、一緒につくりませんか。")}</h2><p>{tr("お店のこと、少し聞かせてください。")}</p><a className="lp-button" href={start}>{tr("AIとWebページをつくる")}<Arrow /></a><p className="lp-cta-note">{tr("現在は招待制です。招待パスワードをご用意ください。")}</p></div></section>
    </main>
    <footer className="lp-footer lp-container"><div><Brand href="/lp" /><p>{tr("お店のシステムを、言葉で。")}</p></div><nav aria-label={tr("関連ページ")}><a href={`/manual?lang=${getLocale()}`}>{tr("使い方")}</a><a href={`/policy?lang=${getLocale()}`}>{tr("プライバシーポリシー")}</a><a href={`/terms?lang=${getLocale()}`}>{tr("利用規約")}</a><a href={start}>{tr("お店の管理画面へ")}<Arrow diagonal /></a></nav><span>© gemihub</span></footer>
  </div>;
}
