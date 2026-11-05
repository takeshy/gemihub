import { formatMoney, currencyOf, regionOf } from "../shared/region.ts";
import { tr, intlLocale, listSeparator } from "../shared/i18n.ts";
import { shopInfographic } from "../shared/shop-infographic.ts";
import { shopSchema, hoursText, type ShopConfig } from "./domain.ts";

// Both the operating screen and the exported SVG use this validated, deterministic model.
export function shopSystem(input: ShopConfig) {
  const c = shopSchema.parse(input);
  const infographic = shopInfographic(c);
  const days = [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
  return {
    name: c.name,
    sections: [
      { title: tr("① お客様の予約"), lines: [
        infographic.bookingFlow.map(step => `${step.label} (${step.detail})`).join(" → "),
        ...c.menus.filter(m => m.active).map(m => tr("{0}：{1}分・{2}", m.name, m.duration, formatMoney(m.price, currencyOf(regionOf(c)), intlLocale()))),
        tr("受付：{0}日前から、開始{1}分前まで。当日予約{2}。", c.rules.advanceDays, c.rules.leadMinutes, c.rules.sameDay ? tr("可") : tr("不可")),
        infographic.payment.summary,
        ...(infographic.payment.policy ? [tr("返金条件（お支払い額に対して）：{0}", infographic.payment.policy)] : []),
        infographic.payment.cancellation,
      ] },
      { title: tr("② 空きを判断する仕組み"), lines: [
        tr("お客様が指名・指名なしを選べます。指名時は選んだスタッフのみ、指名なしは対応するスタッフのうち空いている1人に割り当てます。"),
        tr("営業時間 {0}／{1}分刻み（{2}）", hoursText(c), c.rules.interval, regionOf(c).timeZone),
        tr("定休日：{0}。臨時休業：{1}。", c.hours.closedWeekdays.map(d => days[d] + tr("曜")).join(listSeparator()) || tr("なし"), c.hours.holidays.join(listSeparator()) || tr("なし")),
        ...infographic.staff.map(p => `${p.name}：${p.weekdays.map(d => days[d]).join(listSeparator())} ${p.start}〜${p.end}／${p.menuIds.map(id => c.menus.find(m => m.id === id)!.name).join(listSeparator())}`),
        tr("メニューの所要時間全体について、勤務・営業時間と既存の有効な予約、連携済み Calendar の予定あり時間を照合。重複する予約を防ぎます。"),
      ] },
      { title: tr("③ データの行き先"), lines: [
        tr("予約・問い合わせ・お客様メモ → Firestoreに保存（正本）"),
        tr("メニュー・スタッフ・予約ルール ← Firestoreから読み込み"),
        tr("予約確定・キャンセル → お客様と {0} にメール通知", c.notificationEmail),
        tr("ページ・設定・spec.md・history.md・仕組み図 → 店主の Google ドライブ"),
        tr("お客様メモの画像・添付 → 店主のDriveに非公開保存。メニュー画像は公開中の有効なメニューからだけ配信。"),
        tr("運営画面 → 店主と参加済みメンバー。設定・公開・データの書き出しは店主のみ。"),
        tr("予約・お客様・メニュー等は専用の管理画面で編集。JSON・CSVは「公開の設定」から書き出し。"),
        tr("キャンセル・無断キャンセル → 行を消さず状態を変更して記録。"),
      ] },
      { title: tr("お店のページ"), lines: infographic.pages.map(page => page.title) },
    ],
  };
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]!);
export function systemSvg(config: ShopConfig, detailed = true) {
  config = shopSchema.parse(config);
  const model = shopSystem(config);
  const infographic = shopInfographic(config);
  const fontSize = (text: string, width: number, maximum: number) => Math.min(maximum, (width - 16) / Math.max(1, Array.from(text).reduce((size, char) => size + (char.charCodeAt(0) > 255 ? 1 : 0.6), 0)));
  const node = (x: number, y: number, width: number, label: string, sub: string, fill = "#eef3ee") => `<rect x="${x}" y="${y}" width="${width}" height="76" rx="14" fill="${fill}" stroke="#cbd8ce"/><text x="${x + width / 2}" y="${y + 30}" text-anchor="middle" font-size="${fontSize(label, width, 18)}" font-weight="bold">${escape(label)}</text><text x="${x + width / 2}" y="${y + 56}" text-anchor="middle" font-size="${fontSize(sub, width, 14)}">${escape(sub)}</text>`;
  const arrow = (path: string) => `<path d="${path}" fill="none" stroke="#648575" stroke-width="2.5" marker-end="url(#arrow)"/>`;
  const gap = 24;
  const width = (836 - gap * (infographic.bookingFlow.length - 1)) / infographic.bookingFlow.length;
  const flow = infographic.bookingFlow.map((step, i) => {
    const x = 32 + i * (width + gap);
    return node(x, 120, width, step.label, step.detail) + (i ? arrow(`M${x - gap} 158 H${x - 6}`) : "");
  }).join("");
  const heading = (y: number, label: string) => `<text x="32" y="${y}" font-size="20" font-weight="bold">${escape(label)}</text>`;
  const overview = [
    heading(98, tr("① ログインから予約確定まで")), flow,
    heading(246, tr("② お客様が指名・指名なしを選択")),
    node(32, 306, 200, tr("指名先／対応スタッフ"), tr("スタッフ {0}人・勤務を照合", infographic.staff.length)),
    node(310, 270, 260, tr("選択した条件で空きあり"), tr("施術時間全体が空いている")),
    node(310, 376, 260, tr("選択した条件で空きなし"), tr("勤務外・休業・期限外も不可"), "#f6efeb"),
    node(648, 270, 220, tr("○ 予約できる"), tr("指名先／空いている1人")),
    node(648, 376, 220, tr("× 予約できない"), tr("別の日時を選ぶ"), "#f6efeb"),
    arrow("M232 344 H265 V308 H304"), arrow("M265 344 V414 H304"), arrow("M570 308 H642"), arrow("M570 414 H642"),
    heading(505, tr("③ データの保存と書き出し")),
    node(310, 530, 260, tr("お店のシステム"), tr("予約を保存／承認した内容を公開")),
    node(32, 666, 250, tr("Firestore"), tr("予約・お客様・設定の正本")),
    node(325, 666, 250, tr("Google ドライブ"), tr("画像・添付・ページ・仕様と履歴")),
    node(618, 666, 250, tr("メール通知"), tr("予約確定・取消 → お客様と店主")),
    arrow("M440 606 V632 H157 V660"), arrow("M450 606 V660"), arrow("M460 606 V632 H743 V660"),
    `<text x="450" y="782" text-anchor="middle" font-size="15">${escape(tr("記録はFirestore、画像・添付はDriveへ。JSON・CSVで書き出せます。"))}</text>`,
  ].join("");
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
  return tr("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"900\" height=\"{0}\" viewBox=\"0 0 900 {1}\" role=\"img\" aria-labelledby=\"title\"><defs><marker id=\"arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M0 0 L10 5 L0 10 Z\" fill=\"#648575\"/></marker></defs><title id=\"title\">{2}のお店の仕組み図</title><rect width=\"900\" height=\"{3}\" fill=\"#fffdf8\"/><g font-family=\"sans-serif\" fill=\"#284f43\"><text x=\"32\" y=\"52\" font-size=\"28\">お店の仕組み図</text>{4}{5}</g></svg>", y, y, escape(model.name), y, overview, content);
}
