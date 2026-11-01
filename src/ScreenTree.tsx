import React from "react";
import type { EditorIndex } from "../server/editor-index-schema";
import type { LocalDraft } from "./local-preview";
import type { SyncStatus } from "./editor-sync";
export function ScreenTree({ draft, index, statuses, selected, disabled, onChoose }: { draft?: LocalDraft; index?: EditorIndex; statuses: Record<string, SyncStatus>; selected: string; disabled: boolean; onChoose: (screen: string) => void }) {
  const pages = [...(draft?.config.pages || []), ...(index?.pages || []).filter(p => !draft?.config.pages.some(l => l.id === p.id)), ...(draft?.source?.pages || []).filter(p => !draft?.config.pages.some(l => l.id === p.id) && !index?.pages.some(l => l.id === p.id))];
  const groups = [
    { label: "共通パーツ", items: [["part:header", "ヘッダー"], ["part:footer", "フッター"]] },
    { label: "予約・お店の情報", items: [["mine", "マイページ"], ["reserve", "予約"], ["about", "お店のこと"], ["contact", "お問い合わせ"]] },
    { label: "ブログ・お知らせ", items: [["blogs", "ブログ一覧"], ["blogs:article", "ブログ記事"], ["announcements", "お知らせ一覧"], ["announcements:article", "お知らせ記事"]] },
    { label: "追加ページ", items: pages.map(p => [`page:${p.id}`, p.title]) },
  ];
  return <div className="screen-tree sidebar-screen-tree" role="tree" aria-label="画面一覧">{groups.map(group => <details open key={group.label}><summary>{group.label}</summary><div role="group">{group.items.map(([id, label]) => {
    const status = statuses[id.startsWith("page:") ? id.slice(5) : id.startsWith("part:") ? id : "shared"];
    return <button key={id} role="treeitem" aria-selected={selected === id} disabled={disabled} onClick={() => onChoose(id)}><span className="tree-name">{label}</span>{status && ["local", "remote", "conflict"].includes(status) && <span className={`sync-badge sync-${status}`} title={status === "conflict" ? "ローカルとリモートに変更があります。開いて比較してください。" : "変更あり"} aria-label={status === "conflict" ? "変更あり（競合）" : "変更あり"}>変更あり</span>}</button>;
  })}</div></details>)}</div>;
}
