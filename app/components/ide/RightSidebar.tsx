import { useState, useEffect, useCallback, useRef } from "react";
import { PanelRightClose, PanelRight, X } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";

interface RightSidebarProps {
  children: React.ReactNode;
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  mobileTitle?: string;
}

const COLLAPSED_KEY = "ide-right-sidebar-collapsed";
const WIDTH_KEY = "ide-right-sidebar-width";
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 240;
const MAX_WIDTH = 800;

export function RightSidebar({ children, isMobile = false, mobileOpen = false, onMobileClose, mobileTitle }: RightSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const hydrated = useRef(false);

  // Restore from localStorage after hydration
  useEffect(() => {
    const savedCollapsed = localStorage.getItem(COLLAPSED_KEY);
    if (savedCollapsed === "true") setCollapsed(true);
    const savedWidth = localStorage.getItem(WIDTH_KEY);
    if (savedWidth) setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(savedWidth))));
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (hydrated.current) localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (hydrated.current) localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    // Full-screen overlay to prevent iframes from capturing mouse events
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize";
    document.body.appendChild(overlay);

    function onMouseUp() {
      isDragging.current = false;
      overlay.remove();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      if (ev.buttons === 0) { onMouseUp(); return; }
      // Right sidebar: dragging left increases width
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth - (ev.clientX - startX)));
      setWidth(newWidth);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width]);

  // Mobile: full-screen overlay
  if (isMobile) {
    if (!mobileOpen) return null;
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{mobileTitle || "Panel"}</span>
          <button
            onClick={onMobileClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          >
            <X size={ICON.LG} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      </div>
    );
  }

  // Desktop: resizable sidebar
  return (
    <div
      className={`relative flex flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 transition-[width] ${
        isDragging.current ? "" : "duration-200"
      } ${collapsed ? "w-12" : ""}`}
      style={collapsed ? undefined : { width }}
    >
      <div className="flex items-center p-1">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title={collapsed ? "Expand panel" : "Collapse panel"}
        >
          {collapsed ? <PanelRight size={ICON.LG} /> : <PanelRightClose size={ICON.LG} />}
        </button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      )}
      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/50"
        />
      )}
    </div>
  );
}
