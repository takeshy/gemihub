import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { parseMemoFile } from "~/dashboard/memo/memoTimeline";
import { useI18n } from "~/i18n/context";
import { readFileLocal } from "~/services/drive-local";
import {
  getCachedRemoteMeta,
  getGoogleCalendarMonthCache,
  setGoogleCalendarMonthCache,
} from "~/services/indexeddb-cache";
import {
  appendSystemTimeline,
  deleteSystemTimelineEntry,
  localDateKey,
  moveSystemTimelineEntry,
  SYSTEM_TIMELINE_ROOT,
  updateSystemTimelineEntry,
} from "~/services/system-timeline";

const EVENT_RE = /<!--\s*calendar-event:\s*(\d{4}-\d{2}-\d{2})\s*-->/i;

interface CalendarItem {
  id: string;
  date: string;
  time: string;
  content: string;
  isEvent: boolean;
  createdAt: string;
  source: "local" | "google";
  htmlLink?: string;
}

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  location?: string;
  htmlLink?: string;
}

function eventBody(date: string, time: string, content: string): string {
  const label = `${date}${time ? ` ${time}` : ""}`;
  return `<!-- calendar-event: ${date} -->\n> [!calendar] Calendar event · ${label}\n> ${content.trim().replace(/\n/g, "\n> ")}`;
}

function parseItem(id: string, createdAt: string, body: string): CalendarItem {
  const marker = body.match(EVENT_RE);
  const heading = body.match(
    /^> \[!calendar\].*?·\s*\d{4}-\d{2}-\d{2}(?:\s+(\d{2}:\d{2}))?[^\n]*$/m,
  );
  const content =
    heading?.index == null
      ? body
      : body
          .slice(heading.index + heading[0].length)
          .replace(/^\r?\n/, "")
          .split(/\r?\n/)
          .map((line) => line.replace(/^> ?/, ""))
          .join("\n")
          .trim();
  return {
    id,
    date: marker?.[1] ?? localDateKey(new Date(createdAt)),
    time: heading?.[1] ?? "",
    content,
    isEvent: Boolean(marker),
    createdAt,
    source: "local",
  };
}

