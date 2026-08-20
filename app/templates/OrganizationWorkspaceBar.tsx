import { Building2, ChevronDown, Cloud } from "lucide-react";

export interface OrganizationWorkspace {
  organizationName: string;
  storageLabel?: string;
  aiLabel?: string;
}

export const organizationWorkspaceFixture: OrganizationWorkspace = {
  organizationName: "Acme Design",
  storageLabel: "Cloud Storage",
  aiLabel: "Vertex AI",
};

export function OrganizationWorkspaceBar({ workspace }: { workspace: OrganizationWorkspace }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-700 bg-slate-900 px-3 text-slate-100">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600"><Building2 size={15} /></span>
        <button type="button" className="flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-slate-800">
          <span className="truncate">{workspace.organizationName}</span><ChevronDown size={12} className="text-slate-400" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><Cloud size={12} />{workspace.storageLabel}</span>
        <span className="rounded-full border border-violet-700 bg-violet-950/70 px-2 py-0.5 text-violet-300">{workspace.aiLabel}</span>
      </div>
    </div>
  );
}
