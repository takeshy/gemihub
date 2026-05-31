import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  FileText,
  GitCompareArrows,
  History,
  Link,
  Move,
  MousePointer2,
  Square,
  StickyNote,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { addCommitBoundary } from "~/services/edit-history-local";
import { isEncryptedFile } from "~/services/crypto-core";
import { performTempUpload } from "~/services/temp-upload";
import { useTempEditConfirm } from "~/hooks/useTempEditConfirm";
import { useI18n } from "~/i18n/context";
import { useEditorContext } from "~/contexts/EditorContext";
import { TempEditUrlDialog } from "~/components/shared/TempEditUrlDialog";
import { TempDiffModal } from "../TempDiffModal";

const CANVAS_VERSION = "1.0.0";
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 180;
const MIN_NODE_WIDTH = 160;
const MIN_NODE_HEIGHT = 90;
const DEFAULT_COLOR = "1";

const CARD_COLORS: Record<string, { name: string; node: string; border: string; accent: string }> = {
  "1": { name: "Default", node: "bg-white dark:bg-gray-900", border: "border-gray-300 dark:border-gray-700", accent: "bg-gray-500" },
  "2": { name: "Red", node: "bg-red-50 dark:bg-red-950/40", border: "border-red-300 dark:border-red-800", accent: "bg-red-500" },
  "3": { name: "Orange", node: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-300 dark:border-orange-800", accent: "bg-orange-500" },
  "4": { name: "Yellow", node: "bg-yellow-50 dark:bg-yellow-950/40", border: "border-yellow-300 dark:border-yellow-800", accent: "bg-yellow-500" },
  "5": { name: "Green", node: "bg-green-50 dark:bg-green-950/40", border: "border-green-300 dark:border-green-800", accent: "bg-green-500" },
  "6": { name: "Cyan", node: "bg-cyan-50 dark:bg-cyan-950/40", border: "border-cyan-300 dark:border-cyan-800", accent: "bg-cyan-500" },
  "7": { name: "Purple", node: "bg-purple-50 dark:bg-purple-950/40", border: "border-purple-300 dark:border-purple-800", accent: "bg-purple-500" },
};

type CanvasNodeType = "text" | "file" | "link" | "group";
type CanvasEdgeSide = "top" | "right" | "bottom" | "left";

interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  file?: string;
  url?: string;
  label?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasEdgeSide;
  toNode: string;
  toSide?: CanvasEdgeSide;
  color?: string;
  label?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

type ToolMode = "select" | "pan" | "connect";
type DragState =
  | { type: "pan"; pointerId: number; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { type: "move"; pointerId: number; nodeId: string; startWorldX: number; startWorldY: number; originals: Array<{ id: string; x: number; y: number }> }
  | { type: "resize"; pointerId: number; nodeId: string; startWorldX: number; startWorldY: number; startWidth: number; startHeight: number }
  | { type: "connect"; pointerId: number; fromNode: string; startSide: CanvasEdgeSide; currentWorldX: number; currentWorldY: number };

function emptyCanvas(): CanvasData {
  return { nodes: [], edges: [] };
}

function parseCanvas(content: string): CanvasData {
  try {
    const parsed = JSON.parse(content || "{}");
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return emptyCanvas();
    return {
      nodes: parsed.nodes
        .filter((node: Partial<CanvasNode>) => typeof node.id === "string" && typeof node.x === "number" && typeof node.y === "number")
        .map((node: Partial<CanvasNode>) => ({
          id: node.id!,
          type: node.type === "file" || node.type === "link" || node.type === "group" ? node.type : "text",
          x: node.x!,
          y: node.y!,
          width: typeof node.width === "number" ? node.width : DEFAULT_NODE_WIDTH,
          height: typeof node.height === "number" ? node.height : DEFAULT_NODE_HEIGHT,
          color: typeof node.color === "string" ? node.color : DEFAULT_COLOR,
          text: typeof node.text === "string" ? node.text : undefined,
          file: typeof node.file === "string" ? node.file : undefined,
          url: typeof node.url === "string" ? node.url : undefined,
          label: typeof node.label === "string" ? node.label : undefined,
        })),
      edges: parsed.edges
        .filter((edge: Partial<CanvasEdge>) => typeof edge.id === "string" && typeof edge.fromNode === "string" && typeof edge.toNode === "string")
        .map((edge: Partial<CanvasEdge>) => ({
          id: edge.id!,
          fromNode: edge.fromNode!,
          fromSide: isSide(edge.fromSide) ? edge.fromSide : undefined,
          toNode: edge.toNode!,
          toSide: isSide(edge.toSide) ? edge.toSide : undefined,
          color: typeof edge.color === "string" ? edge.color : undefined,
          label: typeof edge.label === "string" ? edge.label : undefined,
        })),
    };
  } catch {
    return emptyCanvas();
  }
}

function isSide(value: unknown): value is CanvasEdgeSide {
  return value === "top" || value === "right" || value === "bottom" || value === "left";
}

function serializeCanvas(data: CanvasData): string {
  return `${JSON.stringify({ nodes: data.nodes, edges: data.edges }, null, 2)}\n`;
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sidePoint(node: CanvasNode, side?: CanvasEdgeSide): { x: number; y: number } {
  const s = side || closestSide(node, { x: node.x + node.width / 2, y: node.y + node.height / 2 });
  if (s === "top") return { x: node.x + node.width / 2, y: node.y };
  if (s === "right") return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (s === "bottom") return { x: node.x + node.width / 2, y: node.y + node.height };
  return { x: node.x, y: node.y + node.height / 2 };
}

function closestSide(node: CanvasNode, point: { x: number; y: number }): CanvasEdgeSide {
  const distances: Array<[CanvasEdgeSide, number]> = [
    ["top", Math.abs(point.y - node.y)],
    ["right", Math.abs(point.x - (node.x + node.width))],
    ["bottom", Math.abs(point.y - (node.y + node.height))],
    ["left", Math.abs(point.x - node.x)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(80, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

function nodeIcon(type: CanvasNodeType) {
  if (type === "file") return <FileText size={ICON.SM} />;
  if (type === "link") return <Link size={ICON.SM} />;
  if (type === "group") return <Square size={ICON.SM} />;
  return <StickyNote size={ICON.SM} />;
}

export function CanvasFileEditor({
  fileId,
  fileName,
  initialContent,
  saveToCache,
  onDiffClick,
  onHistoryClick,
}: {
  fileId: string;
  fileName: string;
  initialContent: string;
  saveToCache: (content: string) => Promise<void>;
  onDiffClick?: () => void;
  onHistoryClick?: () => void;
}) {
  const { t } = useI18n();
  const editorCtx = useEditorContext();
  const [canvas, setCanvas] = useState<CanvasData>(() => parseCanvas(initialContent));
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolMode>("select");
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tempDiffData, setTempDiffData] = useState<{
    fileName: string;
    fileId: string;
    currentContent: string;
    tempContent: string;
    tempSavedAt: string;
    currentModifiedTime: string;
    isBinary: boolean;
  } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const contentFromProps = useRef(true);
  const pendingContentRef = useRef<string | null>(null);
  const prevFileIdRef = useRef(fileId);
  const serializedContent = useMemo(() => serializeCanvas(canvas), [canvas]);
  const selectedNode = selectedNodeIds.length === 1 ? canvas.nodes.find((node) => node.id === selectedNodeIds[0]) || null : null;
  const selectedEdge = selectedEdgeId ? canvas.edges.find((edge) => edge.id === selectedEdgeId) || null : null;
  const tempEditConfirm = useTempEditConfirm();

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left || 0) - pan.x) / zoom,
      y: (clientY - (rect?.top || 0) - pan.y) / zoom,
    };
  }, [pan.x, pan.y, zoom]);

  const updateCanvas = useCallback((updater: (current: CanvasData) => CanvasData) => {
    contentFromProps.current = false;
    setCanvas(updater);
  }, []);

  useEffect(() => {
    const prev = prevFileIdRef.current;
    prevFileIdRef.current = fileId;
    if (prev.startsWith("new:") && !fileId.startsWith("new:")) return;
    contentFromProps.current = true;
    setCanvas(parseCanvas(initialContent));
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
  }, [initialContent, fileId]);

  useEffect(() => {
    if (contentFromProps.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingContentRef.current = serializedContent;
    debounceRef.current = setTimeout(() => {
      saveToCache(serializedContent);
      pendingContentRef.current = null;
    }, 1000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [serializedContent, saveToCache, fileId]);

  useEffect(() => {
    return () => {
      if (pendingContentRef.current !== null) {
        saveToCache(pendingContentRef.current);
        pendingContentRef.current = null;
      }
    };
  }, [saveToCache]);

  useEffect(() => {
    editorCtx.setActiveSelection(null);
  }, [editorCtx]);

  const flushPendingSave = useCallback(() => {
    if (pendingContentRef.current !== null) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      saveToCache(pendingContentRef.current);
      pendingContentRef.current = null;
    }
  }, [saveToCache]);

  const addNode = useCallback((type: CanvasNodeType) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const center = screenToWorld((rect?.left || 0) + (rect?.width || 800) / 2, (rect?.top || 0) + (rect?.height || 600) / 2);
    const id = nextId("node");
    const base: CanvasNode = {
      id,
      type,
      x: Math.round(center.x - DEFAULT_NODE_WIDTH / 2),
      y: Math.round(center.y - DEFAULT_NODE_HEIGHT / 2),
      width: type === "group" ? 420 : DEFAULT_NODE_WIDTH,
      height: type === "group" ? 260 : DEFAULT_NODE_HEIGHT,
      color: DEFAULT_COLOR,
      text: type === "text" ? "New note" : undefined,
      label: type === "group" ? "Group" : undefined,
      file: type === "file" ? "path/to/file.md" : undefined,
      url: type === "link" ? "https://example.com" : undefined,
    };
    updateCanvas((current) => ({ ...current, nodes: [...current.nodes, base] }));
    setSelectedNodeIds([id]);
    setSelectedEdgeId(null);
    if (type === "text") setEditingNodeId(id);
  }, [screenToWorld, updateCanvas]);

  const deleteSelection = useCallback(async () => {
    if (selectedNodeIds.length === 0 && !selectedEdgeId) return;
    await addCommitBoundary(fileId);
    updateCanvas((current) => ({
      nodes: current.nodes.filter((node) => !selectedNodeIds.includes(node.id)),
      edges: current.edges.filter((edge) => !selectedEdgeId || edge.id !== selectedEdgeId).filter((edge) => !selectedNodeIds.includes(edge.fromNode) && !selectedNodeIds.includes(edge.toNode)),
    }));
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
  }, [fileId, selectedEdgeId, selectedNodeIds, updateCanvas]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
      if (event.key === "Escape") {
        setEditingNodeId(null);
        setDragState(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection]);

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
    if (tool === "pan" || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState({ type: "pan", pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPanX: pan.x, startPanY: pan.y });
    }
  };

  const handleNodePointerDown = (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("textarea, input, button, a")) return;
    event.stopPropagation();
    setEditingNodeId(null);
    setSelectedEdgeId(null);
    const nextSelection = event.shiftKey
      ? selectedNodeIds.includes(node.id)
        ? selectedNodeIds.filter((id) => id !== node.id)
        : [...selectedNodeIds, node.id]
      : selectedNodeIds.includes(node.id)
        ? selectedNodeIds
        : [node.id];
    setSelectedNodeIds(nextSelection);
    const world = screenToWorld(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      type: "move",
      pointerId: event.pointerId,
      nodeId: node.id,
      startWorldX: world.x,
      startWorldY: world.y,
      originals: canvas.nodes.filter((n) => nextSelection.includes(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y })),
    });
  };

  const handleConnectorPointerDown = (event: React.PointerEvent<HTMLButtonElement>, node: CanvasNode, side: CanvasEdgeSide) => {
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    setTool("connect");
    setDragState({ type: "connect", pointerId: event.pointerId, fromNode: node.id, startSide: side, currentWorldX: world.x, currentWorldY: world.y });
  };

  const handleResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>, node: CanvasNode) => {
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ type: "resize", pointerId: event.pointerId, nodeId: node.id, startWorldX: world.x, startWorldY: world.y, startWidth: node.width, startHeight: node.height });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.type === "pan") {
      setPan({ x: dragState.startPanX + event.clientX - dragState.startClientX, y: dragState.startPanY + event.clientY - dragState.startClientY });
      return;
    }
    const world = screenToWorld(event.clientX, event.clientY);
    if (dragState.type === "move") {
      const dx = world.x - dragState.startWorldX;
      const dy = world.y - dragState.startWorldY;
      updateCanvas((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          const original = dragState.originals.find((item) => item.id === node.id);
          return original ? { ...node, x: Math.round(original.x + dx), y: Math.round(original.y + dy) } : node;
        }),
      }));
    } else if (dragState.type === "resize") {
      updateCanvas((current) => ({
        ...current,
        nodes: current.nodes.map((node) => node.id === dragState.nodeId
          ? { ...node, width: Math.max(MIN_NODE_WIDTH, Math.round(dragState.startWidth + world.x - dragState.startWorldX)), height: Math.max(MIN_NODE_HEIGHT, Math.round(dragState.startHeight + world.y - dragState.startWorldY)) }
          : node),
      }));
    } else if (dragState.type === "connect") {
      setDragState({ ...dragState, currentWorldX: world.x, currentWorldY: world.y });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if (dragState.type === "connect") {
      const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const target = elementUnderPointer?.closest("[data-node-id]") as HTMLElement | null;
      const targetId = target?.dataset.nodeId;
      if (targetId && targetId !== dragState.fromNode) {
        const targetNode = canvas.nodes.find((node) => node.id === targetId);
        const world = screenToWorld(event.clientX, event.clientY);
        const id = nextId("edge");
        updateCanvas((current) => ({
          ...current,
          edges: [...current.edges, { id, fromNode: dragState.fromNode, fromSide: dragState.startSide, toNode: targetId, toSide: targetNode ? closestSide(targetNode, world) : undefined }],
        }));
        setSelectedNodeIds([]);
        setSelectedEdgeId(id);
      }
      setTool("select");
    }
    setDragState(null);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const nextZoom = Math.min(2.5, Math.max(0.25, zoom - event.deltaY * 0.001));
    setZoom(nextZoom);
  };

  const updateSelectedNode = (patch: Partial<CanvasNode>) => {
    if (!selectedNode) return;
    updateCanvas((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...patch } : node) }));
  };

  const updateSelectedEdge = (patch: Partial<CanvasEdge>) => {
    if (!selectedEdge) return;
    updateCanvas((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, ...patch } : edge) }));
  };

  const handleTempUpload = useCallback(async () => {
    try {
      const feedback = await performTempUpload({ fileName, fileId, content: serializedContent, t, confirm: tempEditConfirm.confirm, onStart: () => setUploading(true) });
      alert(feedback);
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }, [fileName, fileId, serializedContent, t, tempEditConfirm.confirm]);

  const handleTempDownload = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "download", fileName }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.found) {
        alert(t("contextMenu.noTempFile"));
        return;
      }
      const { payload } = data.tempFile;
      setTempDiffData({
        fileName,
        fileId,
        currentContent: serializedContent,
        tempContent: payload.content,
        tempSavedAt: payload.savedAt,
        currentModifiedTime: "",
        isBinary: fileName.endsWith(".encrypted") || isEncryptedFile(serializedContent),
      });
    } catch { /* ignore */ }
  }, [fileName, fileId, serializedContent, t]);

  const handleTempDiffAccept = useCallback(async () => {
    if (!tempDiffData) return;
    await addCommitBoundary(fileId);
    contentFromProps.current = false;
    setCanvas(parseCanvas(tempDiffData.tempContent));
    await saveToCache(tempDiffData.tempContent);
    setTempDiffData(null);
  }, [tempDiffData, saveToCache, fileId]);

  const nodeById = useMemo(() => new Map(canvas.nodes.map((node) => [node.id, node])), [canvas.nodes]);
  const gridSize = 48;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-100 dark:bg-gray-950" onBlur={flushPendingSave}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-1 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => setTool("select")} className={`canvas-toolbar-button ${tool === "select" ? "canvas-toolbar-button-active" : ""}`} title="Select"><MousePointer2 size={ICON.SM} /></button>
          <button onClick={() => setTool("pan")} className={`canvas-toolbar-button ${tool === "pan" ? "canvas-toolbar-button-active" : ""}`} title="Pan"><Move size={ICON.SM} /></button>
          <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={() => addNode("text")} className="canvas-toolbar-button" title={t("canvas.addText")}><StickyNote size={ICON.SM} /><span className="hidden sm:inline">{t("canvas.addText")}</span></button>
          <button onClick={() => addNode("file")} className="canvas-toolbar-button" title={t("canvas.addFile")}><FileText size={ICON.SM} /></button>
          <button onClick={() => addNode("link")} className="canvas-toolbar-button" title={t("canvas.addLink")}><Link size={ICON.SM} /></button>
          <button onClick={() => addNode("group")} className="canvas-toolbar-button" title={t("canvas.addGroup")}><Square size={ICON.SM} /></button>
          <button onClick={deleteSelection} disabled={selectedNodeIds.length === 0 && !selectedEdgeId} className="canvas-toolbar-button disabled:opacity-40" title={t("canvas.deleteSelection")}><Trash2 size={ICON.SM} /></button>
          <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))} className="canvas-toolbar-button" title="Zoom out"><ZoomOut size={ICON.SM} /></button>
          <span className="min-w-12 text-center text-xs text-gray-500 dark:text-gray-400">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))} className="canvas-toolbar-button" title="Zoom in"><ZoomIn size={ICON.SM} /></button>
        </div>
        <div className="flex items-center gap-1">
          {onHistoryClick && <button onClick={onHistoryClick} className="canvas-toolbar-button" title={t("editHistory.menuLabel")}><History size={ICON.SM} /><span className="hidden sm:inline">{t("editHistory.menuLabel")}</span></button>}
          {onDiffClick && <button onClick={onDiffClick} className="canvas-toolbar-button" title={t("mainViewer.diff")}><GitCompareArrows size={ICON.SM} /><span className="hidden sm:inline">{t("mainViewer.diff")}</span></button>}
          <button onClick={handleTempUpload} disabled={uploading} className="canvas-toolbar-button disabled:opacity-50" title={t("contextMenu.tempUpload")}><Upload size={ICON.SM} /></button>
          <button onClick={handleTempDownload} className="canvas-toolbar-button" title={t("contextMenu.tempDownload")}><Download size={ICON.SM} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="relative flex-1 overflow-hidden cursor-default"
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          <div className="absolute inset-0 opacity-60 dark:opacity-30" style={{ backgroundImage: "radial-gradient(circle, rgb(148 163 184) 1px, transparent 1px)", backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }} />
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg className="pointer-events-none absolute overflow-visible" style={{ width: 1, height: 1 }}>
              <defs>
                <marker id="canvas-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" className="fill-gray-500 dark:fill-gray-300" />
                </marker>
              </defs>
              {canvas.edges.map((edge) => {
                const from = nodeById.get(edge.fromNode);
                const to = nodeById.get(edge.toNode);
                if (!from || !to) return null;
                const start = sidePoint(from, edge.fromSide);
                const end = sidePoint(to, edge.toSide);
                const selected = selectedEdgeId === edge.id;
                return (
                  <g key={edge.id} className="pointer-events-auto cursor-pointer" onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeIds([]); }}>
                    <path d={edgePath(start, end)} fill="none" stroke="transparent" strokeWidth={18} />
                    <path d={edgePath(start, end)} fill="none" className={selected ? "stroke-blue-500" : "stroke-gray-500 dark:stroke-gray-300"} strokeWidth={selected ? 3 : 2} markerEnd="url(#canvas-arrow)" />
                    {edge.label && <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 8} textAnchor="middle" className="fill-gray-700 text-xs dark:fill-gray-200">{edge.label}</text>}
                  </g>
                );
              })}
              {dragState?.type === "connect" && (() => {
                const from = nodeById.get(dragState.fromNode);
                if (!from) return null;
                const start = sidePoint(from, dragState.startSide);
                return <path d={edgePath(start, { x: dragState.currentWorldX, y: dragState.currentWorldY })} fill="none" className="stroke-blue-500" strokeWidth={2} strokeDasharray="8 6" />;
              })()}
            </svg>

            {canvas.nodes.map((node) => {
              const selected = selectedNodeIds.includes(node.id);
              const color = CARD_COLORS[node.color || DEFAULT_COLOR] || CARD_COLORS[DEFAULT_COLOR];
              const isEditing = editingNodeId === node.id;
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onDoubleClick={() => setEditingNodeId(node.id)}
                  className={`absolute rounded-xl border shadow-sm transition-shadow ${color.node} ${selected ? "border-blue-500 ring-2 ring-blue-400/50" : color.border} ${node.type === "group" ? "bg-opacity-40 dark:bg-opacity-25" : ""}`}
                  style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: node.type === "group" ? 0 : 1 }}
                >
                  <div className={`flex items-center gap-2 border-b px-3 py-2 text-xs font-medium ${selected ? "border-blue-200 dark:border-blue-800" : "border-gray-200 dark:border-gray-700"}`}>
                    <span className={`h-2 w-2 rounded-full ${color.accent}`} />
                    {nodeIcon(node.type)}
                    <span className="truncate text-gray-700 dark:text-gray-200">{node.type === "text" ? t("canvas.textCard") : node.type === "file" ? t("canvas.fileCard") : node.type === "link" ? t("canvas.linkCard") : (node.label || t("canvas.groupCard"))}</span>
                  </div>
                  <div className="h-[calc(100%-34px)] overflow-hidden p-3 text-sm text-gray-800 dark:text-gray-100">
                    {node.type === "text" && (isEditing ? (
                      <textarea autoFocus value={node.text || ""} onChange={(event) => updateSelectedNode({ text: event.target.value })} className="h-full w-full resize-none rounded border border-blue-300 bg-white/80 p-2 outline-none dark:border-blue-700 dark:bg-gray-950/80" />
                    ) : (
                      <div className="h-full whitespace-pre-wrap break-words overflow-hidden">{node.text || <span className="text-gray-400">Double-click to edit</span>}</div>
                    ))}
                    {node.type === "file" && <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><FileText size={32} className="text-blue-500" /><span className="break-all font-medium">{node.file || "path/to/file.md"}</span></div>}
                    {node.type === "link" && <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><Link size={32} className="text-purple-500" /><span className="break-all text-blue-600 dark:text-blue-300">{node.url || "https://example.com"}</span></div>}
                    {node.type === "group" && <div className="text-xs text-gray-500 dark:text-gray-400">{node.label || t("canvas.groupCard")}</div>}
                  </div>
                  {selected && ["top", "right", "bottom", "left"].map((side) => (
                    <button
                      key={side}
                      onPointerDown={(event) => handleConnectorPointerDown(event, node, side as CanvasEdgeSide)}
                      className={`absolute h-4 w-4 rounded-full border-2 border-white bg-blue-500 shadow ${side === "top" ? "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" : side === "right" ? "right-0 top-1/2 -translate-y-1/2 translate-x-1/2" : side === "bottom" ? "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" : "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"}`}
                      title={t("canvas.connectHint")}
                    />
                  ))}
                  {selected && <button onPointerDown={(event) => handleResizePointerDown(event, node)} className="absolute bottom-0 right-0 h-4 w-4 translate-x-1 translate-y-1 cursor-nwse-resize rounded-sm bg-blue-500 shadow" title="Resize" />}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="hidden w-72 shrink-0 border-l border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 lg:block">
          <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("canvas.inspector")}</h3>
          {selectedNode ? (
            <div className="space-y-3 text-xs">
              <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.color")}</span><select value={selectedNode.color || DEFAULT_COLOR} onChange={(event) => updateSelectedNode({ color: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950">{Object.entries(CARD_COLORS).map(([key, color]) => <option key={key} value={key}>{color.name}</option>)}</select></label>
              {selectedNode.type === "file" && <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.filePath")}</span><input value={selectedNode.file || ""} onChange={(event) => updateSelectedNode({ file: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
              {selectedNode.type === "link" && <label className="block"><span className="mb-1 block text-gray-500">URL</span><input value={selectedNode.url || ""} onChange={(event) => updateSelectedNode({ url: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
              {selectedNode.type === "group" && <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.label")}</span><input value={selectedNode.label || ""} onChange={(event) => updateSelectedNode({ label: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
              <div className="grid grid-cols-2 gap-2"><label><span className="mb-1 block text-gray-500">W</span><input type="number" value={selectedNode.width} onChange={(event) => updateSelectedNode({ width: Number(event.target.value) })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label><label><span className="mb-1 block text-gray-500">H</span><input type="number" value={selectedNode.height} onChange={(event) => updateSelectedNode({ height: Number(event.target.value) })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label></div>
            </div>
          ) : selectedEdge ? (
            <div className="space-y-3 text-xs"><label className="block"><span className="mb-1 block text-gray-500">{t("canvas.label")}</span><input value={selectedEdge.label || ""} onChange={(event) => updateSelectedEdge({ label: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label><div className="flex items-center gap-2 text-gray-500"><ArrowRight size={ICON.SM} />{selectedEdge.fromNode} → {selectedEdge.toNode}</div></div>
          ) : (
            <div className="space-y-3 text-xs text-gray-500 dark:text-gray-400">
              <p>{t("canvas.helpSelect")}</p>
              <p>{t("canvas.helpConnect")}</p>
              <p>{t("canvas.helpPanZoom")}</p>
              <div className="rounded-lg bg-gray-50 p-2 dark:bg-gray-950">Obsidian Canvas JSON v{CANVAS_VERSION}</div>
            </div>
          )}
        </aside>
      </div>

      {tempEditConfirm.visible && <TempEditUrlDialog t={t} onYes={tempEditConfirm.onYes} onNo={tempEditConfirm.onNo} />}
      {tempDiffData && (
        <TempDiffModal
          fileName={tempDiffData.fileName}
          currentContent={tempDiffData.currentContent}
          tempContent={tempDiffData.tempContent}
          tempSavedAt={tempDiffData.tempSavedAt}
          currentModifiedTime={tempDiffData.currentModifiedTime}
          isBinary={tempDiffData.isBinary}
          onAccept={handleTempDiffAccept}
          onReject={() => setTempDiffData(null)}
        />
      )}
    </div>
  );
}
