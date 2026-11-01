import { tr } from "../shared/i18n.ts";
export const shopData = [
  { sheet: "menus", get label() { return tr("メニュー・料金・画像"); }, screen: "menus", get screenLabel() { return tr("メニュー・料金"); }, ownerOnly: true },
  { sheet: "staff", get label() { return tr("スタッフ・勤務"); }, screen: "staff", get screenLabel() { return tr("スタッフ・勤務"); }, ownerOnly: true },
  { sheet: "settings", get label() { return tr("店名・営業時間・予約ルール・共通パーツ"); }, screen: "basic", get screenLabel() { return tr("お店の基本情報"); }, ownerOnly: true },
  { sheet: "reservations", get label() { return tr("予約・予約時のメッセージ"); }, screen: "bookings", get screenLabel() { return tr("予約を管理"); }, ownerOnly: false },
  { sheet: "inquiries", get label() { return tr("お問い合わせ・返信"); }, screen: "inquiries", get screenLabel() { return tr("お問い合わせ"); }, ownerOnly: false },
  { sheet: "members", get label() { return tr("家族・スタッフの参加と権限"); }, screen: "team", get screenLabel() { return tr("家族・スタッフ"); }, ownerOnly: false },
  { sheet: "posts", get label() { return tr("ブログ・お知らせ"); }, screen: "blog", get screenLabel() { return tr("ブログ・お知らせ"); }, ownerOnly: false },
  { sheet: "pages", get label() { return tr("追加ページ"); }, screen: "try", get screenLabel() { return tr("画面を試す・編集"); }, ownerOnly: true },
  { sheet: "customers", get label() { return tr("お客様ごとの情報"); }, screen: "customers", get screenLabel() { return tr("お客様"); }, ownerOnly: false },
  { sheet: "customer_notes", get label() { return tr("お客様メモ・画像・添付"); }, screen: "customers", get screenLabel() { return tr("お客様"); }, ownerOnly: false },
  { sheet: "ai_chats", internal: true, get label() { return tr("AIとのチャット一覧"); }, screen: "build", get screenLabel() { return tr("AIとお店をつくる"); }, ownerOnly: false },
  { sheet: "ai_chat_messages", internal: true, get label() { return tr("AIとの会話履歴"); }, screen: "build", get screenLabel() { return tr("AIとお店をつくる"); }, ownerOnly: false },
] as const;
