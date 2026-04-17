"use client";

import { useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Download, HardDrive, Loader2, Check, Paperclip, FileText, Wrench, BookOpen, Globe, Plug, Music, FolderOpen, Sparkles } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { Message, Attachment, GeneratedImage, ToolCall, ToolResult, StreamChunkUsage } from "~/types/chat";
import { useI18n } from "~/i18n/context";
import { useSkills } from "~/contexts/SkillContext";
import { McpAppRenderer } from "./McpAppRenderer";
import { setCachedFile, getLocalSyncMeta, setLocalSyncMeta, getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { guessMimeType } from "~/utils/media-utils";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function ThinkingSection({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {expanded ? <ChevronDown size={ICON.MD} /> : <ChevronRight size={ICON.MD} />}
        Thinking
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
          <pre className="whitespace-pre-wrap break-words font-sans">{thinking}</pre>
        </div>
      )}
    </div>
  );
}

function getToolIcon(name: string) {
  if (name.startsWith("mcp_")) return <Plug size={10} />;
  if (name.includes("read")) return <BookOpen size={10} />;
  if (name.includes("create")) return <FileText size={10} />;
  if (name.includes("update")) return <FileText size={10} />;
  if (name.includes("search") || name.includes("list")) return <Globe size={10} />;
  return <Wrench size={10} />;
}

function sanitizeToolIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

function getMcpToolLabel(name: string, mcpServerIds?: string[]) {
  if (!name.startsWith("mcp_")) return name;
  const payload = name.slice(4);

  if (mcpServerIds && mcpServerIds.length > 0) {
    const candidates = Array.from(
      new Set(mcpServerIds.map((id) => sanitizeToolIdentifier(id)).filter(Boolean))
    ).sort((a, b) => b.length - a.length);

    for (const candidate of candidates) {
      const prefix = `${candidate}_`;
      if (payload.startsWith(prefix)) {
        const tool = payload.slice(prefix.length);
        return tool ? `${candidate}:${tool}` : candidate;
      }
    }
  }

  // Fallback when server IDs are unavailable.
  const firstSep = payload.indexOf("_");
  if (firstSep > 0 && firstSep < payload.length - 1) {
    return `${payload.slice(0, firstSep)}:${payload.slice(firstSep + 1)}`;
  }
  return name;
}

/**
 * Collect unique skills invoked by run_skill_workflow tool calls on a message.
 * Returns skills with { id, name, skillMdFileId } so the UI can render a chip
 * per skill that is clickable to open SKILL.md.
 */
function getInvokedSkills(
  toolCalls: ToolCall[],
  skills: ReturnType<typeof useSkills>["skills"],
): Array<{ id: string; name: string; skillMdFileId: string }> {
  const seen = new Set<string>();
  const result: Array<{ id: string; name: string; skillMdFileId: string }> = [];
  for (const tc of toolCalls) {
    if (tc.name !== "run_skill_workflow") continue;
    const workflowId = typeof tc.args.workflowId === "string" ? tc.args.workflowId : "";
    const [skillId] = workflowId.split("/", 2);
    if (!skillId || seen.has(skillId)) continue;
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) continue;
    seen.add(skillId);
    result.push({ id: skill.id, name: skill.name, skillMdFileId: skill.skillMdFileId });
  }
  return result;
}


// On error, return null so the click falls through to the details panel and the user can
// inspect what went wrong instead of opening a bogus file.
function getDriveToolOpenTarget(
  tc: ToolCall,
  toolResults?: ToolResult[],
): { fileId: string; fileName?: string } | null {
  if (tc.name.startsWith("mcp_")) return null;
  if (tc.name === "run_skill_workflow") return null;

  const result = toolResults?.find((r) => r.toolCallId === tc.id)?.result;
  const resultObj = result && typeof result === "object"
    ? (result as Record<string, unknown>)
    : undefined;
  if (resultObj && typeof resultObj.error === "string") return null;
  const resultId = typeof resultObj?.id === "string" && resultObj.id ? resultObj.id : undefined;
  const resultName = typeof resultObj?.name === "string" && resultObj.name ? resultObj.name : undefined;

  switch (tc.name) {
    case "read_drive_file":
    case "update_drive_file":
    case "rename_drive_file": {
      const argId = typeof tc.args.fileId === "string" ? tc.args.fileId : undefined;
      const id = argId || resultId;
      if (!id) return null;
      return { fileId: id, fileName: resultName };
    }
    case "create_drive_file": {
      if (!resultId) return null;
      const argName = typeof tc.args.name === "string" ? tc.args.name : undefined;
      return { fileId: resultId, fileName: resultName || argName };
    }
    default:
      return null;
  }
}

