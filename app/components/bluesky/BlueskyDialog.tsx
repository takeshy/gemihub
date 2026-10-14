import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Image as ImageIcon, Loader2, Send, Type, X } from "lucide-react";
import {
  blueskyContent,
  blueskyImageCaption,
  blueskyPrefersImage,
  buildBlueskyPosts,
  type BlueskyAdapter,
  type BlueskyConnection,
  type BlueskyEntry,
  type BlueskyImage,
  type BlueskyImageRef,
} from "~/services/bluesky";
import { renderBlueskySnapshot } from "./blueskySnapshot";

type Snapshot = { state: "pending" } | { state: "done"; images: BlueskyImage[] } | { state: "failed" };
type Attachment = { state: "pending" } | { state: "done"; image: BlueskyImage } | { state: "failed"; message: string };

const imageKey = (ref: BlueskyImageRef) => JSON.stringify([ref.candidates, ref.alt]);

/**
 * Pick posts of one conversation and publish them, each as text or as a
 * picture of how it looks in the Timeline. What is shown is what is sent.
 * The account is connected in Settings > Bluesky.
 */
export function BlueskyDialog({ entries, initialId, adapter, connection, renderMarkdown, onClose, language = "en" }: {
  entries: BlueskyEntry[];
  initialId: string;
  adapter: BlueskyAdapter;
  connection: BlueskyConnection | null;
  /** The post as the Timeline renders it, used for picture posts. */
  renderMarkdown: (entry: BlueskyEntry) => ReactNode;
  onClose: () => void;
  language?: string;
}) {
  const ja = language === "ja";
  const dialogRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState(() => new Set(entries.some(entry => entry.id === initialId) ? [initialId] : []));
  const [asImage, setAsImage] = useState(() => new Set(entries.filter(entry => blueskyPrefersImage(entry.content)).map(entry => entry.id)));
  const [snapshots, setSnapshots] = useState(() => new Map<string, Snapshot>());
  const [attachments, setAttachments] = useState(() => new Map<string, Attachment>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urls, setUrls] = useState<string[]>([]);
  // One render and one image read per item for the dialog's lifetime, so a
  // retried publish sends exactly the same pictures (and record keys).
  const renders = useRef(new Map<string, Promise<BlueskyImage[] | null>>());
  const reads = useRef(new Map<string, Promise<BlueskyImage>>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { previous?.focus(); };
  }, []);

  const loadImage = (ref: BlueskyImageRef): Promise<BlueskyImage> => {
    const key = imageKey(ref);
    const existing = reads.current.get(key);
    if (existing) return existing;
    setAttachments(prev => new Map(prev).set(key, { state: "pending" }));
    const read = adapter.image(ref.candidates, ref.alt).then(
      image => { setAttachments(prev => new Map(prev).set(key, { state: "done", image })); return image; },
      caught => {
        setAttachments(prev => new Map(prev).set(key, { state: "failed", message: caught instanceof Error ? caught.message : String(caught) }));
        reads.current.delete(key);
        throw caught;
      },
    );
    reads.current.set(key, read);
    return read;
  };

  /** The entry's pictures, or null when it cannot be drawn and goes out as text. Renders run one at a time. */
  const snapshotFor = (entry: BlueskyEntry): Promise<BlueskyImage[] | null> => {
    const existing = renders.current.get(entry.id);
    if (existing) return existing;
    setSnapshots(prev => new Map(prev).set(entry.id, { state: "pending" }));
    const render = queue.current.then(() => renderBlueskySnapshot(renderMarkdown(entry))).then(
      images => { setSnapshots(prev => new Map(prev).set(entry.id, { state: "done", images })); return images; },
      caught => {
        console.warn("Bluesky image rendering failed", caught);
        setSnapshots(prev => new Map(prev).set(entry.id, { state: "failed" }));
        return null;
      },
    );
    queue.current = render;
    renders.current.set(entry.id, render);
    return render;
  };

  useEffect(() => {
    for (const entry of entries) {
      if (!selected.has(entry.id)) continue;
      if (asImage.has(entry.id)) void snapshotFor(entry);
      if (!asImage.has(entry.id) || snapshots.get(entry.id)?.state === "failed") {
        for (const ref of blueskyContent(entry.content, entry.sourcePath).images.slice(0, 4)) void loadImage(ref).catch(() => {});
      }
    }
    // snapshotFor/loadImage are memoized through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, selected, asImage, snapshots]);

  const toggle = (setter: typeof setSelected, id: string, on: boolean) => setter(prev => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  const rendering = [...selected].some(id => asImage.has(id) && snapshots.get(id)?.state === "pending");
  const connected = !!connection?.connected && !!connection.did;
  const locked = busy || urls.length > 0;

  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      if (!connection?.connected || !connection.did) throw new Error(ja ? "Blueskyが接続されていません" : "Bluesky is not connected");
      const posts = await buildBlueskyPosts(entries, selected, ref => loadImage(ref), { ids: asImage, render: snapshotFor });
      setUrls((await adapter.publish(posts, connection.did)).urls);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const imageClass = "mt-2 block max-h-60 max-w-full rounded-md";

  return createPortal(<div role="presentation" className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bluesky-dialog-title"
      onKeyDown={event => {
        if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]") || []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
      className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white text-gray-900 shadow-xl outline-none dark:bg-gray-900 dark:text-gray-100"
    >
      <header className="flex items-start gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <div className="min-w-0 flex-1">
          <h2 id="bluesky-dialog-title" className="text-base font-semibold">{ja ? "Blueskyへ投稿" : "Post to Bluesky"}</h2>
          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            {connection === null ? "…"
              : connected ? (ja ? `${connection.handle || connection.did} として公開` : `Publishing as ${connection.handle || connection.did}`)
              : (ja ? "未接続" : "Not connected")}
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label={ja ? "閉じる" : "Close"} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-200">
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {connection && !connected && (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {ja ? "Blueskyが接続されていません。設定 → Bluesky で接続してください。" : "Bluesky is not connected. Connect an account in Settings → Bluesky."}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {ja ? "公開する投稿を選び、それぞれテキストか画像（Timelineでの見た目のまま）を選びます。返信はスレッドとして繋がります。" : "Choose the posts to publish, each as text or as an image of how it looks in the Timeline. Replies stay connected as a thread."}
        </p>
        {entries.map(entry => {
          const chosen = selected.has(entry.id);
          const image = chosen && asImage.has(entry.id);
          const snapshot = snapshots.get(entry.id);
          const content = blueskyContent(entry.content, entry.sourcePath);
          const caption = blueskyImageCaption(entry.content, entry.sourcePath);
          const textBody = <>
            {content.text && <div>{content.text}</div>}
            {content.images.map(ref => {
              const attachment = attachments.get(imageKey(ref));
              if (attachment?.state === "done") return <img key={imageKey(ref)} src={`data:${attachment.image.mime};base64,${attachment.image.data}`} alt={ref.alt} className={imageClass} />;
              if (attachment?.state === "failed") return <small key={imageKey(ref)} role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">{attachment.message}</small>;
              return null;
            })}
          </>;
          return <div
            key={entry.id}
            className={`rounded-lg border p-3 transition-colors ${chosen ? "border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20" : "border-gray-200 opacity-60 dark:border-gray-800"} ${entry.replyTo ? "ml-4" : ""}`}
          >
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen} disabled={locked} onChange={event => toggle(setSelected, entry.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-blue-600" />
                <span className="truncate font-medium">{entry.authorName || (entry.speaker === "user" ? (ja ? "あなた" : "You") : entry.speaker)}</span>
              </label>
              {chosen && <span role="group" aria-label={ja ? "投稿形式" : "Post format"} className="flex shrink-0 overflow-hidden rounded-md border border-gray-300 text-xs dark:border-gray-700">
                {([false, true] as const).map(value => {
                  const active = asImage.has(entry.id) === value;
                  return <button
                    key={String(value)}
                    type="button"
                    aria-pressed={active}
                    disabled={locked}
                    title={value ? (ja ? "Timelineでの見た目のまま画像で投稿します。リンクは本文に残ります" : "Publish the post as it looks in the Timeline; links stay in the text") : undefined}
                    onClick={() => toggle(setAsImage, entry.id, value)}
                    className={`flex items-center gap-1 px-2 py-1 disabled:opacity-50 ${active ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"}`}
                  >
                    {value ? <ImageIcon size={12} /> : <Type size={12} />} {value ? (ja ? "画像" : "Image") : (ja ? "テキスト" : "Text")}
                  </button>;
                })}
              </span>}
            </div>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300">
              {!image ? textBody
                : !snapshot || snapshot.state === "pending"
                ? <span className="flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> {ja ? "画像にしています…" : "Drawing as an image…"}</span>
                : snapshot.state === "failed"
                ? <><small role="alert" className="mb-1 block text-xs text-amber-700 dark:text-amber-300">{ja ? "画像にできなかったため、テキストで投稿します。" : "Could not draw this post as an image, so it will be published as text."}</small>{textBody}</>
                : <>
                  {caption && <div>{caption}</div>}
                  {snapshot.images.map((page, index) => <img key={index} src={`data:${page.mime};base64,${page.data}`} alt={page.alt} className="mt-2 block max-w-full rounded-md border border-gray-200 dark:border-gray-700" />)}
                </>}
            </div>
          </div>;
        })}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {urls.length > 0 && <p role="status" className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
          {ja ? "投稿しました" : "Published"}
          <a href={urls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">{ja ? "Blueskyで開く" : "Open in Bluesky"} <ExternalLink size={12} /></a>
        </p>}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-800">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800">
          {ja ? "閉じる" : "Close"}
        </button>
        {urls.length === 0 && <button type="button" disabled={busy || rendering || !connected || selected.size === 0} onClick={() => void publish()} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {busy || rendering ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy ? (ja ? "公開中…" : "Publishing…") : (ja ? `選択した${selected.size}件を公開` : `Publish ${selected.size} selected`)}
        </button>}
      </footer>
    </section>
  </div>, document.body);
}
