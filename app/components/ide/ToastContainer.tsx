import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n } from "~/i18n/context";

type ToastVariant = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ShowToastDetail {
  message?: string;
  key?: string;
  params?: Record<string, string | number>;
  variant?: ToastVariant;
  /** Milliseconds until auto-dismiss. Omit or pass 0 to require a manual close. */
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 6000;

export function ToastContainer() {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ShowToastDetail>).detail ?? {};
      let message = detail.message ?? "";
      if (!message && detail.key) {
        // Typed translations — cast through unknown to keep the generic event contract.
        let translated = t(detail.key as Parameters<typeof t>[0]);
        if (detail.params) {
          for (const [k, v] of Object.entries(detail.params)) {
            translated = translated.replace(`{${k}}`, String(v));
          }
        }
        message = translated;
      }
      if (!message) return;
      const id = Date.now() + Math.random();
      const variant = detail.variant ?? "info";
      setToasts((prev) => [...prev, { id, message, variant }]);
      const duration = detail.durationMs ?? DEFAULT_DURATION_MS;
      if (duration > 0) {
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, duration);
      }
    };
    window.addEventListener("show-toast", handler);
    return () => window.removeEventListener("show-toast", handler);
  }, [t]);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-md flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${
            toast.variant === "error"
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100"
              : toast.variant === "success"
                ? "border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-950 dark:text-green-100"
                : "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100"
          }`}
        >
          <span className="max-h-[50vh] flex-1 overflow-y-auto whitespace-pre-wrap break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="flex-shrink-0 rounded p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
