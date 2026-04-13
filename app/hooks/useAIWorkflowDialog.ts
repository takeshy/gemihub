import { useState, useCallback } from "react";
import yaml from "js-yaml";
import { getCachedFile, getCachedFileTree, setCachedFile } from "~/services/indexeddb-cache";
import type { CachedTreeNode } from "~/services/indexeddb-cache";
import { parseFrontmatter } from "~/services/skill-loader";
import type { AIWorkflowMeta } from "~/components/ide/AIWorkflowDialog";

export interface AIDialogState {
  mode: "create" | "modify";
  currentYaml?: string;
  currentName?: string;
  currentFileId?: string;
  /** When true, the dialog runs in skill mode (create/modify a skill). */
  forceSkill?: boolean;
  /** Existing skill instructions body (SKILL.md body) for Modify Skill with AI. */
  existingInstructions?: string;
  /** Path of the referenced workflow file relative to the skill folder,
   *  e.g., "workflows/run-lint.yaml". Forwarded to the prompt so the AI
   *  preserves the real frontmatter reference rather than inventing one
   *  from the skill name. */
  workflowFilePath?: string;
  /** Modify-skill metadata — used by handleAIAccept to rewrite SKILL.md. */
  skillContext?: {
    skillFileId: string;
    skillFileName: string;
    skillFolderPath: string;
    skillName: string;
    skillDescription: string;
    frontmatter: Record<string, unknown>;
    workflowFileId: string;
    workflowFilePath: string;
    declaredWorkflows: Array<{ path: string; name?: string; description?: string }>;
    instructions: string;
  };
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

