import { useEffect, useId, useState } from "react";
import { tr } from "../shared/i18n";
import "./Pagination.css";

export function usePagination<T>(items: readonly T[], resetKey: string, pageSize = 10) {
  const id = useId();
  const [selection, setSelection] = useState({ key: resetKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = selection.key === resetKey ? Math.min(selection.page, pageCount - 1) : 0;
  useEffect(() => {
    setSelection(current => {
      const next = current.key === resetKey ? Math.min(current.page, pageCount - 1) : 0;
      return current.key === resetKey && current.page === next ? current : { key: resetKey, page: next };
    });
  }, [resetKey, pageCount]);
  const goTo = (next: number, focus = true) => {
    setSelection({ key: resetKey, page: Math.max(0, Math.min(next, pageCount - 1)) });
    if (focus) requestAnimationFrame(() => {
      const list = document.getElementById(id);
      list?.focus({ preventScroll: true });
      list?.scrollIntoView({ block: "start" });
    });
  };
  return { items: items.slice(page * pageSize, (page + 1) * pageSize), page, pageCount, pageSize, total: items.length, goTo, listProps: { id, tabIndex: -1 } };
}

type PaginationState = Pick<ReturnType<typeof usePagination>, "page" | "pageCount" | "pageSize" | "total" | "goTo" | "listProps">;
export function Pagination({ pagination, label, disabled = false }: { pagination: PaginationState; label: string; disabled?: boolean }) {
  const { page, pageCount, pageSize, total, goTo, listProps } = pagination;
  if (total <= pageSize) return null;
  return <nav className="pagination" aria-label={tr("{0}のページ切替", label)}>
    <p className="small muted" role="status">{tr("全{0}件中 {1}〜{2}件", total, page * pageSize + 1, Math.min((page + 1) * pageSize, total))}</p>
    <div className="pagination-buttons">
      <button type="button" aria-controls={listProps.id} disabled={disabled || page === 0} onClick={() => goTo(page - 1)}>{tr("前のページ")}</button>
      <span>{tr("{0} / {1}ページ", page + 1, pageCount)}</span>
      <button type="button" aria-controls={listProps.id} disabled={disabled || page === pageCount - 1} onClick={() => goTo(page + 1)}>{tr("次のページ")}</button>
    </div>
  </nav>;
}
