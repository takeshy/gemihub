import { z } from "zod";
export const requestIntentSchema = z.enum(["consult", "modify", "new-page", "create-shop"]);
export type RequestIntent = z.infer<typeof requestIntentSchema>;
export const initialFeatureQuestion = "ほしい機能を次から選んでください。\n1. お店の紹介\n2. 予約\n3. ブログ・お知らせ\n4. お問い合わせ\n\n番号でも言葉でも、複数選べます。";
export const additionalPagesQuestion = "それ以外に欲しいページはありますか？";
export const finalDetailsQuestion = "ほかに伝えたいことはありますか？";
export function answeredFinalDetails(messages:{role:string;text:string}[]) {
  const lastUser=messages.findLastIndex(message=>message.role==="user");
  if(lastUser<0)return false;
  const previous=messages.slice(0,lastUser).filter(message=>message.role==="assistant").at(-1);
  return !!previous&&/(?:ほか|他)に伝えたいことは?ありますか/.test(previous.text.replace(/\s/g,""));
}
export const adaptiveQuestionInstruction = "質問する前に、今回の回答と保存済みの会話から、分かっていること・まだ不明なことを整理してください。回答済みの内容を聞き直さず、画面案や依頼をまとめるために本当に必要な不明点だけを一つずつ質問してください。まとめて回答された内容もすべて考慮し、質問の順番や選択肢を回答に合わせて変えてください。固定の質問一覧を順番に消化しないでください。必要な情報が揃っていれば追加質問をせず提案へ進みます。不明点を勝手に確定せず、相談だけなら提案や変更のための質問を強制しないでください。";
export const requestIntentInstruction: Record<RequestIntent, string> = {
  "create-shop": "初めてのお店づくりです。業種が不明な場合だけ『どういう業種のお店ですか？』と業種を聞いてください。希望の機能が不明なら『ほしい機能を次から選んでください。』と業種に合う機能を1.、2.の番号付きで提示してください。お店の紹介・予約・ブログやお知らせ・お問い合わせなど、番号でも言葉でも複数選べるようにします。希望がすでに伝えられていれば機能の選択は省きます。追加ページの希望が未確認の場合だけ『それ以外に欲しいページはありますか？』と聞いてください。『紹介と予約だけでいい』など希望の範囲が明確なら、この質問も省きます。これらは会話の例であり、固定の必須手順ではありません。業種と必要な機能・ページが分かり、不明点が解消したらchangeRequest=trueとして最後の確認へ進めます。必要な情報が揃ってもすぐ画面案へ進まず、必ず最後に『ほかに伝えたいことはありますか？』と質問し、ready=falseで返答を待ってください。その質問への返答を受け、追加内容も確認できてからready=trueにします。必要な確認が残る場合はready=falseにしてください。スタッフ・料金・営業時間は必須にせず、仮の設定を確定した事実として扱わないでください。後からスタッフや料金を決められるという説明は、聞かれない限りしないでください。",
  consult: "相談のみです。質問への回答と説明を行い、設定の変更や新規ページの作成は依頼されていません。変更プランは作成しないでください。",
  modify: "既存のお店の設定やページの修正依頼です。依頼された箇所だけを変更し、必要なことは確認してください。",
  "new-page": "新しいページの作成依頼です。目的・載せたい内容・お客様向けメニューに表示する名前を確認し、新規のIDとアドレスでpagesに追加してください。既存のページ・予約メニュー・料金・勤務・営業時間は変更しないでください。",
};

export const chatLabels = { consult: "相談", modify: "修正", "new-page": "新ページ作成", "create-shop":"お店づくり" } as const;
export const openingQuestions:Record<RequestIntent,string> = {
  consult:"どんなことを知りたいですか？お店の設定や使い方についてお聞きください。",
  modify:"お店のどこを直したいですか？変更したいことを、ふだんの言葉で教えてください。",
  "new-page":"どんなページを追加したいですか？まずは目的や、載せたい内容を教えてください。",
  "create-shop":"どういう業種のお店ですか？",
};

// Deterministic interview for the demo server and Storybook; production uses the AI.
export function initialSetupDemoReply(question:string,messages:{role:string;text:string}[]) {
  const prefix=requestIntentInstruction["create-shop"]+"\n";
  const answer=question.startsWith(prefix)?question.slice(prefix.length):question;
  const userText=[...messages.filter(message=>message.role==="user").map(message=>message.text),answer].join("\n");
  const assistantMessages=messages.filter(message=>message.role==="assistant");
  const hasIndustry=/ネイル|美容|教室|レッスン|サロン|整体|カフェ|飲食|nail|hair/i.test(userText);
  const selected=/紹介|予約|ブログ|お知らせ|問い合わせ|FAQ|よくある質問/.test(userText)||assistantMessages.some(message=>message.text===initialFeatureQuestion)&&/[1-4１-４]|全部|すべて/.test(answer);
  const askedAdditional=assistantMessages.some(message=>message.text===additionalPagesQuestion);
  const additionalAnswered=/(?:他|ほか|それ以外|追加).{0,24}(?:不要|ありません|いらな|なし|ない)|だけ(?:で|を|に)/.test(userText);
  const complete=hasIndustry&&(askedAdditional||selected&&additionalAnswered);
  const ready=complete&&answeredFinalDetails([...messages,{role:"user",text:answer}]);
  if(ready&&/^(?:はい[、。\s]*)?(?:あります|ある|追加があります|伝えたいことがあります)[。！!\s]*$/.test(answer.trim()))return {answer:"伝えたいことを教えてください。",changeRequest:true,ready:false};
  return {answer:ready?"ご希望の機能とページで、画面案をまとめます。":complete?finalDetailsQuestion:!hasIndustry?openingQuestions["create-shop"]:selected?additionalPagesQuestion:initialFeatureQuestion,changeRequest:true,ready};
}
