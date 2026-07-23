import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { parseMemoFile } from "~/dashboard/memo/memoTimeline";
import { useI18n } from "~/i18n/context";
import { readFileLocal } from "~/services/drive-local";
import { getCachedRemoteMeta } from "~/services/indexeddb-cache";
import { appendSystemTimeline, deleteSystemTimelineEntry, localDateKey, SYSTEM_TIMELINE_ROOT, updateSystemTimelineEntry } from "~/services/system-timeline";

const EVENT_RE = /<!--\s*calendar-event:\s*(\d{4}-\d{2}-\d{2})\s*-->/i;

interface CalendarItem {
  id: string;
  date: string;
  time: string;
  content: string;
  isEvent: boolean;
  createdAt: string;
}

function eventBody(date: string, time: string, content: string): string {
  const label = `${date}${time ? ` ${time}` : ""}`;
  return `<!-- calendar-event: ${date} -->\n> [!calendar] Calendar event · ${label}\n> ${content.trim().replace(/\n/g, "\n> ")}`;
}

function parseItem(id: string, createdAt: string, body: string): CalendarItem {
  const marker = body.match(EVENT_RE);
  const heading = body.match(/^> \[!calendar\].*?·\s*\d{4}-\d{2}-\d{2}(?:\s+(\d{2}:\d{2}))?[^\n]*$/m);
  const content = heading?.index == null
    ? body
    : body.slice(heading.index + heading[0].length).replace(/^\r?\n/, "").split(/\r?\n/)
      .map((line) => line.replace(/^> ?/, "")).join("\n").trim();
  return {
    id,
    date: marker?.[1] ?? localDateKey(new Date(createdAt)),
    time: heading?.[1] ?? "",
    content,
    isEvent: Boolean(marker),
    createdAt,
  };
}

export default function CalendarWidget() {
  const { language } = useI18n();
  const ja = language === "ja";
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(localDateKey());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [time, setTime] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const meta = await getCachedRemoteMeta();
      const matches = Object.entries(meta?.files ?? {}).filter(([, file]) =>
        file.name.startsWith(`${SYSTEM_TIMELINE_ROOT}/`) && /\d{4}-\d{2}-\d{2}\.md$/i.test(file.name)
      );
      const loaded = await Promise.all(matches.map(async ([id]) => parseMemoFile(await readFileLocal(id)).entries));
      setItems(loaded.flat().map((entry) => parseItem(entry.id, entry.createdAt, entry.body || entry.quote)));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("file-modified", refresh);
    window.addEventListener("files-pulled", refresh);
    window.addEventListener("dashboard-data-changed", refresh);
    return () => {
      window.removeEventListener("file-modified", refresh);
      window.removeEventListener("files-pulled", refresh);
      window.removeEventListener("dashboard-data-changed", refresh);
    };
  }, [load]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);
  const counts = useMemo(() => {
    const map = new Map<string, { events: number; activity: number }>();
    for (const item of items) {
      const value = map.get(item.date) ?? { events: 0, activity: 0 };
      if (item.isEvent) value.events += 1;
      else value.activity += 1;
      map.set(item.date, value);
    }
    return map;
  }, [items]);
  const selectedItems = items.filter((item) => item.date === selected)
    .sort((a, b) => `${a.time || "99:99"}${a.createdAt}`.localeCompare(`${b.time || "99:99"}${b.createdAt}`));
  const locale = ja ? "ja-JP" : "en-US";

  const save = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const body = eventBody(selected, time, content);
      if (editingId) await updateSystemTimelineEntry(selected, editingId, body);
      else await appendSystemTimeline(body, new Date(`${selected}T12:00:00`));
      setContent("");
      setTime("");
      setEditingId(null);
      setShowForm(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const edit = (item: CalendarItem) => {
    setEditingId(item.id);
    setTime(item.time);
    setContent(item.content);
    setShowForm(true);
  };

  const remove = async (item: CalendarItem) => {
    if (!window.confirm(ja ? `「${item.content}」を削除しますか？` : `Delete “${item.content}”?`)) return;
    setSaving(true);
    try {
      await deleteSystemTimelineEntry(selected, item.id);
      if (editingId === item.id) {
        setEditingId(null);
        setShowForm(false);
        setContent("");
        setTime("");
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-gray-800 dark:text-gray-100">
      <div className="flex items-center justify-between">
        <button className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
        <div className="flex items-center gap-2 font-semibold"><CalendarDays size={18} />{new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(month)}</div>
        <button className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-gray-200 bg-gray-200 text-center text-xs dark:border-gray-700 dark:bg-gray-700">
        {Array.from({ length: 7 }, (_, i) => <div key={i} className="bg-gray-50 py-1 font-medium dark:bg-gray-900">{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 7 + i))}</div>)}
        {days.map((day) => {
          const key = localDateKey(day), count = counts.get(key);
          const outside = day.getMonth() !== month.getMonth();
          return <button key={key} onClick={() => setSelected(key)} className={`min-h-12 bg-white p-1 text-left hover:bg-blue-50 dark:bg-gray-900 dark:hover:bg-gray-800 ${selected === key ? "ring-2 ring-inset ring-blue-500" : ""} ${outside ? "text-gray-300 dark:text-gray-600" : ""}`}>
            <span>{day.getDate()}</span>
            <span className="mt-1 flex gap-1">{count?.events ? <span className="h-1.5 w-1.5 rounded-full bg-blue-500" title={`${count.events} events`} /> : null}{count?.activity ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title={`${count.activity} activities`} /> : null}</span>
          </button>;
        })}
      </div>
      <div className="flex items-center justify-between border-b border-gray-200 pb-2 dark:border-gray-700">
        <strong className="text-sm">{new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date(`${selected}T12:00:00`))}</strong>
        <button onClick={() => { setEditingId(null); setContent(""); setTime(""); setShowForm((value) => !value); }} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"><Plus size={14} />{ja ? "予定を追加" : "Add event"}</button>
      </div>
      {showForm && <div className="flex gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="rounded border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-600" />
        <input value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void save(); }} autoFocus placeholder={ja ? "予定の内容" : "Event details"} className="min-w-0 flex-1 rounded border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-600" />
        <button disabled={saving || !content.trim()} onClick={() => void save()} className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40">{editingId ? (ja ? "更新" : "Update") : (ja ? "保存" : "Save")}</button>
      </div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="space-y-1">
        {selectedItems.length === 0 && <div className="py-4 text-center text-sm text-gray-400">{ja ? "予定・活動はありません" : "No events or activity"}</div>}
        {selectedItems.map((item) => <div key={`${item.id}-${item.createdAt}`} className={`group rounded border-l-4 p-2 text-sm ${item.isEvent ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"}`}>
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase text-gray-500"><span>{item.isEvent ? `${item.time || (ja ? "終日" : "all day")} · ${ja ? "予定" : "event"}` : `${new Date(item.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} · ${ja ? "活動" : "activity"}`}</span>{item.isEvent && <span className="flex gap-1 opacity-70 group-hover:opacity-100"><button onClick={() => edit(item)} className="rounded p-1 hover:bg-blue-100 dark:hover:bg-blue-900" title={ja ? "編集" : "Edit"}><Pencil size={12} /></button><button onClick={() => void remove(item)} className="rounded p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-950" title={ja ? "削除" : "Delete"}><Trash2 size={12} /></button></span>}</div>
          <div className="whitespace-pre-wrap">{item.content}</div>
        </div>)}
      </div>
    </div>
  );
}
