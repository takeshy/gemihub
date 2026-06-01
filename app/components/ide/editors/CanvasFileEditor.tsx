import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Clipboard,
  Download,
  FileText,
  GitCompareArrows,
  HelpCircle,
  History,
  Link,
  Maximize,
  Palette,
  Redo2,
  RotateCcw,
  Settings,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  Upload,
  X,
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
import GfmMarkdownPreview from "../GfmMarkdownPreview";
import { TempDiffModal } from "../TempDiffModal";

const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 180;
const MIN_NODE_WIDTH = 160;
const MIN_NODE_HEIGHT = 90;
const DEFAULT_COLOR = "";

const CARD_COLORS: Record<string, { name: string; node: string; border: string; accent: string }> = {
  "": { name: "Default", node: "bg-white dark:bg-gray-900", border: "border-gray-300 dark:border-gray-700", accent: "bg-gray-500" },
  "1": { name: "Red", node: "bg-red-50 dark:bg-red-950/40", border: "border-red-300 dark:border-red-800", accent: "bg-red-500" },
  "2": { name: "Orange", node: "bg-orange-50 dark:bg-orange-950/40", border: "border-orange-300 dark:border-orange-800", accent: "bg-orange-500" },
  "3": { name: "Yellow", node: "bg-yellow-50 dark:bg-yellow-950/40", border: "border-yellow-300 dark:border-yellow-800", accent: "bg-yellow-500" },
  "4": { name: "Green", node: "bg-green-50 dark:bg-green-950/40", border: "border-green-300 dark:border-green-800", accent: "bg-green-500" },
  "5": { name: "Cyan", node: "bg-cyan-50 dark:bg-cyan-950/40", border: "border-cyan-300 dark:border-cyan-800", accent: "bg-cyan-500" },
  "6": { name: "Purple", node: "bg-purple-50 dark:bg-purple-950/40", border: "border-purple-300 dark:border-purple-800", accent: "bg-purple-500" },
};

type CanvasNodeType = "text" | "file" | "link" | "group";
type CanvasEdgeSide = "top" | "right" | "bottom" | "left";
type CanvasFilePreviewState =
  | { status: "idle" | "loading" }
  | { status: "missing"; path: string }
  | { status: "error"; message: string }
  | { status: "loaded"; fileId: string; name: string; path: string; mimeType: string; content?: string; rawUrl?: string };

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
  subpath?: string;
  url?: string;
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: CanvasEdgeSide;
  fromEnd?: "none" | "arrow";
  toNode: string;
  toSide?: CanvasEdgeSide;
  toEnd?: "none" | "arrow";
  color?: string;
  label?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

