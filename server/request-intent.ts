import { tr } from "../shared/i18n.ts";
import { z } from "zod";
export const requestIntentSchema = z.enum(["consult", "modify", "new-page", "create-shop"]);
export type RequestIntent = z.infer<typeof requestIntentSchema>;
export const initialFeatureQuestion = "ほしい機能を次から選んでください。\n1. お店の紹介\n2. 予約\n3. ブログ\n4. お知らせ\n5. お問い合わせ\n6. スタッフ紹介\n7. 商品・サービス紹介\n\n番号でも言葉でも、複数選べます。";
export const additionalPagesQuestion = "それ以外に欲しいページはありますか？";
export const finalDetailsQuestion = "ほかに伝えたいことはありますか？";
export const shopNameQuestion = "お店の名前を教えてください。";
export const logoQuestion = "使いたいロゴはありますか？あれば画像を添付してください。なければ「なし」、後で決める場合は「後で」と教えてください。";
export const logoUploadQuestion = "使いたいロゴの画像を添付してください。まだ用意できない場合は「後で」と教えてください。";
export function initialInterviewFacts(messages: { role: string; text: string; detail?: { imageIds?: string[] } }[]) {
  let name: string | undefined; let logoKnown = false; let awaiting: "name" | "logo" | "features" | undefined;
  let articles: { blogs: boolean; announcements: boolean } | undefined;
  let introductions: { staff: boolean; products: boolean } | undefined;
  for (const message of messages) {
    if (message.role === "assistant") {
      if ([shopNameQuestion, tr(shopNameQuestion)].includes(message.text)) awaiting = "name";
      else if ([logoQuestion, tr(logoQuestion), logoUploadQuestion, tr(logoUploadQuestion)].includes(message.text)) awaiting = "logo";
      else if ([initialFeatureQuestion, tr(initialFeatureQuestion)].includes(message.text)) awaiting = "features";
      continue;
    }
    if (message.role !== "user") continue;
    const explicit = message.text.match(/(?:店名|お店の名前)(?:は|[:：])\s*[「『]?([^\n。、「」『』]+)|(?:shop(?:'s)? name is|name[:：])\s*["']?([^\n.!"']+)/i);
    const value = (explicit?.[1] || explicit?.[2] || (awaiting === "name" ? message.text : "")).trim().replace(/(?:という名前です|といいます|です)[。\s]*$/, "");
    if (value && value.length <= 100 && !/^(?:はじめまして|こんにちは|お願いします|hi|hello|yes|no)[!！。,.\s]*$/i.test(value) && !/(?:参考に|添付画像|この画像|こんなページ|https?:\/\/)/i.test(value)) name = value;
    if ((awaiting === "logo" || /ロゴ|logo/i.test(message.text)) && (/なし|無い|ない|ありません|不要|後で|あとで|未定|(?:^|\b)(?:no|none|later|not yet)(?:\b|$)/i.test(message.text) || !!message.detail?.imageIds?.length || /https:\/\//.test(message.text))) logoKnown = true;
    if (awaiting === "features" || /だけ|only/i.test(message.text) && /紹介|予約|ブログ|お知らせ|問い合わせ|introduction|about|booking|blog|announcement|inquir|staff|product/i.test(message.text)) {
      const normalized = message.text.normalize("NFKC");
      const numbers = [...normalized.matchAll(/\b[1-7]\b/g)].map(m => Number(m[0]));
      const all = /全部|すべて|\ball\b/i.test(normalized);
      articles = { blogs: all || (numbers.length ? numbers.includes(3) : /ブログ|blog/i.test(normalized) && !/ブログ.{0,5}(?:不要|なし|いらな)|no blog/i.test(normalized)), announcements: all || (numbers.length ? numbers.includes(4) : /お知らせ|announcement/i.test(normalized) && !/お知らせ.{0,5}(?:不要|なし|いらな)|no announcement/i.test(normalized)) };
      introductions = { staff: all || (numbers.length ? numbers.includes(6) : /スタッフ紹介|staff|team/i.test(normalized)), products: all || (numbers.length ? numbers.includes(7) : /商品|サービス紹介|product|service introduction/i.test(normalized)) };
    }
    if (/スタッフ.{0,12}(?:紹介|ページ)|staff.{0,12}(?:page|introduction)|team page/i.test(message.text) && !/スタッフ.{0,8}(?:不要|なし|いらな)|no staff/i.test(message.text)) introductions = { staff: true, products: introductions?.products || false };
    if (/商品.{0,12}(?:紹介|ページ)|サービス紹介|product.{0,12}(?:page|introduction)/i.test(message.text) && !/商品.{0,8}(?:不要|なし|いらな)|no product/i.test(message.text)) introductions = { staff: introductions?.staff || false, products: true };
    awaiting = undefined;
  }
  return { name, logoKnown, articles, introductions, question: !name ? tr(shopNameQuestion) : !logoKnown ? tr(messages.filter(m => m.role === "assistant").some(m => [logoQuestion, tr(logoQuestion), logoUploadQuestion, tr(logoUploadQuestion)].includes(m.text)) ? logoUploadQuestion : logoQuestion) : undefined };
}
export function answeredFinalDetails(messages:{role:string;text:string}[]) {
  const lastUser=messages.findLastIndex(message=>message.role==="user");
  if(lastUser<0)return false;
  const previous=messages.slice(0,lastUser).filter(message=>message.role==="assistant").at(-1);
  return !!previous && (/(?:ほか|他)に伝えたいことは?ありますか/.test(previous.text.replace(/\s/g,"")) || /anything else (?:you[’']?d like to add|to add|you would like to (?:add|share))\s*\?/i.test(previous.text));
}
export const adaptiveQuestionInstruction = "質問する前に、今回の回答と保存済みの会話から、分かっていること・まだ不明なことを整理してください。回答済みの内容を聞き直さず、画面案や依頼をまとめるために本当に必要な不明点だけを一つずつ質問してください。まとめて回答された内容もすべて考慮し、質問の順番や選択肢を回答に合わせて変えてください。固定の質問一覧を順番に消化しないでください。必要な情報が揃っていれば追加質問をせず提案へ進みます。不明点を勝手に確定せず、相談だけなら提案や変更のための質問を強制しないでください。";
export const requestIntentInstruction: Record<RequestIntent, string> = {
  get "create-shop"() { return tr("初めてのお店づくりです。業種が不明な場合だけ『どういう業種のお店ですか？』と業種を聞いてください。希望の機能が不明なら『ほしい機能を次から選んでください。』と業種に合う機能を1.、2.の番号付きで提示してください。お店の紹介・予約・ブログ・お知らせ・お問い合わせ・スタッフ紹介・商品やサービス紹介をそれぞれ別の選択肢にして、番号でも言葉でも複数選べるようにします。希望がすでに伝えられていれば機能の選択は省きます。追加ページの希望が未確認の場合だけ『それ以外に欲しいページはありますか？』と聞いてください。『紹介と予約だけでいい』など希望の範囲が明確なら、この質問も省きます。これらは会話の例であり、固定の必須手順ではありません。業種と必要な機能・ページが分かり、不明点が解消したらchangeRequest=trueとして最後の確認へ進めます。必要な情報が揃ってもすぐ画面案へ進まず、必ず最後に『ほかに伝えたいことはありますか？』と質問し、ready=falseで返答を待ってください。その質問への返答を受け、追加内容も確認できてからready=trueにします。必要な確認が残る場合はready=falseにしてください。スタッフ・料金・営業時間は必須にせず、仮の設定を確定した事実として扱わないでください。後からスタッフや料金を決められるという説明は、聞かれない限りしないでください。"); },
  get consult() { return tr("相談のみです。質問への回答と説明を行い、設定の変更や新規ページの作成は依頼されていません。変更プランは作成しないでください。"); },
  get modify() { return tr("公開後のお店への変更依頼です。既存の設定やページの修正と、新しいページの追加のどちらも受け付けます。どうしたいかが分からなければ短く聞いてください。依頼された箇所だけを変更し、新しいページは目的・載せたい内容・お客様向けメニューに表示する名前を確認して、新規のIDとアドレスでpagesに追加してください。"); },
  get "new-page"() { return tr("新しいページの作成依頼です。目的・載せたい内容・お客様向けメニューに表示する名前を確認し、新規のIDとアドレスでpagesに追加してください。既存のページ・予約メニュー・料金・勤務・営業時間は変更しないでください。"); },
};

export const chatLabels = { get consult() { return tr("相談"); }, get modify() { return tr("修正"); }, get "new-page"() { return tr("新ページ作成"); }, get "create-shop"() { return tr("お店づくり"); } } as const;
export const openingQuestions:Record<RequestIntent,string> = {
  get consult() { return tr("どんなことを知りたいですか？お店の設定や使い方についてお聞きください。"); },
  get modify() { return tr("どうしたいですか？直したいことや追加したいページを、ふだんの言葉で教えてください。"); },
  get "new-page"() { return tr("どんなページを追加したいですか？まずは目的や、載せたい内容を教えてください。"); },
  get "create-shop"() { return tr(shopNameQuestion); },
};

// Deterministic interview for the demo server and Storybook; production uses the AI.
export function initialSetupDemoReply(question:string,messages:{role:string;text:string}[]) {
  const prefix=requestIntentInstruction["create-shop"]+"\n";
  const answer=question.startsWith(prefix)?question.slice(prefix.length):question;
  const facts = initialInterviewFacts([...messages, { role: "user", text: answer }]);
  if (facts.question) return { answer: facts.question, changeRequest: true, ready: false };
  const userText=[...messages.filter(message=>message.role==="user").map(message=>message.text),answer].join("\n");
  const assistantMessages=messages.filter(message=>message.role==="assistant");
  const hasIndustry=/ネイル|美容|教室|レッスン|サロン|整体|カフェ|飲食|nail|hair|salon|cafe|café|class|lesson|restaurant|massage/i.test(userText);
  const selected=/紹介|予約|ブログ|お知らせ|問い合わせ|FAQ|よくある質問|introduction|about|booking|blog|announcement|inquir|contact/i.test(userText)||assistantMessages.some(message=>[initialFeatureQuestion,tr(initialFeatureQuestion)].includes(message.text))&&/[1-7１-７]|全部|すべて|all/i.test(answer);
  const askedAdditional=assistantMessages.some(message=>[additionalPagesQuestion,tr(additionalPagesQuestion)].includes(message.text));
  const additionalAnswered=/(?:他|ほか|それ以外|追加).{0,24}(?:不要|ありません|いらな|なし|ない)|だけ(?:で|を|に)|(?:no|not any|nothing) (?:other|else|additional)|only (?:about|introduction|booking)/i.test(userText);
  const complete=hasIndustry&&(askedAdditional||selected&&additionalAnswered);
  const ready=complete&&answeredFinalDetails([...messages,{role:"user",text:answer}]);
  if(ready&&/^(?:はい[、。\s]*)?(?:あります|ある|追加があります|伝えたいことがあります)[。！!\s]*$|^(?:yes[,.!\s]*)?(?:I (?:have|would like to add) (?:something|more)|there is more|yes)[.!\s]*$/i.test(answer.trim()))return {answer:tr("伝えたいことを教えてください。"),changeRequest:true,ready:false};
  return {answer:ready?tr("ご希望の機能とページで、画面案をまとめます。"):complete?tr(finalDetailsQuestion):!hasIndustry?tr("どういう業種のお店ですか？"):selected?tr(additionalPagesQuestion):tr(initialFeatureQuestion),changeRequest:true,ready};
}
