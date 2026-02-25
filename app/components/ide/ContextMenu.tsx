import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

function SubMenuPortal({
  items,
  parentRect,
  onClose,
  onMouseEnter,
  onMouseLeave,
  subMenuRef,
}: {
  items: ContextMenuItem[];
  parentRect: DOMRect;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  subMenuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const localRef = useRef<HTMLDivElement>(null);

  // Expose the DOM node to the parent via subMenuRef
  useEffect(() => {
    if (subMenuRef && localRef.current) {
      (subMenuRef as React.MutableRefObject<HTMLDivElement | null>).current = localRef.current;
    }
    return () => {
      if (subMenuRef) {
        (subMenuRef as React.MutableRefObject<HTMLDivElement | null>).current = null;
      }
    };
  }, [subMenuRef]);

  // Adjust position so submenu doesn't overflow viewport
  useEffect(() => {
    if (!localRef.current) return;
    const rect = localRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      localRef.current.style.left = `${parentRect.left - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      localRef.current.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  }, [parentRect]);

  return createPortal(
    <div
      ref={localRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[51] min-w-[140px] max-h-[80vh] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      style={{ left: parentRect.right, top: parentRect.top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick?.();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
            item.danger
              ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
              : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const subMenuRef = useRef<HTMLDivElement | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const subCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const openSubmenu = useCallback((label: string) => {
    if (subCloseTimer.current) {
      clearTimeout(subCloseTimer.current);
      subCloseTimer.current = null;
    }
    setOpenSub(label);
  }, []);

  const scheduleCloseSubmenu = useCallback(() => {
    subCloseTimer.current = setTimeout(() => setOpenSub(null), 150);
  }, []);

  const cancelCloseSubmenu = useCallback(() => {
    if (subCloseTimer.current) {
      clearTimeout(subCloseTimer.current);
      subCloseTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (subCloseTimer.current) clearTimeout(subCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    const mountTime = Date.now();
    function handleClick(e: MouseEvent) {
      // Ignore synthesized mouse events from the touch that opened this menu
      if (Date.now() - mountTime < 500) return;
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (subMenuRef.current?.contains(target)) return;
      onClose();
    }
    function handleTouchStart(e: TouchEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (subMenuRef.current?.contains(target)) return;
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleTouchStart);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position so menu doesn't overflow viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  }, [x, y]);

  // Render via Portal to escape parent transform/overflow containers (mobile swipe layout)
  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] max-h-[80vh] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      style={{ left: x, top: y }}
    >
      {items.map((item) => {
        if (item.children && item.children.length > 0) {
          const parentEl = subRefs.current.get(item.label);
          const parentRect = parentEl?.getBoundingClientRect();
          return (
            <div key={item.label}>
              <button
                ref={(el) => { if (el) subRefs.current.set(item.label, el); }}
                onMouseEnter={() => openSubmenu(item.label)}
                onMouseLeave={scheduleCloseSubmenu}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <span className="flex items-center gap-2">
                  {item.icon}
                  {item.label}
                </span>
                <ChevronRight size={12} />
              </button>
              {openSub === item.label && parentRect && (
                <SubMenuPortal
                  items={item.children}
                  parentRect={parentRect}
                  onClose={onClose}
                  onMouseEnter={cancelCloseSubmenu}
                  onMouseLeave={scheduleCloseSubmenu}
                  subMenuRef={subMenuRef}
                />
              )}
            </div>
          );
        }
        return (
          <button
            key={item.label}
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
              item.danger
                ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
