import { WorkflowEditor } from "~/components/ide/WorkflowEditor";
import type { UserSettings } from "~/types/settings";
import { OrganizationWorkspaceBar, type OrganizationWorkspace } from "./OrganizationWorkspaceBar";

export interface WorkflowTemplateProps {
  fileName: string;
  content: string;
  settings: UserSettings;
  onSave?: (content: string) => void | Promise<void>;
  organizationWorkspace?: OrganizationWorkspace;
  embedded?: boolean;
}

/** External-storage-free workflow screen used by Storybook and visual review. */
export function WorkflowTemplate({
  fileName,
  content,
  settings,
  onSave = () => undefined,
  organizationWorkspace,
  embedded = false,
}: WorkflowTemplateProps) {
  return (
    <div className={`flex flex-col overflow-hidden ${embedded ? "h-full min-h-0" : "h-screen min-h-[640px]"}`}>
      {organizationWorkspace && <OrganizationWorkspaceBar workspace={organizationWorkspace} />}
      <div className="flex min-h-0 flex-1">
        <WorkflowEditor
          fileId="storybook-workflow"
          fileName={fileName}
          initialContent={content}
          settings={settings}
          saveToCache={async (next) => {
            await onSave(next);
          }}
        />
      </div>
    </div>
  );
}
