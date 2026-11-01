import { shopSchema, type ShopConfig } from "./domain.ts";

// Both the operating screen and the exported SVG use this validated, deterministic model.
export function shopSystem(input: ShopConfig) {
  const c = shopSchema.parse(input);
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return {
    name: c.name,
    sections: [
      { title: "① お客様の予約", lines: [
        "Google ログイン → メニュー・日時を選択 → 空きを確認 → 予約確定",
        ...c.menus.filter(m => m.active).map(m => `${m.name}：${m.duration}分・${m.price.toLocaleString("ja-JP")}円`),
        `受付：${c.rules.advanceDays}日前から、開始${c.rules.leadMinutes}分前まで。当日予約${c.rules.sameDay ? "可" : "不可"}。`,
        `お客様のキャンセル：開始${c.rules.cancelHours}時間前まで。自分の予約だけ確認・取消できます。`,
      ] },
      { title: "② 空きを判断する仕組み", lines: [
        "お客様が指名・指名なしを選べます。指名時は選んだスタッフのみ、指名なしは対応するスタッフのうち空いている1人に割り当てます。",
        `営業時間 ${c.hours.start}〜${c.hours.end}／${c.rules.interval}分刻み（日本時間）`,
        `定休日：${c.hours.closedWeekdays.map(d => days[d] + "曜").join("・") || "なし"}。臨時休業：${c.hours.holidays.join("・") || "なし"}。`,
        ...c.staff.map(p => `${p.name}：${p.weekdays.map(d => days[d]).join("・")} ${p.start}〜${p.end}／${p.menuIds.map(id => c.menus.find(m => m.id === id)!.name).join("・")}`),
        "メニューの所要時間全体について、勤務・営業時間と既存の有効な予約、連携済み Calendar の予定あり時間を照合。重複する予約を防ぎます。",
      ] },
      { title: "③ データの行き先", lines: [
        "予約・問い合わせ・お客様メモ → 店主の Google スプレッドシートに保存（正本）",
        "メニュー・スタッフ・予約ルール ← 店主の Google スプレッドシートから読み込み",
        `予約確定・キャンセル → お客様と ${c.notificationEmail} にメール通知`,
        "ページ・設定・spec.md・history.md・仕組み図 → 店主の Google ドライブ",
        "お客様メモの画像・添付 → 店主のDriveに非公開保存。メニュー画像は公開中の有効なメニューからだけ配信。",
        "運営画面 → 店主と参加済みメンバー。設定・公開・追加データの編集は店主のみ。",
        "予約・お客様・メニュー等は専用の管理画面へ。専用画面のない追加シートはデータ管理へ。",
        "キャンセル・無断キャンセル → 行を消さず状態を変更して記録。",
      ] },
    ],
  };
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]!);
export function systemSvg(config: ShopConfig, detailed = true) {
  const model = shopSystem(config);
  const node = (x: number, y: number, width: number, label: string, sub: string, fill = "#eef3ee") => `<rect x="${x}" y="${y}" width="${width}" height="76" rx="14" fill="${fill}" stroke="#cbd8ce"/><text x="${x + width / 2}" y="${y + 30}" text-anchor="middle" font-size="18" font-weight="bold">${escape(label)}</text><text x="${x + width / 2}" y="${y + 56}" text-anchor="middle" font-size="14">${escape(sub)}</text>`;
  const arrow = (path: string) => `<path d="${path}" fill="none" stroke="#648575" stroke-width="2.5" marker-end="url(#arrow)"/>`;
  const overview = `
    <text x="32" y="98" font-size="20" font-weight="bold">① ログインから予約確定まで</text>
    ${node(32, 120, 175, "ログイン", "自分の予約だけ見える")}
    ${node(252, 120, 175, "メニュー・日時", "お客様が選ぶ")}
    ${node(472, 120, 175, "空きを確認", "勤務と既存予約を照合")}
    ${node(692, 120, 175, "予約確定", "重複を防いで保存")}
    ${arrow("M207 158 H246")}${arrow("M427 158 H466")}${arrow("M647 158 H686")}
    <text x="32" y="246" font-size="20" font-weight="bold">② お客様が指名・指名なしを選択</text>
    ${node(32, 306, 200, "指名先／対応スタッフ", `スタッフ ${config.staff.length}人・勤務を照合`)}
    ${node(310, 270, 260, "選択した条件で空きあり", "施術時間全体が空いている")}
    ${node(310, 376, 260, "選択した条件で空きなし", "勤務外・休業・期限外も不可", "#f6efeb")}
    ${node(648, 270, 220, "○ 予約できる", "指名先／空いている1人")}
    ${node(648, 376, 220, "× 予約できない", "別の日時を選ぶ", "#f6efeb")}
    ${arrow("M232 344 H265 V308 H304")}${arrow("M265 344 V414 H304")}
    ${arrow("M570 308 H642")}${arrow("M570 414 H642")}
    <text x="32" y="505" font-size="20" font-weight="bold">③ 店主の手元に残るデータとファイル</text>
    ${node(310, 530, 260, "お店のシステム", "予約を保存／承認した内容を公開")}
    ${node(32, 666, 250, "スプレッドシート", "予約・お客様・設定の正本")}
    ${node(325, 666, 250, "Google ドライブ", "画像・添付・ページ・仕様と履歴")}
    ${node(618, 666, 250, "メール通知", "予約確定・取消 → お客様と店主")}
    ${arrow("M440 606 V632 H157 V660")}${arrow("M450 606 V660")}${arrow("M460 606 V632 H743 V660")}
    <text x="450" y="782" text-anchor="middle" font-size="15">台帳の正本と画像・添付は店主の Google アカウントに保存します。</text>`;
  let y = 820;
  const content = (detailed ? model.sections : []).map(section => {
    const lines = section.lines.flatMap(line => {
      const chars = Array.from(line);
      return Array.from({length: Math.ceil(chars.length / 43)}, (_, i) => chars.slice(i * 43, (i + 1) * 43).join(""));
    });
    const height = 70 + lines.length * 27;
    const markup = `<rect x="24" y="${y}" width="852" height="${height}" rx="18" fill="#eef3ee"/><text x="48" y="${y + 36}" font-size="22" font-weight="bold">${escape(section.title)}</text>${lines.map((line, i) => `<text x="48" y="${y + 70 + i * 27}" font-size="17">${escape(line)}</text>`).join("")}`;
    y += height + 36;
    return markup;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${y}" viewBox="0 0 900 ${y}" role="img" aria-labelledby="title"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#648575"/></marker></defs><title id="title">${escape(model.name)}のお店の仕組み図</title><rect width="900" height="${y}" fill="#fffdf8"/><g font-family="sans-serif" fill="#284f43"><text x="32" y="52" font-size="28">お店の仕組み図</text>${overview}${content}</g></svg>`;
}
