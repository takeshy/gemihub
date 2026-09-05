import { fetchWithMcpApproval } from "~/hooks/mcp-approval-client";
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, AppWindow, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { McpAppResult, McpAppUiResource } from "~/types/settings";
import { applyMcpAppCsp } from "./mcp-app-csp";

interface McpAppRendererProps {
  serverId?: string;
  serverUrl: string;
  serverHeaders?: Record<string, string>;
  toolResult: McpAppResult;
  uiResource?: McpAppUiResource | null;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Call an MCP tool via the server-side proxy to avoid CORS issues
 */
async function callMcpTool(
  serverId: string | undefined,
  serverUrl: string,
  serverHeaders: Record<string, string> | undefined,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpAppResult> {
  const res = await fetchWithMcpApproval("/api/mcp/tool-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, serverUrl, serverHeaders, toolName, args }),
  });

  if (!res.ok) {
    throw new Error(`MCP tool call failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Read an MCP resource via the server-side proxy
 */
async function readMcpResource(
  serverId: string | undefined,
  serverUrl: string,
  serverHeaders: Record<string, string> | undefined,
  resourceUri: string
): Promise<McpAppUiResource | null> {
  const res = await fetch("/api/mcp/resource-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, serverUrl, serverHeaders, resourceUri }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  return data.error ? null : data;
}

function getHtmlContent(resource: McpAppUiResource | null | undefined): string | null {
  if (!resource) return null;
  if (resource.text) return resource.text;
  if (resource.blob) {
    try {
      return atob(resource.blob);
    } catch {
      return null;
    }
  }
  return null;
}

export function McpAppRenderer({
  serverId,
  serverUrl,
  serverHeaders,
  toolResult,
  uiResource: initialUiResource,
  expanded = false,
  onToggleExpand,
}: McpAppRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedResource, setFetchedResource] = useState<McpAppUiResource | null>(null);
  const [fetching, setFetching] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const resourceUri = toolResult._meta?.ui?.resourceUri ?? toolResult._meta?.["ui/resourceUri"];
  const effectiveResource = initialUiResource || fetchedResource;
  const rawHtmlContent = getHtmlContent(effectiveResource);
  const htmlContent = rawHtmlContent && effectiveResource
    ? applyMcpAppCsp(rawHtmlContent, effectiveResource)
    : null;

  // Client-side resource fetch fallback when server-side fetch failed
  useEffect(() => {
    if (initialUiResource || fetchedResource || fetching || !resourceUri || !expanded) return;

    setFetching(true);
    readMcpResource(serverId, serverUrl, serverHeaders, resourceUri)
      .then((resource) => {
        if (resource) {
          setFetchedResource(resource);
        } else {
          setError("Failed to load MCP App resource");
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load resource");
      })
      .finally(() => setFetching(false));
  }, [initialUiResource, fetchedResource, fetching, resourceUri, expanded, serverId, serverUrl, serverHeaders]);

  // Close maximized on Escape key
  useEffect(() => {
    if (!maximized) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [maximized]);

  // Handle messages from iframe
  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;

      const message = event.data as JsonRpcRequest;
      if (!message || message.jsonrpc !== "2.0" || !message.method) return;

      const sendResponse = (response: JsonRpcResponse) => {
        iframe.contentWindow?.postMessage(response, "*");
      };

      try {
        switch (message.method) {
          case "tools/call": {
            const params = message.params as {
              name: string;
              arguments?: Record<string, unknown>;
            };
            const result = await callMcpTool(
              serverId,
              serverUrl,
              serverHeaders,
              params.name,
              params.arguments || {}
            );
            sendResponse({
              jsonrpc: "2.0",
              id: message.id,
              result,
            });
            break;
          }

          case "context/update": {
            sendResponse({
              jsonrpc: "2.0",
              id: message.id,
              result: { ok: true },
            });
            break;
          }

          default:
            sendResponse({
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32601,
                message: `Method not found: ${message.method}`,
              },
            });
        }
      } catch (err) {
        sendResponse({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : "Internal error",
          },
        });
      }
    },
    [serverId, serverUrl, serverHeaders]
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Send initial tool result to iframe on load
  const handleIframeLoad = useCallback(() => {
    setLoaded(true);
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    iframe.contentWindow.postMessage(
      {
        jsonrpc: "2.0",
        method: "toolResult",
        params: {
          content: toolResult.content,
          isError: toolResult.isError,
          structuredContent: toolResult.structuredContent,
        },
      },
      "*"
    );
  }, [toolResult]);

  // Nothing to render if no resourceUri at all
  if (!resourceUri) return null;

  const renderContent = () => {
    if (error) {
      return (
        <div className="p-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      );
    }

    if (fetching || !htmlContent) {
      return (
        <div className="flex items-center justify-center gap-2 p-4 text-xs text-gray-400">
          <Loader2 size={ICON.MD} className="animate-spin" />
          Loading MCP App...
        </div>
      );
    }

    return (
      <>
        {!loaded && (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-gray-400">
            <Loader2 size={ICON.MD} className="animate-spin" />
            Loading MCP App...
          </div>
        )}
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          sandbox="allow-scripts allow-forms"
          onLoad={handleIframeLoad}
          onError={() => setError("Failed to load MCP App")}
          className={`w-full border-0 ${maximized ? "flex-1" : ""}`}
          style={{
            height: maximized ? undefined : "400px",
            display: loaded ? "block" : "none",
          }}
          title="MCP App"
        />
      </>
    );
  };

  return (
    <div className="mt-2">
      {/* Header */}
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleExpand}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {expanded ? (
            <ChevronDown size={ICON.MD} />
          ) : (
            <ChevronRight size={ICON.MD} />
          )}
          <AppWindow size={ICON.SM} />
          MCP App
        </button>
        {expanded && (
          <button
            onClick={() => setMaximized(!maximized)}
            className="ml-1 rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            title={maximized ? "Minimize" : "Expand"}
          >
            {maximized ? <Minimize2 size={ICON.SM} /> : <Maximize2 size={ICON.SM} />}
          </button>
        )}
      </div>

      {/* Backdrop for maximized mode */}
      {maximized && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() => setMaximized(false)}
        />
      )}

      {/* Content container - switches between inline and fixed overlay via CSS */}
      {expanded && (
        <div
          className={
            maximized
              ? "fixed inset-[5%] z-50 flex flex-col overflow-hidden rounded-lg border border-indigo-300 bg-white shadow-2xl dark:border-indigo-700 dark:bg-gray-900"
              : "mt-1 overflow-hidden rounded-md border border-indigo-200 dark:border-indigo-800"
          }
        >
          {maximized && (
            <div className="flex items-center justify-between border-b border-indigo-200 bg-gray-50 px-3 py-2 dark:border-indigo-800 dark:bg-gray-800">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <AppWindow size={ICON.MD} />
                MCP App
              </div>
              <button
                onClick={() => setMaximized(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              >
                <Minimize2 size={ICON.MD} />
              </button>
            </div>
          )}
          {renderContent()}
        </div>
      )}
    </div>
  );
}