  // ---- New workflow / skill creation (opens AI dialog) ----
  const handleNewWorkflow = useCallback((options?: { forceSkill?: boolean }) => {
    setAiDialog({ mode: "create", forceSkill: options?.forceSkill ?? false });
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

  // ---- Modify skill with AI (when active file is SKILL.md) ----
  const handleModifySkillWithAI = useCallback(
    async (skillFileId: string, skillFileName: string) => {
      const cached = await getCachedFile(skillFileId);
      if (!cached) {
        console.error("[Modify Skill] SKILL.md not in cache:", skillFileId);
        return;
      }
      const { frontmatter, body } = parseFrontmatter(cached.content);
      const skillName = (frontmatter.name as string | undefined) || "skill";
      const skillDescription = (frontmatter.description as string | undefined) || "";
      const declaredWorkflows = Array.isArray(frontmatter.workflows)
        ? (frontmatter.workflows as Array<{ path?: string; name?: string; description?: string }>)
            .filter((w): w is { path: string } & typeof w => typeof w?.path === "string" && w.path.length > 0)
            .map((w) => ({
              path: w.path,
              name: typeof w.name === "string" ? w.name : undefined,
              description: typeof w.description === "string" ? w.description : undefined,
            }))
        : [];

      // Locate the skill folder and its workflow file via the cached tree.
      const tree = await getCachedFileTree();
      if (!tree) {
        console.error("[Modify Skill] file tree not cached");
        return;
      }
      const skillNode = findNodeById(tree.items, skillFileId);
      if (!skillNode) {
        console.error("[Modify Skill] SKILL.md not found in tree:", skillFileId);
        return;
      }
      // Parent folder of SKILL.md is the skill folder.
      const skillFolder = findParent(tree.items, skillFileId);
      if (!skillFolder) {
        console.error("[Modify Skill] skill folder not found for:", skillFileId);
        return;
      }
      const skillFolderPath = buildPathFromRoot(tree.items, skillFolder.id);

      // Resolve the target workflow: prefer declaredWorkflows[0].path; else first .yaml in workflows/.
      const firstDeclared = declaredWorkflows[0];
      let workflowFileId: string | undefined;
      let workflowFilePath = "";
      if (firstDeclared) {
        const parts = firstDeclared.path.split("/");
        let node: CachedTreeNode | undefined;
        let searchChildren = skillFolder.children ?? [];
        for (const part of parts) {
          node = findChildByName(searchChildren, part);
          if (!node) break;
          searchChildren = node.children || [];
        }
        if (node && !node.isFolder) {
          workflowFileId = node.id;
          workflowFilePath = firstDeclared.path;
        }
      }
      if (!workflowFileId) {
        const workflowsFolder = findChildByName(skillFolder.children ?? [], "workflows");
        if (workflowsFolder?.isFolder && workflowsFolder.children) {
          const firstYaml = workflowsFolder.children.find(
            (c) => !c.isFolder && (c.name.endsWith(".yaml") || c.name.endsWith(".yml")),
          );
          if (firstYaml) {
            workflowFileId = firstYaml.id;
            workflowFilePath = `workflows/${firstYaml.name}`;
          }
        }
      }

      if (!workflowFileId) {
        console.error("[Modify Skill] no workflow file found for skill:", skillFileId);
        return;
      }

      const wfCached = await getCachedFile(workflowFileId);
      if (!wfCached) {
        console.error("[Modify Skill] workflow file not in cache:", workflowFileId);
        return;
      }

      setAiDialog({
        mode: "modify",
        currentYaml: wfCached.content,
        currentName: skillName,
        currentFileId: workflowFileId,
        forceSkill: true,
        existingInstructions: body.trim(),
        workflowFilePath,
        skillContext: {
          skillFileId,
          skillFileName,
          skillFolderPath,
          skillName,
          skillDescription,
          frontmatter: frontmatter as Record<string, unknown>,
          workflowFileId,
          workflowFilePath,
          declaredWorkflows,
          instructions: body.trim(),
        },
      });
    },
    [],
  );

  // ---- AI workflow accept handler ----
  const handleAIAccept = useCallback(
    async (yamlContent: string, workflowName: string, meta: AIWorkflowMeta) => {
      const dialogState = aiDialog;

      let workflowId = "";
      let finalName = workflowName;

      try {
        // ── Modify Skill with AI: rewrite SKILL.md + workflow YAML together ──
        if (dialogState?.mode === "modify" && dialogState.skillContext) {
          const ctx = dialogState.skillContext;
          workflowId = ctx.workflowFileId;
          finalName = workflowName || ctx.skillName;

          // Build the new SKILL.md content FIRST so that any serialization
          // failure fails before we write anything to Drive.
          const newInstructions = (meta.skillMdContent ?? ctx.instructions).trim();
          const newName = workflowName || ctx.skillName;
          const effectiveDescription = ctx.skillDescription.trim() || newName;
          const nextFrontmatter: Record<string, unknown> = {
            ...ctx.frontmatter,
            name: newName,
            description: effectiveDescription,
            workflows: ctx.declaredWorkflows.length > 0
              ? ctx.declaredWorkflows
              : [{ path: ctx.workflowFilePath, description: newName }],
          };
          const frontmatterYaml = yaml.dump(nextFrontmatter, {
            lineWidth: -1,
            noRefs: true,
          }).trimEnd();
          const newSkillMd = `---\n${frontmatterYaml}\n---\n\n${newInstructions}\n`;

          // Capture the original workflow YAML so we can roll back on failure.
          const originalWorkflowYaml = dialogState.currentYaml ?? "";

          // 1) Update the workflow YAML file
          const wfRes = await fetch("/api/drive/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update",
              fileId: ctx.workflowFileId,
              content: yamlContent,
            }),
          });
          if (!wfRes.ok) {
            const details = await wfRes.text().catch(() => "");
            throw new Error(`Failed to update workflow YAML (${wfRes.status})${details ? `: ${details}` : ""}`);
          }
          const resData = await wfRes.json();
          try {
            await setCachedFile({
              fileId: ctx.workflowFileId,
              content: yamlContent,
              md5Checksum: resData.md5Checksum ?? "",
              modifiedTime: resData.file?.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: resData.file?.name,
            });
          } catch {
            // IndexedDB write failed — Drive update already succeeded
          }
          window.dispatchEvent(
            new CustomEvent("file-restored", {
              detail: { fileId: ctx.workflowFileId, content: yamlContent },
            }),
          );

          // 2) Update SKILL.md — if this fails, roll the workflow write back
          // to keep the skill folder in a consistent state. Best-effort:
          // Drive doesn't support multi-file transactions, so a rollback
          // failure can still leave the user with mismatched files, but we
          // surface the error in that case.
          let skillRes: Response;
          try {
            skillRes = await fetch("/api/drive/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "update",
                fileId: ctx.skillFileId,
                content: newSkillMd,
              }),
            });
            if (!skillRes.ok) {
              const details = await skillRes.text().catch(() => "");
              throw new Error(`Failed to update SKILL.md (${skillRes.status})${details ? `: ${details}` : ""}`);
            }
          } catch (skillErr) {
            console.warn("[Modify Skill] SKILL.md write failed, rolling back workflow YAML to original");
            try {
              const rollbackRes = await fetch("/api/drive/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "update",
                  fileId: ctx.workflowFileId,
                  content: originalWorkflowYaml,
                }),
              });
              if (rollbackRes.ok) {
                const rbData = await rollbackRes.json();
                try {
                  await setCachedFile({
                    fileId: ctx.workflowFileId,
                    content: originalWorkflowYaml,
                    md5Checksum: rbData.md5Checksum ?? "",
                    modifiedTime: rbData.file?.modifiedTime ?? "",
                    cachedAt: Date.now(),
                    fileName: rbData.file?.name,
                  });
                } catch { /* IndexedDB write failed */ }
                window.dispatchEvent(
                  new CustomEvent("file-restored", {
                    detail: { fileId: ctx.workflowFileId, content: originalWorkflowYaml },
                  }),
                );
              } else {
                console.error("[Modify Skill] Rollback failed; workflow + SKILL.md are now inconsistent");
              }
            } catch (rollbackErr) {
              console.error("[Modify Skill] Rollback failed:", rollbackErr);
            }
            throw skillErr;
          }

          const skillResData = await skillRes.json();
          try {
            await setCachedFile({
              fileId: ctx.skillFileId,
              content: newSkillMd,
              md5Checksum: skillResData.md5Checksum ?? "",
              modifiedTime: skillResData.file?.modifiedTime ?? "",
              cachedAt: Date.now(),
              fileName: skillResData.file?.name,
            });
          } catch {
            // IndexedDB write failed — Drive update already succeeded
          }
          window.dispatchEvent(
            new CustomEvent("file-restored", {
              detail: { fileId: ctx.skillFileId, content: newSkillMd },
            }),
          );

          handleWorkflowChanged();
          setAiDialog(null);
          return;
        }

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
            // Create SKILL.md alongside the workflow if in skill mode
            if (meta.skillMdContent && meta.newSkillId && meta.skillFolderPath) {
              const skillMdContent = meta.skillMdContent;
              const skillMdPath = meta.skillFolderPath.replace(/\/workflows$/, "/SKILL.md");
              fetch("/api/drive/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "create",
                  name: skillMdPath,
                  content: skillMdContent,
                }),
              })
                .then(async (res) => {
                  if (res.ok) {
                    const d = await res.json();
                    try {
                      await setCachedFile({
                        fileId: d.file.id,
                        content: skillMdContent,
                        md5Checksum: d.file.md5Checksum ?? "",
                        modifiedTime: d.file.modifiedTime ?? "",
                        cachedAt: Date.now(),
                        fileName: d.file.name,
                      });
                    } catch { /* IndexedDB write failed */ }
                  }
                  window.dispatchEvent(new Event("sync-complete"));
                })
                .catch((err) => console.warn("[AI Accept] SKILL.md creation failed:", err));
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
        throw err instanceof Error ? err : new Error("Failed to save AI workflow changes");
      }
    },
    [aiDialog, handleSelectFile, handleWorkflowChanged]
  );

  return {
    aiDialog,
    setAiDialog,
    handleNewWorkflow,
    handleModifyWithAI,
    handleModifySkillWithAI,
    handleAIAccept,
  };
}

// ── Tree helpers ─────────────────────────────────────────────────────────

function findNodeById(nodes: CachedTreeNode[], id: string): CachedTreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.isFolder && n.children) {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function findParent(nodes: CachedTreeNode[], childId: string, parent?: CachedTreeNode): CachedTreeNode | undefined {
  for (const n of nodes) {
    if (n.id === childId) return parent;
    if (n.isFolder && n.children) {
      const found = findParent(n.children, childId, n);
      if (found) return found;
    }
  }
  return undefined;
}

function findChildByName(children: CachedTreeNode[], name: string): CachedTreeNode | undefined {
  return children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function buildPathFromRoot(roots: CachedTreeNode[], folderId: string): string {
  const segments: string[] = [];
  const walk = (nodes: CachedTreeNode[], path: string[]): boolean => {
    for (const n of nodes) {
      if (n.id === folderId) {
        segments.push(...path, n.name);
        return true;
      }
      if (n.isFolder && n.children) {
        if (walk(n.children, [...path, n.name])) return true;
      }
    }
    return false;
  };
  walk(roots, []);
  return segments.join("/");
}
