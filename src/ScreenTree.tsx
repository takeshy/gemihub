import { tr } from "../shared/i18n";
import React from "react";
import type { EditorIndex } from "../server/editor-index-schema";
import type { LocalDraft } from "./local-preview";
import type { SyncStatus } from "./editor-sync";
export function ScreenTree({ draft, index, statuses, selected, disabled, onChoose }: { draft?: LocalDraft; index?: EditorIndex; statuses: Record<string, SyncStatus>; selected: string; disabled: boolean; onChoose: (screen: string) => void }) {
  const pages = [...(draft?.config.pages || []), ...(index?.pages || []).filter(p => !draft?.config.pages.some(l => l.id === p.id)), ...(draft?.source?.pages || []).filter(p => !draft?.config.pages.some(l => l.id === p.id) && !index?.pages.some(l => l.id === p.id))];
  const groups = [
    { label: tr("共通パーツ"), items: [["part:header", tr("ヘッダー")], ["part:footer", tr("フッター")]] },
    { label: tr("予約・お店の情報"), items: [["mine", tr("マイページ")], ["reserve", tr("予約")], ["about", tr("お店のこと")], ["contact", tr("お問い合わせ")]] },
    { label: tr("ブログ・お知らせ"), items: [["blogs", tr("ブログ一覧")], ["blogs:article", tr("ブログ記事")], ["announcements", tr("お知らせ一覧")], ["announcements:article", tr("お知らせ記事")]] },
    { label: tr("追加ページ"), items: pages.map(p => [`page:${p.id}`, p.title]) },
  ];
  return <div className="screen-tree sidebar-screen-tree" role="tree" aria-label={tr("画面一覧")}>{groups.map(group => <details open key={group.label}><summary>{group.label}</summary><div role="group">{group.items.map(([id, label]) => {
    const status = statuses[id.startsWith("page:") ? id.slice(5) : id.startsWith("part:") ? id : "shared"];
    return <button key={id} role="treeitem" aria-selected={selected === id} disabled={disabled} onClick={() => onChoose(id)}><span className="tree-name">{label}</span>{status && ["local", "remote", "conflict"].includes(status) && <span className={`sync-badge sync-${status}`} title={status === "conflict" ? tr("ローカルとリモートに変更があります。開いて比較してください。") : tr("変更あり")} aria-label={status === "conflict" ? tr("変更あり（競合）") : tr("変更あり")}>{tr("変更あり")}</span>}</button>;
  })}</div></details>)}</div>;
}