export default function CalendarWidget() {
  const { language } = useI18n();
  const ja = language === "ja";
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState(localDateKey());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [googleItems, setGoogleItems] = useState<CalendarItem[]>([]);
  const [googleMonthKey, setGoogleMonthKey] = useState("");
  const [googleFetchedAt, setGoogleFetchedAt] = useState<number | null>(null);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [time, setTime] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState("");
  const [editDate, setEditDate] = useState("");
  const [error, setError] = useState("");
  const [showDayModal, setShowDayModal] = useState(false);
  const currentMonthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthKeyRef = useRef(currentMonthKey);
  currentMonthKeyRef.current = currentMonthKey;

  const googleEventsToItems = useCallback(
    (events: GoogleCalendarEvent[]): CalendarItem[] =>
      events.flatMap((event, index): CalendarItem[] => {
        if (!event.start) return [];
        const allDay = /^\d{4}-\d{2}-\d{2}$/.test(event.start);
        const start = allDay
          ? new Date(`${event.start}T12:00:00`)
          : new Date(event.start);
        if (Number.isNaN(start.getTime())) return [];
        const details = [
          event.summary || (ja ? "無題の予定" : "Untitled event"),
        ];
        if (event.location) details.push(event.location);
        if (event.description) details.push(event.description);
        return [
          {
            id: `google:${event.id || index}`,
            date: allDay ? event.start! : localDateKey(start),
            time: allDay
              ? ""
              : `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
            content: details.join("\n"),
            isEvent: true,
            createdAt: event.start,
            source: "google",
            htmlLink: event.htmlLink,
          },
        ];
      }),
    [ja],
  );

  const load = useCallback(async () => {
    try {
      const meta = await getCachedRemoteMeta();
      const matches = Object.entries(meta?.files ?? {}).filter(
        ([, file]) =>
          file.name.startsWith(`${SYSTEM_TIMELINE_ROOT}/`) &&
          /\d{4}-\d{2}-\d{2}\.md$/i.test(file.name),
      );
      const loaded = await Promise.all(
        matches.map(
          async ([id]) => parseMemoFile(await readFileLocal(id)).entries,
        ),
      );
      setItems(
        loaded
          .flat()
          .map((entry) =>
            parseItem(entry.id, entry.createdAt, entry.body || entry.quote),
          ),
      );
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await getGoogleCalendarMonthCache(currentMonthKey);
      if (cancelled) return;
      if (cached) {
        setGoogleItems(googleEventsToItems(cached.events));
        setGoogleMonthKey(currentMonthKey);
        setGoogleFetchedAt(cached.fetchedAt);
      } else {
        setGoogleItems([]);
        setGoogleMonthKey("");
        setGoogleFetchedAt(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMonthKey, googleEventsToItems]);
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
  const visibleItems = useMemo(
    () => [
      ...items,
      ...(googleMonthKey === currentMonthKey ? googleItems : []),
    ],
    [items, googleItems, googleMonthKey, currentMonthKey],
  );
  const counts = useMemo(() => {
    const map = new Map<string, { events: number; activity: number }>();
    for (const item of visibleItems) {
      const value = map.get(item.date) ?? { events: 0, activity: 0 };
      if (item.isEvent) value.events += 1;
      else value.activity += 1;
      map.set(item.date, value);
    }
    return map;
  }, [visibleItems]);
  const selectedItems = visibleItems
    .filter((item) => item.date === selected)
    .sort((a, b) =>
      `${a.time || "99:99"}${a.createdAt}`.localeCompare(
        `${b.time || "99:99"}${b.createdAt}`,
      ),
    );
  const locale = ja ? "ja-JP" : "en-US";

  const reflectGoogleCalendar = async () => {
    if (syncingGoogle) return;
    setSyncingGoogle(true);
    setError("");
    try {
      const first = new Date(month.getFullYear(), month.getMonth(), 1);
      const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          calendarId: "primary",
          timeMin: first.toISOString(),
          timeMax: next.toISOString(),
          maxResults: 250,
        }),
      });
      const payload = (await response.json()) as {
        events?: GoogleCalendarEvent[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.error ||
            (ja
              ? "Google Calendarの取得に失敗しました"
              : "Failed to load Google Calendar"),
        );
      const events = payload.events ?? [];
      const fetchedAt = Date.now();
      const fetchedMonthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      await setGoogleCalendarMonthCache({
        monthKey: fetchedMonthKey,
        fetchedAt,
        events,
      });
      if (currentMonthKeyRef.current === fetchedMonthKey) {
        setGoogleItems(googleEventsToItems(events));
        setGoogleMonthKey(fetchedMonthKey);
        setGoogleFetchedAt(fetchedAt);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSyncingGoogle(false);
    }
  };

  const save = async () => {
    if (!content.trim() || saving || (editingId && !editDate)) return;
    setSaving(true);
    try {
      const savedDate = editingId ? editDate : selected;
      const body = eventBody(selected, time, content);
      if (editingId) {
        const nextBody = eventBody(editDate, time, content);
        if (editDate === editingDate)
          await updateSystemTimelineEntry(editingDate, editingId, nextBody);
        else
          await moveSystemTimelineEntry(
            editingDate,
            editDate,
            editingId,
            nextBody,
          );
      } else {
        await appendSystemTimeline(body, new Date(`${selected}T12:00:00`));
      }
      setContent("");
      setTime("");
      setEditingId(null);
      setEditingDate("");
      setShowForm(false);
      if (savedDate !== selected) {
        setSelected(savedDate);
        const nextMonth = new Date(`${savedDate}T12:00:00`);
        setMonth(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1));
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const edit = (item: CalendarItem) => {
    setEditingId(item.id);
    setEditingDate(item.date);
    setEditDate(item.date);
    setTime(item.time);
    setContent(item.content);
    setShowForm(true);
  };

  const remove = async (item: CalendarItem) => {
    if (
      !window.confirm(
        ja
          ? `「${item.content}」を削除しますか？`
          : `Delete “${item.content}”?`,
      )
    )
      return;
    setSaving(true);
    try {
      await deleteSystemTimelineEntry(item.date, item.id);
      if (editingId === item.id) {
        setEditingId(null);
        setEditingDate("");
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

  const closeDayModal = () => {
    setShowDayModal(false);
    setShowForm(false);
    setEditingId(null);
    setEditingDate("");
    setContent("");
    setTime("");
  };

  useEffect(() => {
    if (!showDayModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDayModal();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [showDayModal]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-gray-800 dark:text-gray-100">
      <div className="flex items-center justify-between gap-2">
        <button
          className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex min-w-0 items-center gap-2 font-semibold">
          <CalendarDays size={18} className="shrink-0" />
          <span className="truncate">
            {new Intl.DateTimeFormat(locale, {
              year: "numeric",
              month: "long",
            }).format(month)}
          </span>
          <button
            type="button"
            disabled={syncingGoogle}
            onClick={() => void reflectGoogleCalendar()}
            className="flex shrink-0 items-center gap-1 rounded border border-blue-300 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950"
            title={
              ja
                ? "開いている月のGoogle Calendar予定を反映"
                : "Reflect Google Calendar events for the visible month"
            }
          >
            <RefreshCw
              size={12}
              className={syncingGoogle ? "animate-spin" : ""}
            />
            {ja ? "Google予定" : "Google events"}
          </button>
        </div>
        <button
          className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight size={18} />
        </button>
      </div>
      {googleFetchedAt && googleMonthKey === currentMonthKey ? (
        <div className="-mt-2 text-center text-[10px] text-gray-400">
          {ja ? "Google予定の最終更新" : "Google events updated"}:{" "}
          {new Date(googleFetchedAt).toLocaleString(locale, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-gray-200 bg-gray-200 text-center text-xs dark:border-gray-700 dark:bg-gray-700">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="bg-gray-50 py-1 font-medium dark:bg-gray-900">
            {new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
              new Date(2024, 0, 7 + i),
            )}
          </div>
        ))}
        {days.map((day) => {
          const key = localDateKey(day),
            count = counts.get(key);
          const outside = day.getMonth() !== month.getMonth();
          return (
            <button
              key={key}
              onClick={() => {
                setSelected(key);
                setShowDayModal(true);
              }}
              className={`min-h-12 bg-white p-1 text-left hover:bg-blue-50 dark:bg-gray-900 dark:hover:bg-gray-800 ${selected === key ? "ring-2 ring-inset ring-blue-500" : ""} ${outside ? "text-gray-300 dark:text-gray-600" : ""}`}
            >
              <span>{day.getDate()}</span>
              <span className="mt-1 flex gap-1">
                {count?.events ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-blue-500"
                    title={`${count.events} events`}
                  />
                ) : null}
                {count?.activity ? (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                    title={`${count.activity} activities`}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
      {typeof document !== "undefined" &&
        showDayModal &&
        createPortal(
          <div
            data-calendar-day-modal="true"
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDayModal();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={new Intl.DateTimeFormat(locale, {
                dateStyle: "full",
              }).format(new Date(`${selected}T12:00:00`))}
              className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white text-gray-800 shadow-2xl dark:bg-gray-900 dark:text-gray-100"
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <strong className="text-sm">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "full",
                  }).format(new Date(`${selected}T12:00:00`))}
                </strong>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditingDate("");
                      setEditDate(selected);
                      setContent("");
                      setTime("");
                      setShowForm((value) => !value);
                    }}
                    className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                  >
                    <Plus size={14} />
                    {ja ? "予定を追加" : "Add event"}
                  </button>
                  <button
                    type="button"
                    onClick={closeDayModal}
                    className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
                    aria-label={ja ? "閉じる" : "Close"}
                  >
                    <X size={18} />
                  </button>
                </span>
              </div>
              <div className="min-h-0 overflow-y-auto p-4">
                {showForm && (
                  <div className="mb-3 flex flex-wrap gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
                    {editingId && (
                      <input
                        type="date"
                        required
                        value={editDate}
                        onChange={(event) => setEditDate(event.target.value)}
                        aria-label={ja ? "日付" : "Date"}
                        className="rounded border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-600"
                      />
                    )}
                    <input
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                      className="rounded border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-600"
                    />
                    <input
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void save();
                      }}
                      autoFocus
                      placeholder={ja ? "予定の内容" : "Event details"}
                      className="min-w-0 flex-1 rounded border border-gray-300 bg-transparent px-2 text-sm dark:border-gray-600"
                    />
                    <button
                      disabled={
                        saving ||
                        !content.trim() ||
                        Boolean(editingId && !editDate)
                      }
                      onClick={() => void save()}
                      className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-40"
                    >
                      {editingId
                        ? ja
                          ? "更新"
                          : "Update"
                        : ja
                          ? "保存"
                          : "Save"}
                    </button>
                  </div>
                )}
                <div className="space-y-2">
                  {selectedItems.map((item) => (
                    <div
                      key={`${item.id}-${item.createdAt}`}
                      className={`group rounded border-l-4 p-2 text-sm ${item.source === "google" ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30" : item.isEvent ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"}`}
                    >
                      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase text-gray-500">
                        <span>
                          {item.source === "google"
                            ? `${item.time || (ja ? "終日" : "all day")} · Google Calendar`
                            : item.isEvent
                              ? `${item.time || (ja ? "終日" : "all day")} · ${ja ? "予定" : "event"}`
                              : `${new Date(item.createdAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} · ${ja ? "活動" : "activity"}`}
                        </span>
                        {item.isEvent && item.source === "local" && (
                          <span className="flex gap-1 opacity-70 group-hover:opacity-100">
                            <button
                              onClick={() => edit(item)}
                              className="rounded p-1 hover:bg-blue-100 dark:hover:bg-blue-900"
                              title={ja ? "編集" : "Edit"}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => void remove(item)}
                              className="rounded p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-950"
                              title={ja ? "削除" : "Delete"}
                            >
                              <Trash2 size={12} />
                            </button>
                          </span>
                        )}
                      </div>
                      {item.htmlLink ? (
                        <a
                          href={item.htmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="whitespace-pre-wrap hover:underline"
                        >
                          {item.content}
                        </a>
                      ) : (
                        <div className="whitespace-pre-wrap">
                          {item.content}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