type NodeMenuState = { nodeId: string; x: number; y: number } | null;
type EdgeMenuState = { edgeId: string; x: number; y: number } | null;
type CanvasContextMenuState = { x: number; y: number; worldX: number; worldY: number } | null;
type ConnectDraft = { fromNode: string; fromSide: CanvasEdgeSide } | null;
type DragState =
  | { type: "pan"; pointerId: number; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { type: "move"; pointerId: number; nodeId: string; startWorldX: number; startWorldY: number; originals: Array<{ id: string; x: number; y: number }> }
  | { type: "resize"; pointerId: number; nodeId: string; startWorldX: number; startWorldY: number; startWidth: number; startHeight: number };

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
          color: typeof node.color === "string" ? node.color : undefined,
          text: typeof node.text === "string" ? node.text : undefined,
          file: typeof node.file === "string" ? node.file : undefined,
          subpath: typeof node.subpath === "string" ? node.subpath : undefined,
          url: typeof node.url === "string" ? node.url : undefined,
          label: typeof node.label === "string" ? node.label : undefined,
          background: typeof node.background === "string" ? node.background : undefined,
          backgroundStyle: isBackgroundStyle(node.backgroundStyle) ? node.backgroundStyle : undefined,
        })),
      edges: parsed.edges
        .filter((edge: Partial<CanvasEdge>) => typeof edge.id === "string" && typeof edge.fromNode === "string" && typeof edge.toNode === "string")
        .map((edge: Partial<CanvasEdge>) => ({
          id: edge.id!,
          fromNode: edge.fromNode!,
          fromSide: isSide(edge.fromSide) ? edge.fromSide : undefined,
          fromEnd: isEdgeEnd(edge.fromEnd) ? edge.fromEnd : undefined,
          toNode: edge.toNode!,
          toSide: isSide(edge.toSide) ? edge.toSide : undefined,
          toEnd: isEdgeEnd(edge.toEnd) ? edge.toEnd : undefined,
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

function isEdgeEnd(value: unknown): value is "none" | "arrow" {
  return value === "none" || value === "arrow";
}

function isBackgroundStyle(value: unknown): value is "cover" | "ratio" | "repeat" {
  return value === "cover" || value === "ratio" || value === "repeat";
}

function serializeCanvas(data: CanvasData): string {
  return `${JSON.stringify({ nodes: data.nodes, edges: data.edges }, null, 2)}\n`;
}

function cloneCanvas(data: CanvasData): CanvasData {
  return {
    nodes: data.nodes.map((node) => ({ ...node })),
    edges: data.edges.map((edge) => ({ ...edge })),
  };
}

function nextId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function isHexColor(value: string | undefined): value is string {
  return !!value && /^#[0-9a-f]{6}$/i.test(value);
}

function linkLabel(url: string | undefined): string {
  if (!url) return "https://example.com";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function resolveCanvasFile(fileList: ReturnType<typeof useEditorContext>["fileList"], path: string | undefined) {
  if (!path) return null;
  const cleanPath = path.replace(/^\/+/, "");
  const withoutSubpath = cleanPath.split("#")[0];
  const lower = withoutSubpath.toLowerCase();
  return fileList.find((item) => item.path.toLowerCase() === lower)
    || fileList.find((item) => item.path.replace(/^\/+/, "").toLowerCase() === lower)
    || fileList.find((item) => item.name.toLowerCase() === lower)
    || fileList.find((item) => item.path.toLowerCase().endsWith(`/${lower}`))
    || null;
}

function CanvasFilePreview({ node, fileList }: { node: CanvasNode; fileList: ReturnType<typeof useEditorContext>["fileList"] }) {
  const [preview, setPreview] = useState<CanvasFilePreviewState>({ status: "idle" });
  const resolved = useMemo(() => resolveCanvasFile(fileList, node.file), [fileList, node.file]);

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      if (!node.file || !resolved) {
        setPreview({ status: "missing", path: node.file || "path/to/file.md" });
        return;
      }
      setPreview({ status: "loading" });
      try {
        const metaRes = await fetch(`/api/drive/files?action=metadata&fileId=${encodeURIComponent(resolved.id)}`);
        if (!metaRes.ok) throw new Error("Failed to load metadata");
        const meta = await metaRes.json();
        const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : "";
        const name = typeof meta.name === "string" ? meta.name : resolved.name;
        const lowerName = name.toLowerCase();
        const isImage = mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
        const isText = mimeType.startsWith("text/")
          || /\.(md|markdown|txt|json|ya?ml|csv|ts|tsx|js|jsx|css|html?)$/i.test(name);
        if (isImage) {
          if (!cancelled) {
            setPreview({ status: "loaded", fileId: resolved.id, name, path: resolved.path, mimeType, rawUrl: `/api/drive/files?action=raw&fileId=${encodeURIComponent(resolved.id)}` });
          }
          return;
        }
        if (!isText) {
          if (!cancelled) setPreview({ status: "loaded", fileId: resolved.id, name, path: resolved.path, mimeType });
          return;
        }
        const readRes = await fetch(`/api/drive/files?action=read&fileId=${encodeURIComponent(resolved.id)}`);
        if (!readRes.ok) throw new Error("Failed to load file");
        const data = await readRes.json();
        if (!cancelled) {
          setPreview({ status: "loaded", fileId: resolved.id, name, path: resolved.path, mimeType, content: typeof data.content === "string" ? data.content : "", rawUrl: lowerName.endsWith(".html") || lowerName.endsWith(".htm") ? `/api/drive/files?action=raw&fileId=${encodeURIComponent(resolved.id)}` : undefined });
        }
      } catch (error) {
        if (!cancelled) setPreview({ status: "error", message: error instanceof Error ? error.message : "Failed to load preview" });
      }
    }
    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [node.file, resolved]);

  if (preview.status === "loading" || preview.status === "idle") {
    return <div className="text-xs text-gray-500 dark:text-gray-400">Loading preview...</div>;
  }
  if (preview.status === "missing") {
    return <div className="break-all text-xs text-gray-500 dark:text-gray-400">{preview.path}</div>;
  }
  if (preview.status === "error") {
    return <div className="text-xs text-red-500">{preview.message}</div>;
  }
  if (preview.status !== "loaded") {
    return null;
  }

  const lowerName = preview.name.toLowerCase();
  if (preview.rawUrl && preview.mimeType.startsWith("image/")) {
    return <img src={preview.rawUrl} alt={preview.name} className="h-full w-full rounded-md object-cover" draggable={false} />;
  }
  if ((lowerName.endsWith(".html") || lowerName.endsWith(".htm")) && preview.content !== undefined) {
    return <iframe title={preview.name} srcDoc={preview.content} className="pointer-events-none h-full w-full rounded-md border-0 bg-white" sandbox="" />;
  }
  if ((lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) && preview.content !== undefined) {
    return (
      <div className="prose prose-sm h-full max-w-none overflow-hidden dark:prose-invert">
        <GfmMarkdownPreview content={preview.content} />
      </div>
    );
  }
  if (preview.content !== undefined) {
    return <pre className="h-full overflow-hidden whitespace-pre-wrap break-words text-xs text-gray-700 dark:text-gray-200">{preview.content}</pre>;
  }
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1.5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
        <FileText size={ICON.SM} className="shrink-0" />
        <span className="truncate font-medium">{preview.name}</span>
      </div>
      <div className="break-all font-mono text-xs text-gray-600 dark:text-gray-300">{preview.path}</div>
    </div>
  );
}

function CanvasLinkPreview({ url }: { url: string | undefined }) {
  const href = url || "https://example.com";
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white/70 px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-950/30">
        <Link size={ICON.SM} className="shrink-0 text-purple-500" />
        <span className="truncate font-medium text-gray-700 dark:text-gray-200">{linkLabel(href)}</span>
      </div>
      <iframe title={href} src={href} className="pointer-events-none min-h-0 flex-1 border-0 bg-white" sandbox="allow-same-origin allow-scripts allow-popups allow-forms" referrerPolicy="no-referrer" />
      <div className="truncate border-t border-gray-200 px-2 py-1 text-[10px] text-blue-700 dark:border-gray-700 dark:text-blue-300">{href}</div>
    </div>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span>{label}</span>
      <div className="flex flex-wrap justify-end gap-2">
        {keys.map((key) => (
          <kbd key={key} className="rounded-md bg-gray-700/70 px-2 py-1 font-mono text-sm font-semibold text-gray-100">
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
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
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [readOnly, setReadOnly] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapToObjects, setSnapToObjects] = useState(true);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeMenuState>(null);
  const [canvasMenu, setCanvasMenu] = useState<CanvasContextMenuState>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectDraft>(null);
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
  const undoStackRef = useRef<CanvasData[]>([]);
  const redoStackRef = useRef<CanvasData[]>([]);
  const dragStartCanvasRef = useRef<CanvasData | null>(null);
  const spacePressedRef = useRef(false);
  const [, setHistoryVersion] = useState(0);
  const serializedContent = useMemo(() => serializeCanvas(canvas), [canvas]);
  const selectedNode = selectedNodeIds.length === 1 ? canvas.nodes.find((node) => node.id === selectedNodeIds[0]) || null : null;
  const selectedEdge = selectedEdgeId ? canvas.edges.find((edge) => edge.id === selectedEdgeId) || null : null;
  const tempEditConfirm = useTempEditConfirm();
  const nodeById = useMemo(() => new Map(canvas.nodes.map((node) => [node.id, node])), [canvas.nodes]);

  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (rect?.left || 0) - pan.x) / zoom,
      y: (clientY - (rect?.top || 0) - pan.y) / zoom,
    };
  }, [pan.x, pan.y, zoom]);

  const zoomAroundPoint = useCallback((clientX: number, clientY: number, nextZoom: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldX = (clientX - rect.left - pan.x) / zoom;
    const worldY = (clientY - rect.top - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: clientX - rect.left - worldX * nextZoom,
      y: clientY - rect.top - worldY * nextZoom,
    });
  }, [pan.x, pan.y, zoom]);

  const zoomToBounds = useCallback((bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(120, bounds.maxX - bounds.minX);
    const height = Math.max(120, bounds.maxY - bounds.minY);
    const nextZoom = Math.min(1.5, Math.max(0.2, Math.min((rect.width * 0.78) / width, (rect.height * 0.78) / height)));
    setZoom(nextZoom);
    setPan({
      x: rect.width / 2 - (bounds.minX + width / 2) * nextZoom,
      y: rect.height / 2 - (bounds.minY + height / 2) * nextZoom,
    });
  }, []);

  const zoomToFit = useCallback(() => {
    if (canvas.nodes.length === 0) {
      setZoom(1);
      setPan({ x: 80, y: 80 });
      return;
    }
    zoomToBounds({
      minX: Math.min(...canvas.nodes.map((node) => node.x)),
      minY: Math.min(...canvas.nodes.map((node) => node.y)),
      maxX: Math.max(...canvas.nodes.map((node) => node.x + node.width)),
      maxY: Math.max(...canvas.nodes.map((node) => node.y + node.height)),
    });
  }, [canvas.nodes, zoomToBounds]);

  const zoomToSelection = useCallback(() => {
    const nodes = canvas.nodes.filter((node) => selectedNodeIds.includes(node.id));
    const edge = selectedEdgeId ? canvas.edges.find((item) => item.id === selectedEdgeId) : null;
    if (nodes.length > 0) {
      zoomToBounds({
        minX: Math.min(...nodes.map((node) => node.x)),
        minY: Math.min(...nodes.map((node) => node.y)),
        maxX: Math.max(...nodes.map((node) => node.x + node.width)),
        maxY: Math.max(...nodes.map((node) => node.y + node.height)),
      });
      return;
    }
    if (edge) {
      const from = nodeById.get(edge.fromNode);
      const to = nodeById.get(edge.toNode);
      if (from && to) {
        zoomToBounds({
          minX: Math.min(from.x, to.x),
          minY: Math.min(from.y, to.y),
          maxX: Math.max(from.x + from.width, to.x + to.width),
          maxY: Math.max(from.y + from.height, to.y + to.height),
        });
        return;
      }
    }
    zoomToFit();
  }, [canvas.edges, canvas.nodes, nodeById, selectedEdgeId, selectedNodeIds, zoomToBounds, zoomToFit]);

  const snapNumber = useCallback((value: number) => {
    return snapToGrid ? Math.round(value / 20) * 20 : Math.round(value);
  }, [snapToGrid]);

  const snapPosition = useCallback((x: number, y: number, nodeId?: string) => {
    let nextX = snapNumber(x);
    let nextY = snapNumber(y);
    if (snapToObjects) {
      const threshold = 10 / zoom;
      for (const node of canvas.nodes) {
        if (node.id === nodeId) continue;
        const xGuides = [node.x, node.x + node.width / 2, node.x + node.width];
        const yGuides = [node.y, node.y + node.height / 2, node.y + node.height];
        const ownXGuides = [nextX, nextX + DEFAULT_NODE_WIDTH / 2, nextX + DEFAULT_NODE_WIDTH];
        const ownYGuides = [nextY, nextY + DEFAULT_NODE_HEIGHT / 2, nextY + DEFAULT_NODE_HEIGHT];
        for (const guide of xGuides) {
          for (const ownGuide of ownXGuides) {
            if (Math.abs(guide - ownGuide) <= threshold) nextX += guide - ownGuide;
          }
        }
        for (const guide of yGuides) {
          for (const ownGuide of ownYGuides) {
            if (Math.abs(guide - ownGuide) <= threshold) nextY += guide - ownGuide;
          }
        }
      }
    }
    return { x: Math.round(nextX), y: Math.round(nextY) };
  }, [canvas.nodes, snapNumber, snapToObjects, zoom]);

  const updateCanvas = useCallback((updater: (current: CanvasData) => CanvasData, options?: { history?: boolean }) => {
    contentFromProps.current = false;
    setCanvas((current) => {
      if (options?.history !== false) {
        undoStackRef.current.push(cloneCanvas(current));
        redoStackRef.current = [];
        setHistoryVersion((version) => version + 1);
      }
      return updater(current);
    });
  }, []);

  const undoCanvas = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    contentFromProps.current = false;
    setCanvas((current) => {
      redoStackRef.current.push(cloneCanvas(current));
      return previous;
    });
    setHistoryVersion((version) => version + 1);
    setEditingNodeId(null);
    setNodeMenu(null);
  }, []);

  const redoCanvas = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    contentFromProps.current = false;
    setCanvas((current) => {
      undoStackRef.current.push(cloneCanvas(current));
      return next;
    });
    setHistoryVersion((version) => version + 1);
    setEditingNodeId(null);
    setNodeMenu(null);
  }, []);

  const setCanvasReadOnly = useCallback((nextReadOnly: boolean) => {
    setReadOnly(nextReadOnly);
    if (!nextReadOnly) return;
    setEditingNodeId(null);
    setNodeMenu(null);
    setEdgeMenu(null);
    setCanvasMenu(null);
    setConnectDraft(null);
    setDragState(null);
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
    setNodeMenu(null);
    setEdgeMenu(null);
    setConnectDraft(null);
    setEdgeMenu(null);
    setConnectDraft(null);
    setCanvasMenu(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryVersion((version) => version + 1);
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

  const addNodeAt = useCallback((type: CanvasNodeType, x: number, y: number, patch?: Partial<CanvasNode>) => {
    if (readOnly) return;
    const id = nextId();
    const width = type === "group" ? 420 : DEFAULT_NODE_WIDTH;
    const height = type === "group" ? 260 : DEFAULT_NODE_HEIGHT;
    const snapped = snapPosition(x, y);
    const base: CanvasNode = {
      id,
      type,
      x: snapped.x,
      y: snapped.y,
      width,
      height,
      text: type === "text" ? "New note" : undefined,
      label: type === "group" ? "Group" : undefined,
      file: type === "file" ? "path/to/file.md" : undefined,
      url: type === "link" ? "https://example.com" : undefined,
      ...patch,
    };
    updateCanvas((current) => ({ ...current, nodes: [...current.nodes, base] }));
    setSelectedNodeIds([id]);
    setSelectedEdgeId(null);
    if (type === "text") setEditingNodeId(id);
    setCanvasMenu(null);
  }, [readOnly, snapPosition, updateCanvas]);

  const deleteSelection = useCallback(async () => {
    if (readOnly) return;
    if (selectedNodeIds.length === 0 && !selectedEdgeId) return;
    await addCommitBoundary(fileId);
    updateCanvas((current) => ({
      nodes: current.nodes.filter((node) => !selectedNodeIds.includes(node.id)),
      edges: current.edges.filter((edge) => !selectedEdgeId || edge.id !== selectedEdgeId).filter((edge) => !selectedNodeIds.includes(edge.fromNode) && !selectedNodeIds.includes(edge.toNode)),
    }));
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
  }, [fileId, readOnly, selectedEdgeId, selectedNodeIds, updateCanvas]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest("input, textarea")) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.code === "Space") {
        event.preventDefault();
        spacePressedRef.current = true;
        return;
      }
      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoCanvas();
        return;
      }
      if ((mod && event.key.toLowerCase() === "y") || (mod && event.shiftKey && event.key.toLowerCase() === "z")) {
        event.preventDefault();
        redoCanvas();
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedNodeIds(canvas.nodes.map((node) => node.id));
        setSelectedEdgeId(null);
        setNodeMenu(null);
        setEdgeMenu(null);
        return;
      }
      if (event.shiftKey && event.code === "Digit1") {
        event.preventDefault();
        zoomToFit();
        return;
      }
      if (event.shiftKey && event.code === "Digit2") {
        event.preventDefault();
        zoomToSelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (readOnly) return;
        event.preventDefault();
        deleteSelection();
      }
      if (event.key === "Escape") {
        setEditingNodeId(null);
        setDragState(null);
        setNodeMenu(null);
        setEdgeMenu(null);
        setConnectDraft(null);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [canvas.nodes, deleteSelection, readOnly, redoCanvas, undoCanvas, zoomToFit, zoomToSelection]);

  const handleViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
    setNodeMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ type: "pan", pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPanX: pan.x, startPanY: pan.y });
  };

  const handleNodePointerDown = (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("textarea, input, button, a, iframe")) return;
    if (spacePressedRef.current) {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setNodeMenu(null);
      setEdgeMenu(null);
      setCanvasMenu(null);
      setDragState({ type: "pan", pointerId: event.pointerId, startClientX: event.clientX, startClientY: event.clientY, startPanX: pan.x, startPanY: pan.y });
      return;
    }
    event.stopPropagation();
    setCanvasMenu(null);
    setEdgeMenu(null);
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
    setNodeMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    if (readOnly) {
      return;
    }
    const world = screenToWorld(event.clientX, event.clientY);
    dragStartCanvasRef.current = cloneCanvas(canvas);
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

  const handleConnectorClick = (event: React.MouseEvent<HTMLButtonElement>, node: CanvasNode, side: CanvasEdgeSide) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    setNodeMenu(null);
    setEdgeMenu(null);
    setCanvasMenu(null);
    if (!connectDraft || connectDraft.fromNode === node.id) {
      setConnectDraft({ fromNode: node.id, fromSide: side });
      setSelectedNodeIds([node.id]);
      return;
    }
    const id = nextId();
    updateCanvas((current) => ({
      ...current,
      edges: [...current.edges, {
        id,
        fromNode: connectDraft.fromNode,
        fromSide: connectDraft.fromSide,
        toNode: node.id,
        toSide: side,
        toEnd: "arrow",
      }],
    }));
    setSelectedNodeIds([]);
    setSelectedEdgeId(id);
    setConnectDraft(null);
  };

  const handleResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>, node: CanvasNode) => {
    if (readOnly) return;
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    dragStartCanvasRef.current = cloneCanvas(canvas);
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
      setNodeMenu(null);
      const dx = world.x - dragState.startWorldX;
      const dy = world.y - dragState.startWorldY;
      updateCanvas((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          const original = dragState.originals.find((item) => item.id === node.id);
          if (!original) return node;
          let nextX = snapNumber(original.x + dx);
          let nextY = snapNumber(original.y + dy);
          if (snapToObjects) {
            const threshold = 10 / zoom;
            for (const other of current.nodes) {
              if (other.id === node.id || dragState.originals.some((item) => item.id === other.id)) continue;
              const otherXGuides = [other.x, other.x + other.width / 2, other.x + other.width];
              const otherYGuides = [other.y, other.y + other.height / 2, other.y + other.height];
              const ownXGuides = [nextX, nextX + node.width / 2, nextX + node.width];
              const ownYGuides = [nextY, nextY + node.height / 2, nextY + node.height];
              for (const guide of otherXGuides) {
                for (const ownGuide of ownXGuides) {
                  if (Math.abs(guide - ownGuide) <= threshold) nextX += guide - ownGuide;
                }
              }
              for (const guide of otherYGuides) {
                for (const ownGuide of ownYGuides) {
                  if (Math.abs(guide - ownGuide) <= threshold) nextY += guide - ownGuide;
                }
              }
            }
          }
          return { ...node, x: Math.round(nextX), y: Math.round(nextY) };
        }),
      }), { history: false });
    } else if (dragState.type === "resize") {
      setNodeMenu(null);
      updateCanvas((current) => ({
        ...current,
        nodes: current.nodes.map((node) => node.id === dragState.nodeId
          ? { ...node, width: Math.max(MIN_NODE_WIDTH, snapNumber(dragState.startWidth + world.x - dragState.startWorldX)), height: Math.max(MIN_NODE_HEIGHT, snapNumber(dragState.startHeight + world.y - dragState.startWorldY)) }
          : node),
      }), { history: false });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    if ((dragState.type === "move" || dragState.type === "resize") && dragStartCanvasRef.current) {
      undoStackRef.current.push(dragStartCanvasRef.current);
      redoStackRef.current = [];
      dragStartCanvasRef.current = null;
      setHistoryVersion((version) => version + 1);
    }
    setDragState(null);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const zooming = event.ctrlKey || event.metaKey || spacePressedRef.current;
    event.preventDefault();
    if (zooming) {
      const nextZoom = Math.min(2.5, Math.max(0.2, zoom - event.deltaY * 0.001));
      zoomAroundPoint(event.clientX, event.clientY, nextZoom);
      return;
    }
    if (event.shiftKey) {
      setPan((current) => ({ ...current, x: current.x - event.deltaY }));
      return;
    }
    setPan((current) => ({ ...current, y: current.y - event.deltaY }));
  };

  const handleCanvasContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (readOnly) {
      setCanvasMenu(null);
      return;
    }
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
    setNodeMenu(null);
    setCanvasMenu({ x: event.clientX, y: event.clientY, worldX: world.x, worldY: world.y });
  };

  const addFileNodeFromVault = useCallback((worldX: number, worldY: number, mediaOnly = false) => {
    const preferred = editorCtx.activeFileName
      ? editorCtx.fileList.find((item) => item.name === editorCtx.activeFileName)
      : null;
    const firstMedia = editorCtx.fileList.find((item) => /\.(png|jpe?g|gif|webp|svg|mp4|webm|mp3|wav|pdf)$/i.test(item.name));
    const firstNote = editorCtx.fileList.find((item) => /\.(md|markdown)$/i.test(item.name));
    const target = mediaOnly ? firstMedia : preferred || firstNote || editorCtx.fileList[0] || null;
    addNodeAt("file", worldX, worldY, { file: target?.path || (mediaOnly ? "path/to/media.png" : "path/to/note.md") });
  }, [addNodeAt, editorCtx.activeFileName, editorCtx.fileList]);

  const pasteCanvasContent = useCallback(async (worldX: number, worldY: number) => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = "";
    }
    addNodeAt("text", worldX, worldY, { text: text || "Pasted card" });
  }, [addNodeAt]);

  const updateSelectedNode = (patch: Partial<CanvasNode>) => {
    if (!selectedNode) return;
    updateCanvas((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...patch } : node) }));
  };

  const updateSelectedEdge = (patch: Partial<CanvasEdge>) => {
    if (!selectedEdge) return;
    updateCanvas((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, ...patch } : edge) }));
  };

  const zoomToNode = useCallback((node: CanvasNode) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = Math.min(1.5, Math.max(0.4, Math.min((rect.width * 0.55) / node.width, (rect.height * 0.55) / node.height)));
    setZoom(nextZoom);
    setPan({
      x: rect.width / 2 - (node.x + node.width / 2) * nextZoom,
      y: rect.height / 2 - (node.y + node.height / 2) * nextZoom,
    });
    setNodeMenu(null);
  }, []);

  const deleteNode = useCallback(async (nodeId: string) => {
    await addCommitBoundary(fileId);
    updateCanvas((current) => ({
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.fromNode !== nodeId && edge.toNode !== nodeId),
    }));
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingNodeId(null);
    setNodeMenu(null);
  }, [fileId, updateCanvas]);

  const setNodeColor = useCallback((nodeId: string, color: string | undefined) => {
    updateCanvas((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, color } : node),
    }));
    setNodeMenu(null);
  }, [updateCanvas]);

  const setEdgeDirection = useCallback((edgeId: string, direction: "none" | "uni" | "bi") => {
    updateCanvas((current) => ({
      ...current,
      edges: current.edges.map((edge) => {
        if (edge.id !== edgeId) return edge;
        if (direction === "none") return { ...edge, fromEnd: "none", toEnd: "none" };
        if (direction === "bi") return { ...edge, fromEnd: "arrow", toEnd: "arrow" };
        return { ...edge, fromEnd: "none", toEnd: "arrow" };
      }),
    }));
    setEdgeMenu(null);
  }, [updateCanvas]);

  const setEdgeColor = useCallback((edgeId: string, color: string | undefined) => {
    updateCanvas((current) => ({
      ...current,
      edges: current.edges.map((edge) => edge.id === edgeId ? { ...edge, color } : edge),
    }));
    setEdgeMenu(null);
  }, [updateCanvas]);

  const deleteEdge = useCallback((edgeId: string) => {
    updateCanvas((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));
    setSelectedEdgeId(null);
    setEdgeMenu(null);
  }, [updateCanvas]);

  const zoomToEdge = useCallback((edge: CanvasEdge) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const from = nodeById.get(edge.fromNode);
    const to = nodeById.get(edge.toNode);
    if (!rect || !from || !to) return;
    const minX = Math.min(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxX = Math.max(from.x + from.width, to.x + to.width);
    const maxY = Math.max(from.y + from.height, to.y + to.height);
    const width = Math.max(120, maxX - minX);
    const height = Math.max(120, maxY - minY);
    const nextZoom = Math.min(1.5, Math.max(0.25, Math.min((rect.width * 0.65) / width, (rect.height * 0.65) / height)));
    setZoom(nextZoom);
    setPan({
      x: rect.width / 2 - (minX + width / 2) * nextZoom,
      y: rect.height / 2 - (minY + height / 2) * nextZoom,
    });
    setEdgeMenu(null);
  }, [nodeById]);

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

  const menuNode = nodeMenu ? nodeById.get(nodeMenu.nodeId) || null : null;
  const menuEdge = edgeMenu ? canvas.edges.find((edge) => edge.id === edgeMenu.edgeId) || null : null;
  const gridSize = 48;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-100 dark:bg-gray-950" onBlur={flushPendingSave}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <div className="min-w-0 text-center text-sm font-medium text-gray-600 dark:text-gray-300">
          <span className="block truncate">{fileName.replace(/\.canvas$/i, "")}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">{readOnly ? "Read only" : "Edit"}</span>
          {onHistoryClick && <button onClick={onHistoryClick} className="canvas-toolbar-button" title={t("editHistory.menuLabel")}><History size={ICON.SM} /><span className="hidden sm:inline">{t("editHistory.menuLabel")}</span></button>}
          {onDiffClick && <button onClick={onDiffClick} className="canvas-toolbar-button" title={t("mainViewer.diff")}><GitCompareArrows size={ICON.SM} /><span className="hidden sm:inline">{t("mainViewer.diff")}</span></button>}
          <button onClick={handleTempUpload} disabled={uploading} className="canvas-toolbar-button disabled:opacity-50" title={t("contextMenu.tempUpload")}><Upload size={ICON.SM} /></button>
          <button onClick={handleTempDownload} className="canvas-toolbar-button" title={t("contextMenu.tempDownload")}><Download size={ICON.SM} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={viewportRef}
          className={`relative flex-1 touch-none overflow-hidden ${dragState?.type === "pan" ? "cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => setDragState(null)}
          onWheel={handleWheel}
          onContextMenu={handleCanvasContextMenu}
        >
          <div className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-30" style={{ backgroundImage: "radial-gradient(circle, rgb(148 163 184) 1px, transparent 1px)", backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }} />
          <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <svg className="pointer-events-none absolute overflow-visible" style={{ width: 1, height: 1 }}>
              <defs>
                <marker id="canvas-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
                </marker>
                <marker id="canvas-arrow-start" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M9,0 L9,6 L0,3 z" fill="context-stroke" />
                </marker>
              </defs>
              {canvas.edges.map((edge) => {
                const from = nodeById.get(edge.fromNode);
                const to = nodeById.get(edge.toNode);
                if (!from || !to) return null;
                const start = sidePoint(from, edge.fromSide);
                const end = sidePoint(to, edge.toSide);
                const selected = selectedEdgeId === edge.id;
                const edgeColor = isHexColor(edge.color) ? edge.color : undefined;
                return (
                  <g
                    key={edge.id}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeIds([]);
                      setNodeMenu(null);
                      setCanvasMenu(null);
                      setConnectDraft(null);
                      if (!readOnly) setEdgeMenu({ edgeId: edge.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <path d={edgePath(start, end)} fill="none" stroke="transparent" strokeWidth={18} />
                    <path
                      d={edgePath(start, end)}
                      fill="none"
                      className={selected ? "stroke-blue-500" : "stroke-gray-500 dark:stroke-gray-300"}
                      stroke={selected ? undefined : edgeColor}
                      strokeWidth={selected ? 3 : 2}
                      markerStart={edge.fromEnd === "arrow" ? "url(#canvas-arrow-start)" : undefined}
                      markerEnd={edge.toEnd === "none" ? undefined : "url(#canvas-arrow)"}
                    />
                    {edge.label && (
                      <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 8} textAnchor="middle" className="fill-gray-700 text-xs dark:fill-gray-200">
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>

            {canvas.nodes.map((node) => {
              const selected = selectedNodeIds.includes(node.id);
              const color = CARD_COLORS[node.color || DEFAULT_COLOR] || CARD_COLORS[DEFAULT_COLOR];
              const hexColor = isHexColor(node.color) ? node.color : undefined;
              const isEditing = editingNodeId === node.id;
              return (
                <div
                  key={node.id}
                  data-node-id={node.id}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onDoubleClick={() => {
                    if (node.type === "text") {
                      setEditingNodeId(node.id);
                      setCanvasReadOnly(false);
                    }
                  }}
                  className={`group pointer-events-auto absolute rounded-xl border shadow-sm transition-shadow ${color.node} ${selected ? "border-blue-500 ring-2 ring-blue-400/50" : color.border} ${node.type === "group" ? "bg-opacity-40 dark:bg-opacity-25" : ""}`}
                  style={{ left: node.x, top: node.y, width: node.width, height: node.height, zIndex: node.type === "group" ? 0 : 1, borderColor: selected ? undefined : hexColor }}
                >
                  {node.type === "group" && node.label && (
                    <div
                      className={`absolute left-0 top-0 max-w-full -translate-y-full rounded-t-md px-3 py-1 text-sm font-medium text-gray-900 shadow-sm dark:text-gray-100 ${color.node} ${color.border} border border-b-0`}
                      style={{ borderColor: hexColor, backgroundColor: hexColor ? `${hexColor}33` : undefined }}
                    >
                      <span className="block truncate">{node.label}</span>
                    </div>
                  )}
                  <div className={`h-full overflow-hidden text-sm text-gray-800 dark:text-gray-100 ${node.type === "group" || node.type === "link" ? "p-0" : "p-4"}`}>
                    {node.type === "text" && (isEditing ? (
                      <textarea autoFocus value={node.text || ""} onChange={(event) => updateSelectedNode({ text: event.target.value })} className="h-full w-full resize-none rounded border border-blue-300 bg-white/80 p-2 outline-none dark:border-blue-700 dark:bg-gray-950/80" />
                    ) : (
                      <div className="prose prose-sm h-full max-w-none overflow-hidden dark:prose-invert">
                        <GfmMarkdownPreview content={node.text || ""} />
                      </div>
                    ))}
                    {node.type === "file" && (
                      <CanvasFilePreview node={node} fileList={editorCtx.fileList} />
                    )}
                    {node.type === "link" && (
                      <CanvasLinkPreview url={node.url} />
                    )}
                  </div>
                  {!readOnly && ["top", "right", "bottom", "left"].map((side) => (
                    <button
                      key={side}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => handleConnectorClick(event, node, side as CanvasEdgeSide)}
                      className={`group/connector absolute flex h-10 w-10 items-center justify-center ${side === "top" ? "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" : side === "right" ? "right-0 top-1/2 -translate-y-1/2 translate-x-1/2" : side === "bottom" ? "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2" : "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"}`}
                      title={t("canvas.connectHint")}
                    >
                      <span className="h-4 w-4 rounded-full border-2 border-white bg-purple-500 opacity-0 shadow transition-opacity group-hover/connector:opacity-100 group-focus-visible/connector:opacity-100" />
                    </button>
                  ))}
                  {!readOnly && selected && <button onPointerDown={(event) => handleResizePointerDown(event, node)} className="absolute bottom-0 right-0 h-4 w-4 translate-x-1 translate-y-1 cursor-nwse-resize rounded-sm bg-blue-500 shadow" title="Resize" />}
                </div>
              );
            })}
          </div>

          {canvasMenu && !readOnly && (
            <div
              className="pointer-events-auto fixed z-50 w-56 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-800 dark:bg-gray-900"
              style={{ left: canvasMenu.x + 8, top: canvasMenu.y + 8 }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => addNodeAt("text", canvasMenu.worldX, canvasMenu.worldY)}>
                <StickyNote size={ICON.SM} /> Add card
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => addFileNodeFromVault(canvasMenu.worldX, canvasMenu.worldY)}>
                <FileText size={ICON.SM} /> Add note from vault
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => addFileNodeFromVault(canvasMenu.worldX, canvasMenu.worldY, true)}>
                <FileText size={ICON.SM} /> Add media from vault
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => addNodeAt("link", canvasMenu.worldX, canvasMenu.worldY)}>
                <Link size={ICON.SM} /> Add web page
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => addNodeAt("group", canvasMenu.worldX, canvasMenu.worldY)}>
                <Square size={ICON.SM} /> Create group
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => pasteCanvasContent(canvasMenu.worldX, canvasMenu.worldY)}>
                <Clipboard size={ICON.SM} /> Paste
              </button>
              <div className="my-1 border-t border-gray-200 dark:border-gray-800" />
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => setSnapToGrid((value) => !value)}>
                <span className="flex h-4 w-4 items-center justify-center">{snapToGrid && <Check size={ICON.SM} />}</span>
                Snap to grid
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => setSnapToObjects((value) => !value)}>
                <span className="flex h-4 w-4 items-center justify-center">{snapToObjects && <Check size={ICON.SM} />}</span>
                Snap to objects
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => setCanvasReadOnly(true)}>
                <Check size={ICON.SM} /> Read-only
              </button>
            </div>
          )}

          {menuEdge && edgeMenu && !readOnly && (
            <div
              className="pointer-events-auto fixed z-50 w-56 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-800 dark:bg-gray-900"
              style={{ left: edgeMenu.x + 8, top: edgeMenu.y + 8 }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => {
                  const label = window.prompt("Edit label", menuEdge.label || "");
                  if (label !== null) {
                    updateCanvas((current) => ({
                      ...current,
                      edges: current.edges.map((edge) => edge.id === menuEdge.id ? { ...edge, label: label || undefined } : edge),
                    }));
                  }
                  setEdgeMenu(null);
                }}
              >
                <StickyNote size={ICON.SM} /> Edit label
              </button>
              <div className="border-t border-gray-200 py-1 dark:border-gray-800">
                <div className="px-3 py-1.5 text-xs text-gray-500">Line Direction</div>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => setEdgeDirection(menuEdge.id, "none")}>
                  <span className="flex h-4 w-4 items-center justify-center">{menuEdge.fromEnd !== "arrow" && menuEdge.toEnd === "none" && <Check size={ICON.SM} />}</span>
                  nodirectional
                </button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => setEdgeDirection(menuEdge.id, "uni")}>
                  <span className="flex h-4 w-4 items-center justify-center">{menuEdge.fromEnd !== "arrow" && menuEdge.toEnd !== "none" && <Check size={ICON.SM} />}</span>
                  unidirectional
                </button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => setEdgeDirection(menuEdge.id, "bi")}>
                  <span className="flex h-4 w-4 items-center justify-center">{menuEdge.fromEnd === "arrow" && menuEdge.toEnd === "arrow" && <Check size={ICON.SM} />}</span>
                  bidirectional
                </button>
              </div>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => zoomToEdge(menuEdge)}>
                <ZoomIn size={ICON.SM} /> Zoom
              </button>
              <div className="border-t border-gray-200 py-1 dark:border-gray-800">
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500"><Palette size={ICON.SM} /> Set Color</div>
                <div className="grid grid-cols-7 gap-1 px-3 py-1">
                  {Object.entries(CARD_COLORS).map(([key, color]) => (
                    <button
                      key={key}
                      className={`h-5 w-5 rounded-full border ${color.accent} ${key === "" ? "bg-white dark:bg-gray-900" : ""}`}
                      title={color.name}
                      onClick={() => setEdgeColor(menuEdge.id, key || undefined)}
                    />
                  ))}
                </div>
              </div>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => deleteEdge(menuEdge.id)}>
                <Trash2 size={ICON.SM} /> Delete
              </button>
            </div>
          )}

          {menuNode && nodeMenu && (
            <div
              className="pointer-events-auto fixed z-50 w-44 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl dark:border-gray-800 dark:bg-gray-900"
              style={{ left: nodeMenu.x + 8, top: nodeMenu.y + 8 }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {!readOnly && (
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                  onClick={() => {
                    setSelectedNodeIds([menuNode.id]);
                    setNodeMenu(null);
                    if (menuNode.type === "text") {
                      setEditingNodeId(menuNode.id);
                    } else {
                      setSettingsOpen(true);
                    }
                  }}
                >
                  <StickyNote size={ICON.SM} /> Edit
                </button>
              )}
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800" onClick={() => zoomToNode(menuNode)}>
                <ZoomIn size={ICON.SM} /> Zoom
              </button>
              {!readOnly && (
                <div className="border-t border-gray-200 py-1 dark:border-gray-800">
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500"><Palette size={ICON.SM} /> Set color</div>
                  <div className="grid grid-cols-7 gap-1 px-3 py-1">
                    {Object.entries(CARD_COLORS).map(([key, color]) => (
                      <button
                        key={key}
                        className={`h-5 w-5 rounded-full border ${color.accent} ${key === "" ? "bg-white dark:bg-gray-900" : ""}`}
                        title={color.name}
                        onClick={() => setNodeColor(menuNode.id, key || undefined)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!readOnly && (
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => deleteNode(menuNode.id)}>
                  <Trash2 size={ICON.SM} /> Delete
                </button>
              )}
            </div>
          )}

          <div className="pointer-events-auto absolute right-3 top-3 z-20 flex flex-col items-end gap-4" onPointerDown={(event) => event.stopPropagation()}>
            <div className="overflow-hidden rounded-lg border border-gray-300 bg-white/90 text-gray-700 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200">
              <button type="button" onClick={() => setSettingsOpen((open) => !open)} className="flex h-12 w-12 items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800" title={t("canvas.inspector")}>
                <Settings size={ICON.MD} />
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-300 bg-white/90 text-gray-700 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200">
              <button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))} className="flex h-12 w-12 items-center justify-center border-b border-gray-200 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-800" title="Zoom in">
                <ZoomIn size={ICON.MD} />
              </button>
              <button type="button" onClick={() => { setZoom(1); setPan({ x: 80, y: 80 }); }} className="flex h-12 w-12 items-center justify-center border-b border-gray-200 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-800" title="Reset view">
                <RotateCcw size={ICON.MD} />
              </button>
              <button type="button" onClick={zoomToFit} className="flex h-12 w-12 items-center justify-center border-b border-gray-200 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-800" title="Zoom to fit">
                <Maximize size={ICON.MD} />
              </button>
              <button type="button" onClick={() => setZoom((value) => Math.max(0.2, value - 0.1))} className="flex h-12 w-12 items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800" title="Zoom out">
                <ZoomOut size={ICON.MD} />
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-300 bg-white/90 text-gray-700 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200">
              <button type="button" onClick={undoCanvas} disabled={undoStackRef.current.length === 0} className="flex h-12 w-12 items-center justify-center border-b border-gray-200 hover:bg-gray-100 disabled:opacity-40 dark:border-gray-800 dark:hover:bg-gray-800" title="Undo">
                <Undo2 size={ICON.MD} />
              </button>
              <button type="button" onClick={redoCanvas} disabled={redoStackRef.current.length === 0} className="flex h-12 w-12 items-center justify-center hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800" title="Redo">
                <Redo2 size={ICON.MD} />
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-300 bg-white/90 text-gray-700 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200">
              <button type="button" onClick={() => setHelpOpen(true)} className="flex h-12 w-12 items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800" title="Canvas help">
                <HelpCircle size={ICON.MD} />
              </button>
            </div>
            {settingsOpen && (
              <div className="absolute right-20 top-0 max-h-[calc(100vh-160px)] w-80 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-xl dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("canvas.inspector")}</h3>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                      <input type="checkbox" checked={!readOnly} onChange={(event) => setCanvasReadOnly(!event.target.checked)} />
                      Edit mode
                    </label>
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(false)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                      title="Close inspector"
                    >
                      <X size={ICON.SM} />
                    </button>
                  </div>
                </div>
                {selectedNode ? (
                  <div className="space-y-3">
                    <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.color")}</span><select value={selectedNode.color || DEFAULT_COLOR} onChange={(event) => updateSelectedNode({ color: event.target.value || undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950">{Object.entries(CARD_COLORS).map(([key, color]) => <option key={key} value={key}>{color.name}</option>)}</select></label>
                    <label className="block"><span className="mb-1 block text-gray-500">Hex color</span><input value={isHexColor(selectedNode.color) ? selectedNode.color : ""} placeholder="#FF0000" onChange={(event) => updateSelectedNode({ color: event.target.value || undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>
                    {selectedNode.type === "file" && <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.filePath")}</span><input value={selectedNode.file || ""} onChange={(event) => updateSelectedNode({ file: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
                    {selectedNode.type === "file" && <label className="block"><span className="mb-1 block text-gray-500">Subpath</span><input value={selectedNode.subpath || ""} onChange={(event) => updateSelectedNode({ subpath: event.target.value || undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
                    {selectedNode.type === "link" && <label className="block"><span className="mb-1 block text-gray-500">URL</span><input value={selectedNode.url || ""} onChange={(event) => updateSelectedNode({ url: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
                    {selectedNode.type === "group" && <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.label")}</span><input value={selectedNode.label || ""} onChange={(event) => updateSelectedNode({ label: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
                    {selectedNode.type === "group" && <label className="block"><span className="mb-1 block text-gray-500">Background</span><input value={selectedNode.background || ""} onChange={(event) => updateSelectedNode({ background: event.target.value || undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>}
                    {selectedNode.type === "group" && <label className="block"><span className="mb-1 block text-gray-500">Background style</span><select value={selectedNode.backgroundStyle || ""} onChange={(event) => updateSelectedNode({ backgroundStyle: isBackgroundStyle(event.target.value) ? event.target.value : undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"><option value="">Default</option><option value="cover">cover</option><option value="ratio">ratio</option><option value="repeat">repeat</option></select></label>}
                    <div className="grid grid-cols-2 gap-2"><label><span className="mb-1 block text-gray-500">W</span><input type="number" value={selectedNode.width} onChange={(event) => updateSelectedNode({ width: Number(event.target.value) })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label><label><span className="mb-1 block text-gray-500">H</span><input type="number" value={selectedNode.height} onChange={(event) => updateSelectedNode({ height: Number(event.target.value) })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label></div>
                  </div>
                ) : selectedEdge ? (
                  <div className="space-y-3">
                    <label className="block"><span className="mb-1 block text-gray-500">{t("canvas.label")}</span><input value={selectedEdge.label || ""} onChange={(event) => updateSelectedEdge({ label: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>
                    <label className="block"><span className="mb-1 block text-gray-500">Line color</span><input value={selectedEdge.color || ""} placeholder="#FF0000" onChange={(event) => updateSelectedEdge({ color: event.target.value || undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950" /></label>
                    <label className="block"><span className="mb-1 block text-gray-500">From end</span><select value={selectedEdge.fromEnd || "none"} onChange={(event) => updateSelectedEdge({ fromEnd: isEdgeEnd(event.target.value) && event.target.value !== "none" ? event.target.value : undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"><option value="none">none</option><option value="arrow">arrow</option></select></label>
                    <label className="block"><span className="mb-1 block text-gray-500">To end</span><select value={selectedEdge.toEnd || "arrow"} onChange={(event) => updateSelectedEdge({ toEnd: isEdgeEnd(event.target.value) && event.target.value !== "arrow" ? event.target.value : undefined })} className="w-full rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-950"><option value="arrow">arrow</option><option value="none">none</option></select></label>
                    <div className="flex items-center gap-2 text-gray-500"><ArrowRight size={ICON.SM} />{selectedEdge.fromNode} -&gt; {selectedEdge.toNode}</div>
                  </div>
                ) : (
                  <div className="space-y-3 text-gray-500 dark:text-gray-400">
                    <p>{t("canvas.helpSelect")}</p>
                    <p>{t("canvas.helpConnect")}</p>
                    <p>{t("canvas.helpPanZoom")}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          {helpOpen && (
            <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onPointerDown={(event) => event.stopPropagation()}>
              <div className="max-h-[86vh] w-full max-w-4xl overflow-auto rounded-2xl border border-gray-600 bg-[#1f1f1f] p-8 text-2xl text-gray-200 shadow-2xl">
                <div className="mb-7 flex items-center justify-between gap-4">
                  <h2 className="text-3xl font-semibold text-gray-100">Canvas help</h2>
                  <button type="button" onClick={() => setHelpOpen(false)} className="rounded-md p-1 text-gray-400 hover:bg-white/10 hover:text-gray-100" title="Close">
                    <X size={ICON.MD} />
                  </button>
                </div>
                <div className="space-y-5">
                  <ShortcutRow label="Pan" keys={["Space + Drag", "Scroll"]} />
                  <ShortcutRow label="Pan horizontally" keys={["Shift + Scroll"]} />
                  <ShortcutRow label="Zoom" keys={["Ctrl + Scroll", "Space + Scroll"]} />
                  <ShortcutRow label="Zoom to fit" keys={["Shift + 1"]} />
                  <ShortcutRow label="Zoom to selection" keys={["Shift + 2"]} />
                  <ShortcutRow label="Select all" keys={["Ctrl + A"]} />
                  <ShortcutRow label="Add to / remove from selection" keys={["Shift + Click"]} />
                  <ShortcutRow label="Remove card" keys={["Backspace", "Delete"]} />
                  <ShortcutRow label="Undo" keys={["Ctrl + Z"]} />
                  <ShortcutRow label="Redo" keys={["Ctrl + Y", "Ctrl + Shift + Z"]} />
                </div>
              </div>
            </div>
          )}
        </div>
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
