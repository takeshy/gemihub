import { CalendarDays, Columns3, LayoutDashboard, Plus, Redo2, Undo2 } from "lucide-react";
import type { DashboardData } from "~/dashboard/types";
import type { UserSettings } from "~/types/settings";
import { OrganizationWorkspaceBar, type OrganizationWorkspace } from "./OrganizationWorkspaceBar";

export interface DashboardTemplateProps {
  fileName: string;
  initialData: DashboardData;
  settings: UserSettings;
  onChange?: (data: DashboardData) => void;
  organizationWorkspace?: OrganizationWorkspace;
  embedded?: boolean;
}

/** Controlled dashboard screen with no Drive or server lifecycle dependency. */
export function DashboardTemplate({
  fileName,
  initialData,
  settings,
  onChange,
  organizationWorkspace,
  embedded = false,
}: DashboardTemplateProps) {
  const en = settings.language === "en";
  const copy = en
    ? {
        addWidget: "Add widget", progress: "This month's progress", activity: "Recent activity",
        activityItems: ["Generated the weekly report", "Updated the product specification", "Completed the design review"],
        projects: "Projects", projectItems: [["Website renewal", "In progress", "65%"], ["Mobile app", "Review", "88%"], ["Brand guide", "Planning", "24%"], ["Internal portal", "In progress", "52%"]],
        calendar: "Calendar", month: "August 2026",
      }
    : {
        addWidget: "ウィジェットを追加", progress: "今月の進捗", activity: "最近のアクティビティ",
        activityItems: ["週次レポートを生成しました", "製品仕様書が更新されました", "デザインレビューが完了しました"],
        projects: "プロジェクト", projectItems: [["Webサイト刷新", "進行中", "65%"], ["モバイルアプリ", "レビュー", "88%"], ["ブランドガイド", "企画", "24%"], ["社内ポータル", "進行中", "52%"]],
        calendar: "カレンダー", month: "2026年8月",
      };
  return (
    <div className={`flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950 ${embedded ? "h-full min-h-0" : "h-screen min-h-[720px]"}`}>
      {organizationWorkspace && <OrganizationWorkspaceBar workspace={organizationWorkspace} />}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={15} className="text-blue-500" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{fileName}</span>
        </div>
        <div className="flex items-center gap-1 text-gray-500">
          <button type="button" className="rounded p-1.5 hover:bg-gray-100"><Undo2 size={14} /></button>
          <button type="button" className="rounded p-1.5 hover:bg-gray-100"><Redo2 size={14} /></button>
          <button type="button" className="rounded p-1.5 hover:bg-gray-100"><Columns3 size={14} /></button>
          <button type="button" className="ml-1 flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"><Plus size={14} />{copy.addWidget}</button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-12 grid-rows-7 gap-2 overflow-hidden p-3">
        <DashboardCard className="col-span-4 row-span-3" title={copy.progress}>
          <div className="mt-5 flex items-end gap-2"><strong className="text-4xl text-blue-600">72%</strong><span className="pb-1 text-xs text-green-600">+8.4%</span></div>
          <div className="mt-4 h-2 overflow-hidden rounded bg-gray-100"><div className="h-full w-[72%] bg-blue-500" /></div>
        </DashboardCard>
        <DashboardCard className="col-span-8 row-span-3" title={copy.activity}>
          <ul className="mt-3 space-y-2 text-xs">{copy.activityItems.map((item, index) => <li key={item} className={`rounded p-2 ${index === 0 ? "bg-blue-50" : "bg-gray-50"}`}>{item}</li>)}</ul>
        </DashboardCard>
        <DashboardCard className="col-span-7 row-span-4" title={copy.projects}>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            {copy.projectItems.map(([name, status, progress]) => <div key={name} className="rounded-lg border border-gray-200 p-3"><strong className="block">{name}</strong><span className="mt-1 block text-gray-500">{status} · {progress}</span></div>)}
          </div>
        </DashboardCard>
        <DashboardCard className="col-span-5 row-span-4" title={copy.calendar}>
          <div className="mt-3 flex items-center gap-2 text-sm font-medium"><CalendarDays size={16} />{copy.month}</div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">{Array.from({ length: 31 }, (_, index) => <span key={index} className={`rounded py-1 ${index + 1 === 21 ? "bg-blue-600 text-white" : "text-gray-600"}`}>{index + 1}</span>)}</div>
        </DashboardCard>
      </div>
      <button type="button" className="sr-only" onClick={() => onChange?.(initialData)}>{settings.language}</button>
    </div>
  );
}

function DashboardCard({ title, className, children }: { title: string; className: string; children: React.ReactNode }) {
  return <section className={`${className} overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900`}><h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>{children}</section>;
}
