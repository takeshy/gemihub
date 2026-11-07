import { tr } from "../shared/i18n";
import React from "react";
import type { EditorIndex } from "../server/editor-index-schema";
import type { LocalDraft } from "./local-preview";
import type { SyncStatus } from "./editor-sync";
import { articleKinds } from "../shared/article-features";
export function ScreenTree({ draft, index, statuses, selected, disabled, onChoose }: { draft?: LocalDraft; index?: EditorIndex; statuses: Record<string, SyncStatus>; selected: string; disabled: boolean; onChoose: (screen: string) => void }) {
  const articles = draft ? articleKinds(draft.config) : [];
  // Which side changed: this browser only, production only, or both.
  const badges = {
    local: { label: tr("未反映"), title: tr("このブラウザに、本番へ未反映の変更があります。") },
    remote: { label: tr("本番が更新"), title: tr("本番の内容が更新されています。開くと最新の内容を取り込みます。") },
    conflict: { label: tr("競合"), title: tr("ローカルとリモートに変更があります。開いて比較してください。") },
  };
  const pages = [...(draft?.config.pages || []), ...(index?.pages || []).filter(p => !draft?.config.pages.some(l => l.id === p.id)), ...(draft?.source?.pages || []).filter(p => !draft?.config.pages.some(l => l.id === p.id) && !index?.pages.some(l => l.id === p.id))];
  const groups = [
    { label: tr("予約・お店の情報"), items: [["mine", tr("マイページ")], ["reserve", tr("予約")], ["about", tr("お店のこと")], ["contact", tr("お問い合わせ")]] },
    { label: articles.length === 1 ? articles[0] === "blogs" ? tr("ブログ") : tr("お知らせ") : tr("ブログ・お知らせ"), items: [["blogs", tr("ブログ一覧")], ["blogs:article", tr("ブログ記事")], ["announcements", tr("お知らせ一覧")], ["announcements:article", tr("お知らせ記事")]].filter(([id]) => articles.some(category => id === category || id === `${category}:article`)) },
    { label: tr("追加ページ"), items: pages.map(p => [`page:${p.id}`, p.title]) },
  ];
  const item = (id: string, label: string) => {
    const status = statuses[id === "theme" ? "theme" : id.startsWith("page:") ? id.slice(5) : "content"];
    return <button key={id} role="treeitem" aria-selected={selected === id} disabled={disabled} onClick={() => onChoose(id)}><span className="tree-name">{label}</span>{status && ["local", "remote", "conflict"].includes(status) && <span className={`sync-badge sync-${status}`} title={badges[status as "local" | "remote" | "conflict"].title}>{badges[status as "local" | "remote" | "conflict"].label}</span>}</button>;
  };
  return <div className="screen-tree sidebar-screen-tree" role="tree" aria-label={tr("画面一覧")}>{item("theme", tr("ページ全体"))}{groups.filter(group => group.items.length).map(group => <details open key={group.label}><summary>{group.label}</summary><div role="group">{group.items.map(([id, label]) => item(id, label))}</div></details>)}</div>;
}
