import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { KanbanAttachment, KanbanChecklistItem } from "./kanban-task";

export interface KanbanTaskInput {
  title: string;
  status: string;
  due: string;
  description: string;
  checklist: KanbanChecklistItem[];
  attachments: KanbanAttachment[];
  files: File[];
}

export function KanbanTaskModal({ mode, columns, initial, onSubmit, onClose }: {
  mode: "new" | "edit";
  columns: Array<{ value: string; label?: string }>;
  initial?: Partial<KanbanTaskInput>;
  onSubmit: (input: KanbanTaskInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState(initial?.status ?? columns[0]?.value ?? "");
  const [due, setDue] = useState(initial?.due ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [checklist, setChecklist] = useState(() => (initial?.checklist ?? []).map((item) => ({ ...item })));
  const [attachments, setAttachments] = useState(() => (initial?.attachments ?? []).map((item) => ({ ...item })));
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <form
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || saving) return;
          setSaving(true);
          setError("");
          void Promise.resolve(onSubmit({
            title: title.trim(), status, due, description,
            checklist: checklist.filter((item) => item.text.trim()),
            attachments, files,
          })).then(onClose).catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : String(caught));
            setSaving(false);
          });
        }}
      >
        <header className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <strong className="flex-1 text-sm">{mode === "new" ? t("dashboard.kanbanTaskNew") : t("dashboard.kanbanTaskEdit")}</strong>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={16} /></button>
        </header>
        <div className="grid min-h-0 gap-4 overflow-auto p-4 text-xs">
          <label className="grid gap-1.5">{t("dashboard.kanbanNewCardNameLabel")}<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border border-gray-300 bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">{t("dashboard.kanbanTaskStatus")}<select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-gray-300 bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800">{columns.map((column) => <option key={column.value} value={column.value}>{column.label || column.value}</option>)}</select></label>
            <label className="grid gap-1.5">{t("dashboard.kanbanTaskDue")}<input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded border border-gray-300 bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800" /></label>
          </div>
          <label className="grid gap-1.5">{t("dashboard.kanbanTaskDescription")}<textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} className="resize-y rounded border border-gray-300 bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800" /></label>
          <section className="grid gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
            <header className="flex items-center"><strong className="flex-1">{t("dashboard.kanbanTaskChecklist")}</strong><button type="button" onClick={() => setChecklist((current) => [...current, { text: "", completed: false }])} className="inline-flex items-center gap-1 rounded border px-2 py-1"><Plus size={13} />{t("dashboard.kanbanTaskChecklistAdd")}</button></header>
            {checklist.map((item, index) => <div key={index} className="flex items-center gap-2"><input type="checkbox" checked={item.completed} onChange={(e) => setChecklist((current) => current.map((entry, i) => i === index ? { ...entry, completed: e.target.checked } : entry))} /><input value={item.text} onChange={(e) => setChecklist((current) => current.map((entry, i) => i === index ? { ...entry, text: e.target.value } : entry))} placeholder={t("dashboard.kanbanTaskChecklistItem")} className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800" /><button type="button" onClick={() => setChecklist((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>)}
          </section>
          <section className="grid gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
            <header className="flex items-center"><strong className="flex-1">{t("dashboard.kanbanTaskAttachments")}</strong><button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 rounded border px-2 py-1"><Paperclip size={13} />{t("dashboard.kanbanTaskAttachmentAdd")}</button><input ref={fileInput} hidden type="file" multiple onChange={(e) => { setFiles((current) => [...current, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} /></header>
            {attachments.map((item, index) => <div key={item.path} className="flex items-center gap-2"><Paperclip size={14} /><span className="min-w-0 flex-1 truncate">{item.label}</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>)}
            {files.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center gap-2"><Paperclip size={14} /><span className="min-w-0 flex-1 truncate">{item.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>)}
          </section>
          {error && <p className="text-red-500">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700"><button type="button" onClick={onClose} className="rounded border px-3 py-1.5">{t("common.cancel")}</button><button type="submit" disabled={!title.trim() || saving} className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">{saving ? `${t("common.save")}…` : mode === "new" ? t("dashboard.kanbanNewCardCreate") : t("common.save")}</button></footer>
      </form>
    </div>,
    document.body,
  );
}