// Mirrors the failed-workflow "Open workflow" button: dispatch plugin-select-file, and
// additionally switch the right panel to the workflow tab for .yaml/.yml files.
async function openDriveFileById(fileId: string, fallbackName?: string): Promise<boolean> {
  try {
    const meta = await getCachedRemoteMeta();
    const m = meta?.files[fileId];
    const fileName = m?.name || fallbackName || fileId;
    const mimeType = m?.mimeType || guessMimeType(fileName);
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId, fileName, mimeType },
      }),
    );
    if (/\.ya?ml$/i.test(fileName)) {
      window.dispatchEvent(new CustomEvent("gemihub:open-workflow-tab"));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the workflow file id for a failed run_skill_workflow call.
 *
 * Matches the obsidian-llm-hub contract: the tool itself surfaces
 * `{ error, workflowPath }` in its result when the workflow fails, so the UI
 * just reads those fields directly (no skill-context reverse lookup required).
 * Returns null when the call succeeded or wasn't a skill-workflow call.
 */
function getFailedSkillWorkflowFileId(
  tc: ToolCall,
  toolResults: ToolResult[] | undefined,
): string | null {
  if (tc.name !== "run_skill_workflow") return null;
  const result = toolResults?.find((r) => r.toolCallId === tc.id)?.result;
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (typeof r.error !== "string") return null;
  return typeof r.workflowPath === "string" ? r.workflowPath : null;
}

function ToolCallBadges({
  toolCalls,
  toolResults,
  mcpServerIds,
}: {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
  mcpServerIds?: string[];
}) {
  const { t } = useI18n();
  const { skills } = useSkills();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hasAnyFailedWorkflow = toolCalls.some(
    (tc) => getFailedSkillWorkflowFileId(tc, toolResults) !== null,
  );
  const invokedSkills = getInvokedSkills(toolCalls, skills);

  const openWorkflow = (fileId: string) => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId, fileName: "workflow.yaml", mimeType: "text/yaml" },
      }),
    );
    window.dispatchEvent(new CustomEvent("gemihub:open-workflow-tab"));
  };

  const openSkill = (fileId: string, name: string) => {
    window.dispatchEvent(
      new CustomEvent("plugin-select-file", {
        detail: { fileId, fileName: `${name}/SKILL.md`, mimeType: "text/markdown" },
      }),
    );
  };

  return (
    <div className="mb-2">
      {invokedSkills.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-1">
          <Sparkles size={10} className="flex-shrink-0 text-purple-500" />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("chat.skillsUsed")}:
          </span>
          {invokedSkills.map((s) => (
            <button
              key={s.id}
              onClick={() => openSkill(s.skillMdFileId, s.name)}
              className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700 hover:bg-purple-200 hover:underline dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
              title={t("chat.clickToOpen").replace("{{source}}", s.name)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {toolCalls.map((tc) => {
          const failedFileId = getFailedSkillWorkflowFileId(tc, toolResults);
          const openTarget = getDriveToolOpenTarget(tc, toolResults);
          const titleText = openTarget
            ? t("chat.clickToOpen").replace("{{source}}", openTarget.fileName || openTarget.fileId)
            : JSON.stringify(tc.args, null, 2);
          return (
            <span key={tc.id} className="inline-flex items-center gap-1">
              <button
                onClick={() => {
                  if (openTarget) {
                    void openDriveFileById(openTarget.fileId, openTarget.fileName);
                  } else {
                    setExpandedId(expandedId === tc.id ? null : tc.id);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
                title={titleText}
              >
                {getToolIcon(tc.name)}
                {getMcpToolLabel(tc.name, mcpServerIds)}
              </button>
              {failedFileId && (
                <button
                  onClick={() => openWorkflow(failedFileId)}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                >
                  <FolderOpen size={10} />
                  {t("chat.openWorkflow")}
                </button>
              )}
            </span>
          );
        })}
      </div>
      {expandedId && (() => {
        const tc = toolCalls.find(t => t.id === expandedId);
        if (!tc) return null;
        const tr = toolResults?.find(r => r.toolCallId === tc.id);
        return (
          <div className="mt-1 rounded-md border border-purple-200 bg-purple-50 p-2 text-xs text-purple-700 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-300">
            <div className="font-medium">{tc.name}</div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase opacity-70">args</div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] opacity-80">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
            {tr && (
              <>
                <div className="mt-1 text-[10px] font-semibold uppercase opacity-70">result</div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[10px] opacity-80">
                  {typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result, null, 2)}
                </pre>
              </>
            )}
          </div>
        );
      })()}
      {hasAnyFailedWorkflow && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t("chat.workflowErrorHint")}
        </div>
      )}
    </div>
  );
}

function RagSourcesList({ sources }: { sources: string[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white dark:bg-green-700">
        <BookOpen size={10} />
        RAG
      </span>
      {sources.map((source, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300"
          title={source}
        >
          <FileText size={10} />
          {source.split("/").pop() || source}
        </span>
      ))}
    </div>
  );
}

function WebSearchIndicator({ sources }: { sources?: string[] }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white dark:bg-blue-700">
        <Globe size={10} />
        Web Search
      </span>
      {sources && sources.map((source, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          title={source}
        >
          {source.split("/").pop() || source}
        </span>
      ))}
    </div>
  );
}

function UsageInfo({ usage, elapsedMs }: { usage?: StreamChunkUsage; elapsedMs?: number }) {
  const { t } = useI18n();
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-gray-400 dark:text-gray-500">
      {elapsedMs !== undefined && (
        <span>{formatElapsed(elapsedMs)}</span>
      )}
      {usage && usage.inputTokens !== undefined && usage.outputTokens !== undefined && (
        <span>
          {formatNumber(usage.inputTokens)} → {formatNumber(usage.outputTokens)} {t("message.tokens")}
          {usage.thinkingTokens ? ` (${t("message.thinkingTokens")} ${formatNumber(usage.thinkingTokens)})` : ""}
        </span>
      )}
      {usage?.totalCost !== undefined && (
        <span>${usage.totalCost.toFixed(4)}</span>
      )}
    </div>
  );
}

function GeneratedImageDisplay({ image }: { image: GeneratedImage }) {
  const { t } = useI18n();
  const dataUrl = `data:${image.mimeType};base64,${image.data}`;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = dataUrl;
    const ext = image.mimeType.split("/")[1] || "png";
    link.download = `generated-image.${ext}`;
    link.click();
  };

  const handleSaveToDrive = async () => {
    if (saveState !== "idle") return;
    setSaveState("saving");
    try {
      const ext = image.mimeType.split("/")[1] || "png";
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const fileName = `generated-image-${ts}.${ext}`;
      const res = await fetch("/api/drive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-image",
          name: fileName,
          data: image.data,
          mimeType: image.mimeType,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const { file: driveFile, meta } = await res.json();
      setSaveState("saved");

      // Cache binary in IndexedDB so it's marked as synced
      await setCachedFile({
        fileId: driveFile.id,
        content: image.data,
        md5Checksum: driveFile.md5Checksum,
        modifiedTime: driveFile.modifiedTime,
        cachedAt: Date.now(),
        fileName: driveFile.name,
        encoding: "base64",
      });

      // Update localSyncMeta so the file doesn't appear as a pull candidate
      const localMeta = await getLocalSyncMeta();
      if (localMeta) {
        localMeta.files[driveFile.id] = {
          md5Checksum: driveFile.md5Checksum,
          modifiedTime: driveFile.modifiedTime,
        };
        localMeta.lastUpdatedAt = meta?.lastUpdatedAt || new Date().toISOString();
        await setLocalSyncMeta(localMeta);
      }

      // Update tree + remote meta cache without a network call
      if (meta) {
        window.dispatchEvent(new CustomEvent("tree-meta-updated", { detail: { meta } }));
      }
      window.dispatchEvent(new CustomEvent("file-cached", { detail: { fileId: driveFile.id } }));
    } catch (e) {
      console.error("Failed to save image to Drive:", e);
      setSaveState("idle");
    }
  };

  return (
    <div className="group relative mb-2 inline-block">
      <img
        src={dataUrl}
        alt="Generated image"
        className="max-h-80 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
      />
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleSaveToDrive}
          disabled={saveState === "saving"}
          className="rounded-md bg-black/50 p-1.5 text-white hover:bg-black/70"
          aria-label={saveState === "saved" ? t("chat.savedToDrive") : t("chat.saveToDrive")}
          title={saveState === "saved" ? t("chat.savedToDrive") : t("chat.saveToDrive")}
        >
          {saveState === "idle" && <HardDrive size={ICON.MD} />}
          {saveState === "saving" && <Loader2 size={ICON.MD} className="animate-spin" />}
          {saveState === "saved" && <Check size={ICON.MD} />}
        </button>
        <button
          onClick={handleDownload}
          className="rounded-md bg-black/50 p-1.5 text-white hover:bg-black/70"
          aria-label="Download image"
        >
          <Download size={ICON.MD} />
        </button>
      </div>
    </div>
  );
}

function AttachmentDisplay({ attachment }: { attachment: Attachment }) {
  if (attachment.type === "image") {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
    return (
      <div className="mb-2">
        <img
          src={dataUrl}
          alt={attachment.name}
          className="max-h-48 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
        />
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {attachment.name}
        </div>
      </div>
    );
  }

  if (attachment.type === "audio") {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
    return (
      <div className="mb-2">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
          <Music size={ICON.MD} className="shrink-0 text-gray-500 dark:text-gray-400" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-gray-600 dark:text-gray-400">{attachment.name}</div>
            <audio controls preload="metadata" className="mt-1 h-8 w-full">
              <source src={dataUrl} type={attachment.mimeType} />
            </audio>
          </div>
        </div>
      </div>
    );
  }

  if (attachment.type === "video") {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
    return (
      <div className="mb-2">
        <video controls preload="metadata" className="max-h-48 max-w-full rounded-lg border border-gray-200 dark:border-gray-700">
          <source src={dataUrl} type={attachment.mimeType} />
        </video>
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{attachment.name}</div>
      </div>
    );
  }

  return (
    <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
      {attachment.type === "pdf" ? (
        <FileText size={ICON.SM} />
      ) : (
        <Paperclip size={ICON.SM} />
      )}
      {attachment.name}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [collapsedMcpApps, setCollapsedMcpApps] = useState<Set<number>>(new Set());
  const mcpServerIds = (message.mcpApps || [])
    .map((app) => app.serverId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const toggleMcpAppExpand = (index: number) => {
    setCollapsedMcpApps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const hasMcpApps = !isUser && message.mcpApps && message.mcpApps.length > 0;

  return (
    <>
      <div
        className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-3 md:max-w-[75%] ${
            isUser
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          }`}
        >
          {/* Attachments (shown for user messages) */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2">
              {message.attachments.map((att, i) => (
                <AttachmentDisplay key={i} attachment={att} />
              ))}
            </div>
          )}

          {/* Thinking section (assistant only) */}
          {!isUser && message.thinking && (
            <ThinkingSection thinking={message.thinking} />
          )}

          {/* Tool calls (assistant only) */}
          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallBadges
              toolCalls={message.toolCalls}
              toolResults={message.toolResults}
              mcpServerIds={mcpServerIds}
            />
          )}

          {/* RAG sources (assistant only) */}
          {!isUser && message.ragUsed && message.ragSources && message.ragSources.length > 0 && (
            <RagSourcesList sources={message.ragSources} />
          )}

          {/* Web search indicator (assistant only) */}
          {!isUser && message.webSearchUsed && (
            <WebSearchIndicator sources={message.ragSources} />
          )}

          {/* Message content */}
          <div
            className={`prose prose-sm max-w-none break-words ${
              isUser
                ? "prose-invert"
                : "dark:prose-invert"
            }`}
          >
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>

          {/* Generated images (assistant only) */}
          {!isUser &&
            message.generatedImages &&
            message.generatedImages.length > 0 && (
              <div className="mt-2">
                {message.generatedImages.map((img, i) => (
                  <GeneratedImageDisplay key={i} image={img} />
                ))}
              </div>
            )}

          {/* Streaming indicator */}
          {isStreaming && !isUser && (
            <div className="mt-1 flex items-center gap-1">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]" />
            </div>
          )}

          {/* Usage info (tokens, cost, response time) */}
          {!isUser && !isStreaming && (message.usage || message.elapsedMs) && (
            <UsageInfo usage={message.usage} elapsedMs={message.elapsedMs} />
          )}

          {/* Timestamp */}
          <div
            className={`mt-1.5 text-[10px] ${
              isUser
                ? "text-blue-200"
                : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {formatTimestamp(message.timestamp)}
            {!isUser && message.model && (
              <span className="ml-1.5">{message.model}</span>
            )}
          </div>
        </div>
      </div>

      {/* MCP Apps - rendered outside the bubble for full width */}
      {hasMcpApps && (
        <div className="w-full">
          {message.mcpApps!.map((mcpApp, index) => (
            <McpAppRenderer
              key={index}
              serverId={mcpApp.serverId}
              serverUrl={mcpApp.serverUrl}
              serverHeaders={mcpApp.serverHeaders}
              toolResult={mcpApp.toolResult}
              uiResource={mcpApp.uiResource}
              expanded={!collapsedMcpApps.has(index)}
              onToggleExpand={() => toggleMcpAppExpand(index)}
            />
          ))}
        </div>
      )}
    </>
  );
});
