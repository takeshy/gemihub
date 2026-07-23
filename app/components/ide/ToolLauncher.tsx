import { useEffect, useState } from "react";
import { CalendarDays, Columns3, FileText, History, LockKeyhole, Rocket, X } from "lucide-react";
import type { EncryptionSettings } from "~/types/settings";
import MemoListWidget from "~/dashboard/widgets/MemoListWidget";
import TimelineWidget from "~/dashboard/widgets/TimelineWidget";
import SecretManagerWidget from "~/dashboard/widgets/SecretManagerWidget";
import CalendarWidget from "~/dashboard/widgets/CalendarWidget";
import KanbanWidget from "~/dashboard/data-widget/KanbanWidget";
import { useI18n } from "~/i18n/context";

export type LauncherTool = "secret-manager" | "memo-list" | "timeline" | "calendar" | "kanban";

export function ToolLauncher({ open, initialTool, encryptionSettings, onClose }: {
  open: boolean;
  initialTool?: LauncherTool | null;
  encryptionSettings: EncryptionSettings;
  onClose: () => void;
}) {
  const { language } = useI18n();
  const ja = language === "ja";
  const [tool, setTool] = useState<LauncherTool | null>(initialTool ?? null);
  useEffect(() => { if (open) setTool(initialTool ?? null); }, [open, initialTool]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open, onClose]);
  if (!open) return null;

  const tools: Array<{ id: LauncherTool; label: string; help: string; icon: typeof History; color: string }> = [
    { id: "memo-list", label: ja ? "メモ" : "Memos", help: ja ? "文書に残したメモを一覧表示" : "Browse notes attached to documents", icon: FileText, color: "text-amber-600 bg-amber-100 dark:bg-amber-950" },
    { id: "timeline", label: ja ? "タイムライン" : "Timeline", help: ja ? "今日の記録を追加・検索" : "Record and search today's activity", icon: History, color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950" },
    { id: "calendar", label: ja ? "カレンダー" : "Calendar", help: ja ? "予定とタイムラインの実績を確認" : "See scheduled events and Timeline activity", icon: CalendarDays, color: "text-blue-600 bg-blue-100 dark:bg-blue-950" },
    { id: "kanban", label: ja ? "カンバン" : "Kanban", help: ja ? "Tasksフォルダの作業を管理" : "Manage work in the Tasks folder", icon: Columns3, color: "text-violet-600 bg-violet-100 dark:bg-violet-950" },
  ];
  const title = tool === "secret-manager" ? (ja ? "シークレット管理" : "Secret Manager")
    : tools.find((item) => item.id === tool)?.label ?? (ja ? "ランチャー" : "Launcher");

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="flex h-[min(88vh,820px)] w-[min(96vw,1100px)] min-h-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-3 dark:border-gray-700">
        <div className="flex items-center gap-2 font-semibold text-gray-800 dark:text-gray-100">{tool ? <button className="rounded px-2 py-1 text-xs font-normal text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-800" onClick={() => setTool(null)}>← {ja ? "ランチャー" : "Launcher"}</button> : <Rocket size={18} />}{title}</div>
        <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={ja ? "閉じる" : "Close"}><X size={19} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {!tool && <div className="grid h-full content-center gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {tools.map((item) => <button key={item.id} onClick={() => setTool(item.id)} className="flex items-center gap-4 rounded-xl border border-gray-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md dark:border-gray-700 dark:hover:border-blue-500">
            <span className={`rounded-xl p-3 ${item.color}`}><item.icon size={25} /></span>
            <span><span className="block font-semibold text-gray-900 dark:text-gray-100">{item.label}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{item.help}</span></span>
          </button>)}
          <button onClick={() => setTool("secret-manager")} className="flex items-center gap-4 rounded-xl border border-gray-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md dark:border-gray-700 dark:hover:border-blue-500 sm:col-span-2">
            <span className="rounded-xl bg-rose-100 p-3 text-rose-600 dark:bg-rose-950"><LockKeyhole size={25} /></span><span><span className="block font-semibold text-gray-900 dark:text-gray-100">{ja ? "シークレット管理" : "Secret Manager"}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{ja ? "暗号化した認証情報を管理" : "Manage encrypted credentials"}</span></span>
          </button>
        </div>}
        {tool === "secret-manager" && <SecretManagerWidget config={{ folder: "" }} encryptionSettings={encryptionSettings} />}
        {tool === "memo-list" && <MemoListWidget />}
        {tool === "timeline" && <TimelineWidget config={{ name: "Timeline", latestCount: 20, composerMode: "raw" }} />}
        {tool === "calendar" && <CalendarWidget />}
        {tool === "kanban" && <KanbanWidget config={{ title: "Tasks", folder: "Tasks", statusProperty: "status", titleProperty: "title", columns: [{ value: "todo", label: ja ? "未着手" : "To Do" }, { value: "in-progress", label: ja ? "進行中" : "In Progress" }, { value: "done", label: ja ? "完了" : "Done" }] }} />}
      </div>
    </section>
  </div>;
}
