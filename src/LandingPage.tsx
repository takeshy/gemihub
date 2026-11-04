import React, { useState } from "react";
import { getLocale, tr } from "../shared/i18n";
import { Brand } from "./Brand";
import { LanguageSwitcher } from "./LanguageSwitcher";

export const landingTitle = () => tr("gemihub — お店のことばが、お店のしくみに。");
export const landingDescription = () => tr("いつもの言葉で、あなたのお店に合うホームページと予約の仕組みを。予約・お客様メモ・お知らせをひとつにつなぐ、小さなお店のためのgemihub。");

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h15m-6-6 6 6-6 6"} /></svg>;
}
function Flower({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 160 160" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1.2"><ellipse cx="80" cy="80" rx="20" ry="63" /><ellipse cx="80" cy="80" rx="20" ry="63" transform="rotate(45 80 80)" /><ellipse cx="80" cy="80" rx="20" ry="63" transform="rotate(90 80 80)" /><ellipse cx="80" cy="80" rx="20" ry="63" transform="rotate(135 80 80)" /></g><circle cx="80" cy="80" r="12" fill="currentColor" /></svg>;
}
const appLink = () => `/?lang=${getLocale()}`;

function HeroPreview() {
  return <div className="lp-hero-art" aria-label={tr("会話から予約ページを作る画面イメージ")}>
    <div className="lp-orbit" aria-hidden="true" />
    <div className="lp-preview-label"><span className="lp-dot" />{tr("あなたのお店に、合わせてつくる。")}</div>
    <div className="lp-sample-site">
      <div className="lp-window-bar"><span>● ● ●</span><span>{tr("nail atelier 凪")}</span><Arrow diagonal /></div>
      <div className="lp-sample-nav"><b>Nagi.</b><span>NAIL & CARE</span></div>
      <div className="lp-salon-hero"><div><span>NAIL ATELIER</span><p>{tr("指先に、")}<br />{tr("小さなときめき。")}</p><span className="lp-sample-book">{tr("ご予約はこちら")}<Arrow /></span></div><div className="lp-botanical"><Flower /><span className="lp-vase" /></div></div>
      <div className="lp-sample-service"><div><span>01 / HAND CARE</span><strong>{tr("わたしに似合う、ネイルを。")}</strong></div><span>¥5,500 <Arrow diagonal /></span></div>
      <div className="lp-sample-caption">{tr("架空のお店の画面イメージ")}</div>
    </div>
    <div className="lp-chat-note"><span className="lp-chat-avatar">g✳</span><div><small>{tr("たとえば、こんなふうに。")}</small><p>{tr("火曜日はお休み。指名なしでも予約できるようにしたい。")}</p></div></div>
    <div className="lp-confirm-note"><span>✓</span><div><b>{tr("お店のルールに合わせました")}</b><small>{tr("画面を確かめてから、公開できます。")}</small></div></div>
  </div>;
}

function FeaturePreview() {
  const [selected, setSelected] = useState<"booking" | "customers" | "posts">("booking");
  const features = [
    { id: "booking", label: tr("予約管理"), number: "01", title: tr("予約を、ひと目で。"), text: tr("メニューも、スタッフの勤務も、お休みも。お店のルールに合う空き時間だけを、お客様にご案内します。"), image: "09-bookings.jpg", alt: tr("日付やスタッフで絞り込める予約管理画面") },
    { id: "customers", label: tr("お客様メモ"), number: "02", title: tr("次の「いらっしゃいませ」に。"), text: tr("来店の履歴や、前回のお話、施術の写真。お客様ごとのメモを残して、次の接客につなげられます。"), image: "27-customer-timeline.jpg", alt: tr("お客様ごとの来店履歴と非公開メモの画面") },
    { id: "posts", label: tr("ブログ・お知らせ"), number: "03", title: tr("お店の今を、届ける。"), text: tr("季節のメニューも、臨時休業のお知らせも。自分で書いても、AIと一緒に考えても。写真を添えて、お店のページへ。"), image: "16-blog-edit.jpg", alt: tr("写真と文章を編集するブログ画面") },
  ] as const;
  const feature = features.find(item => item.id === selected)!;
  return <div className="lp-feature-preview">
    <div className="lp-feature-tabs" role="group" aria-label={tr("紹介する機能を選ぶ")}>
      {features.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} aria-controls="lp-feature-panel" onClick={() => setSelected(item.id)}><span>{item.number}</span>{item.label}</button>)}
    </div>
    <div className="lp-feature-layout" id="lp-feature-panel">
      <div className="lp-feature-copy" aria-live="polite"><span className="lp-kicker">{feature.number} / {feature.label}</span><h3>{feature.title}</h3><p>{feature.text}</p><a href={`/manual?lang=${getLocale()}`}>{tr("使い方を見てみる")}<Arrow /></a></div>
      <div className="lp-product-frame"><div className="lp-window-bar"><span>● ● ●</span><span>gemihub / {feature.label}</span></div><img key={feature.image} src={`/manual/${getLocale() === "en" ? "en/" : ""}${feature.image}`} alt={feature.alt} width="1280" height="900" loading="lazy" /></div>
    </div>
  </div>;
}

