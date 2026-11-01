// Standard sheets have dedicated screens. Other sheets belong in data management.
export const shopData = [
  { sheet: "menus", label: "メニュー・料金・画像", screen: "menus", screenLabel: "メニュー・料金", ownerOnly: true },
  { sheet: "staff", label: "スタッフ・勤務", screen: "staff", screenLabel: "スタッフ・勤務", ownerOnly: true },
  { sheet: "settings", label: "店名・営業時間・予約ルール・共通パーツ", screen: "basic", screenLabel: "お店の基本情報", ownerOnly: true },
  { sheet: "reservations", label: "予約・予約時のメッセージ", screen: "bookings", screenLabel: "予約を管理", ownerOnly: false },
  { sheet: "inquiries", label: "お問い合わせ・返信", screen: "inquiries", screenLabel: "お問い合わせ", ownerOnly: false },
  { sheet: "members", label: "家族・スタッフの参加と権限", screen: "team", screenLabel: "家族・スタッフ", ownerOnly: false },
  { sheet: "posts", label: "ブログ・お知らせ", screen: "blog", screenLabel: "ブログ・お知らせ", ownerOnly: false },
  { sheet: "pages", label: "追加ページ", screen: "try", screenLabel: "画面を試す・編集", ownerOnly: true },
  { sheet: "customers", label: "お客様ごとの情報", screen: "customers", screenLabel: "お客様", ownerOnly: false },
  { sheet: "customer_notes", label: "お客様メモ・画像・添付", screen: "customers", screenLabel: "お客様", ownerOnly: false },
] as const;
