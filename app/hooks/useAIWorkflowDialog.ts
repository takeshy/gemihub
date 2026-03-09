import { useState, useCallback } from "react";
import { setCachedFile } from "~/services/indexeddb-cache";
import type { AIWorkflowMeta } from "~/components/ide/AIWorkflowDialog";

export interface AIDialogState {
  mode: "create" | "modify";
  currentYaml?: string;
  currentName?: string;
  currentFileId?: string;
}

/**
 * Manages the AI Workflow dialog state and its accept/create/modify callbacks.
 *
 * Extracted from `IDELayout` to reduce complexity of the index route.
 */
export function useAIWorkflowDialog({
  activeFileId,
  handleSelectFile,
  handleWorkflowChanged,
}: {
  activeFileId: string | null;
  handleSelectFile: (fileId: string, fileName: string, mimeType: string) => void;
  handleWorkflowChanged: () => void;
}) {
  const [aiDialog, setAiDialog] = useState<AIDialogState | null>(null);

  // ---- New workflow creation (opens AI dialog) ----
  const handleNewWorkflow = useCallback(() => {
    setAiDialog({ mode: "create" });
  }, []);

  // ---- Modify workflow with AI ----
  const handleModifyWithAI = useCallback(
    (currentYaml: string, workflowName: string) => {
      setAiDialog({
        mode: "modify",
        currentYaml,
        currentName: workflowName,
        currentFileId: activeFileId || undefined,
      });
    },
    [activeFileId]
  );

  // ---- AI workflow accept handler ----
  const handleAIAccept = useCallback(
    async (yamlContent: string, workflowName: string, meta: AIWorkflowMeta) => {
      const dialogState = aiDialog;

      let workflowId = "";
      let finalName = workflowName;

      try {
        if (dialogState?.mode === "modify" && dialogState.currentFileId) {
          // Update existing workflow
          workflowId = dialogState.currentFileId;
          console.log("[AI Accept] Updating existing file:", dialogState.currentFileId);
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update",
              fileId: dialogState.currentFileId,
              content: yamlContent,
            }),
          });
          if (res.ok) {
            const resData = await res.json();
            console.log("[AI Accept] Drive update OK, md5:", resData.md5Checksum);
            // Update IndexedDB cache so the viewer picks up the new content
            try {
              await setCachedFile({
                fileId: dialogState.currentFileId,
                content: yamlContent,
                md5Checksum: resData.md5Checksum ?? "",
                modifiedTime: resData.file?.modifiedTime ?? "",
                cachedAt: Date.now(),
                fileName: resData.file?.name,
              });
            } catch {
              // IndexedDB write failed — Drive update already succeeded
            }
            // Notify all useFileWithCache hooks so they pick up the new content
            window.dispatchEvent(
              new CustomEvent("file-restored", {
                detail: { fileId: dialogState.currentFileId, content: yamlContent },
              })
            );
            handleWorkflowChanged();
          } else {
            console.error("[AI Accept] Drive update failed:", res.status, await res.text().catch(() => ""));
          }
        } else {
          console.log("[AI Accept] Creating new file. dialogState:", dialogState?.mode, "fileId:", dialogState?.currentFileId);
          // Create new workflow file under workflows/ folder (or skill folder)
          const baseName = workflowName.endsWith(".yaml")
            ? workflowName
            : `${workflowName}.yaml`;
          const folderPath = meta.skillFolderPath || "workflows";
          const fileName = `${folderPath}/${baseName}`;
          const res = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create",
              name: fileName,
              content: yamlContent,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            workflowId = data.file.id;
            finalName = data.file.name;
            // Cache content in IndexedDB so MainViewer can load it instantly
            try {
              await setCachedFile({
                fileId: data.file.id,
                content: yamlContent,
                md5Checksum: data.file.md5Checksum ?? "",
                modifiedTime: data.file.modifiedTime ?? "",
                cachedAt: Date.now(),
                fileName: data.file.name,
              });
            } catch {
              // IndexedDB write failed — Drive create already succeeded
            }
            // Refresh file tree so the new file appears
            window.dispatchEvent(new Event("sync-complete"));
            handleSelectFile(data.file.id, data.file.name, "text/yaml");
          }
        }

        // Close dialog after Drive operations complete
        setAiDialog(null);

        // Save request record (fire-and-forget)
        if (workflowId) {
          const recordId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          fetch("/api/workflow/request-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "save",
              record: {
                id: recordId,
                workflowId,
                workflowName: finalName,
                createdAt: new Date().toISOString(),
                description: meta.description,
                thinking: meta.thinking,
                model: meta.model,
                mode: meta.mode,
                history: meta.history.length > 0 ? meta.history : undefined,
              },
            }),
          }).catch(() => {});
        }
      } catch (err) {
        console.error("[AI Accept] Error:", err);
        setAiDialog(null);
      }
    },
    [aiDialog, handleSelectFile, handleWorkflowChanged]
  );

  return {
    aiDialog,
    setAiDialog,
    handleNewWorkflow,
    handleModifyWithAI,
    handleAIAccept,
  };
}