export function LandingPage() {
  const start = appLink();
  return <div className="lp">
    <a className="lp-skip" href="#lp-main">{tr("本文へ移動")}</a>
    <header className="lp-header"><Brand href="/lp" /><nav className="lp-nav" aria-label={tr("サービス紹介のメニュー")}><a href="#features">{tr("できること")}</a><a href="#how-it-works">{tr("はじめかた")}</a><a href="#faq">{tr("よくある質問")}</a></nav><div className="lp-header-actions"><LanguageSwitcher /><a className="lp-header-start" href={start}>{tr("はじめる")}<Arrow diagonal /></a></div></header>
    <main id="lp-main">
      <section className="lp-hero lp-container" aria-labelledby="lp-heading">
        <div className="lp-hero-copy"><span className="lp-kicker"><span className="lp-dot" />{tr("小さなお店の、大切な毎日に。")}</span><h1 id="lp-heading">{tr("お店のことばが、")}<br /><span>{tr("お店のしくみに。")}</span></h1><p className="lp-hero-lead">{tr("「こんなお店にしたい」を、いつもの言葉で。")}<br />{tr("ホームページも、予約も、その先の接客も。")}<br />{tr("あなたらしく続けられる、お店の仕組みをつくります。")}</p><a className="lp-button" href={start}>{tr("お店づくりをはじめる")}<Arrow /></a><p className="lp-cta-note">{tr("まずは画面を確かめるところから。公開はそのあとで。")}</p><a className="lp-scroll-link" href="#features"><span>↓</span>{tr("gemihubでできること")}</a></div>
        <HeroPreview />
      </section>
      <div className="lp-intro-strip"><span>{tr("つくる時間を、向き合う時間に。")}</span><div><span>{tr("ホームページ")}</span><i>＋</i><span>{tr("予約受付")}</span><i>＋</i><span>{tr("お客様の記録")}</span><i>＋</i><span>{tr("お知らせ")}</span></div></div>
      <section id="features" className="lp-section lp-container" aria-labelledby="lp-features-heading"><div className="lp-section-heading"><div><span className="lp-kicker">01 — {tr("お店の毎日を、ひとつに")}</span><h2 id="lp-features-heading">{tr("予約だけで、終わらない。")}<br />{tr("お客様との、その先まで。")}</h2></div><p>{tr("いくつもの画面を行ったり来たりする代わりに。予約から接客、お店からの発信まで、ひとつの場所でつながります。")}</p></div><FeaturePreview /></section>
      <section id="how-it-works" className="lp-process"><div className="lp-container"><span className="lp-kicker">02 — {tr("いつもの言葉で、少しずつ")}</span><div className="lp-section-heading"><h2>{tr("話して、確かめて、")}<br />{tr("お店の扉をひらく。")}</h2><p>{tr("最初から、全部決まっていなくても大丈夫。お店に必要なことを、一緒に整理していきます。")}</p></div><ol className="lp-steps"><li><span>01</span><h3>{tr("お店のことを話す")}</h3><p>{tr("どんなお店か、どんな予約を受けたいか。文章でも声でも、いつもの言葉で伝えてください。")}</p><div className="lp-step-example">{tr("「夫婦で営む、小さなサロンです」")}</div></li><li><span>02</span><h3>{tr("画面で、確かめる")}</h3><p>{tr("できあがったページを実際に触って確認。気になるところは、また言葉で直せます。")}</p><div className="lp-step-example">{tr("「この見出しを、もう少しやわらかく」")}</div></li><li><span>03</span><h3>{tr("納得してから、公開")}</h3><p>{tr("まずは自分だけが見られる仮公開で。準備が整ったら、お客様が使えるページに切り替えます。")}</p><div className="lp-step-example">{tr("公開後の変更も、確かめてから反映。")}</div></li></ol></div></section>
      <section className="lp-payments lp-container" aria-labelledby="lp-payments-heading"><div><span className="lp-kicker">03 — {tr("お金のやりとりも、やさしく")}</span><h2 id="lp-payments-heading">{tr("キャンセルのたびに、")}<br />{tr("気をつかわなくていい。")}</h2><p>{tr("PayPalの事前決済を有効にすると、予約時にお支払い。キャンセル時は、予約したときの条件に応じて自動で返金します。")}</p><p>{tr("「前日までは半額にしたい」。そんなルールも言葉で調整。お店都合のキャンセルは、全額返金します。")}</p><span className="lp-payment-note">{tr("事前決済にはPayPalの設定が必要です。")}</span></div><div className="lp-refund-card"><div className="lp-refund-top"><span className="lp-kicker">{tr("返金条件の設定例")}</span><span className="lp-paypal">PayPal</span></div><p className="lp-refund-amount"><span>{tr("予約時のお支払い")}</span><b>¥10,000</b></p><div className="lp-refund-rules"><div><span>{tr("72時間以上前")}</span><b>100%</b></div><div className="lp-refund-active"><span>{tr("24時間以上前〜72時間未満")}</span><b>50%</b></div><div><span>{tr("24時間未満")}</span><b>0%</b></div></div><div className="lp-refund-result"><span>↳ {tr("予約の30時間前にキャンセルすると")}</span><b>¥5,000 <small>{tr("を自動返金")}</small></b></div><p className="lp-refund-footnote">{tr("条件はお店ごとに設定。予約時の条件で計算します。")}</p></div></section>
      <section className="lp-data"><div className="lp-container lp-data-inner"><Flower className="lp-data-flower" /><div><span className="lp-kicker">{tr("お店が育てたものは、お店のもの。")}</span><h2>{tr("データも、あなたの手の中に。")}</h2><p>{tr("予約やお客様の記録は安全に保存し、JSON・CSVでいつでも書き出せます。写真やページはGoogle Driveに保存されます。")}</p><a href={`/manual?lang=${getLocale()}`}>{tr("データの保存について知る")}<Arrow /></a></div><div className="lp-data-labels"><span>JSON / CSV</span><span>Google Drive</span></div></div></section>
      <section id="faq" className="lp-section lp-container lp-faq" aria-labelledby="lp-faq-heading"><div><span className="lp-kicker">Q & A</span><h2 id="lp-faq-heading">{tr("はじめる前に、")}<br />{tr("気になること。")}</h2></div><div className="lp-faq-list">{[
        [tr("パソコンやシステムに詳しくなくても使えますか？"), tr("はい。お店のことや変更したいことを、文章や声で伝えられます。できあがった内容を画面で確認してから、公開や変更を進めます。")],
        [tr("作りかけのページがお客様に見えてしまいませんか？"), tr("最初は、ログインした本人だけが見られる仮公開です。内容を確かめて、明示的に本番公開に切り替えるまで、お客様には公開されません。")],
        [tr("公開したあとも、メニューや営業時間を変えられますか？"), tr("はい。管理画面で編集できるほか、AIに言葉で変更を依頼できます。変更する内容を確認してから、お客様のページへ反映します。")],
        [tr("どんな準備が必要ですか？"), tr("お店をはじめるにはGoogleアカウントを使います。予約などの記録はサービス側に、画像やページはお店のGoogle Driveに保存します。事前決済を使う場合は、別途PayPalの設定が必要です。")],
      ].map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">＋</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="lp-final"><div className="lp-container"><Flower /><span className="lp-kicker">YOUR SHOP, YOUR WORDS.</span><h2>{tr("あなたらしいお店を、")}<br />{tr("あなたの言葉から。")}</h2><p>{tr("お店のこと、少し聞かせてください。")}</p><a className="lp-button" href={start}>{tr("お店づくりをはじめる")}<Arrow /></a></div></section>
    </main>
    <footer className="lp-footer lp-container"><div><Brand href="/lp" /><p>{tr("お店のシステムを、言葉で。")}</p></div><nav aria-label={tr("関連ページ")}><a href={`/manual?lang=${getLocale()}`}>{tr("使い方")}</a><a href={`/policy?lang=${getLocale()}`}>{tr("プライバシーポリシー")}</a><a href={`/terms?lang=${getLocale()}`}>{tr("利用規約")}</a><a href={start}>{tr("お店の管理画面へ")}<Arrow diagonal /></a></nav><span>© gemihub</span></footer>
  </div>;
}
