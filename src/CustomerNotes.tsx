import React, { useEffect, useRef, useState } from "react";
import { customerFileLimit, customerTotalFileLimit, previewCustomerImage, type CustomerAttachment, type CustomerDetail, type CustomerNote } from "../server/customers";
import { CustomerImageDialog } from "./CustomerImages";
import { useApi } from "./api";
import { createRequestId } from "./request-id";

const when = (value: string) => new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
const fileData = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.onerror = () => reject(new Error(`${file.name} を読み込めませんでした`));
  reader.readAsDataURL(file);
});

export function CustomerNoteComposer({ base, rangeQuery, saved }: { base: string; rangeQuery: string; saved: (customer: CustomerDetail) => void }) {
  const api = useApi();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ file: File; name: string }[]>([]);
  const [requestId, setRequestId] = useState(createRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  function choose(selected: File[]) {
    const next = [...files, ...selected.map(file => ({ file, name: file.name }))];
    setError(""); setNotice("");
    if (next.length > 5 || next.some(item => item.file.size > customerFileLimit) || next.reduce((sum, item) => sum + item.file.size, 0) > customerTotalFileLimit) {
      setError("添付は5ファイルまで、1ファイル5MB・合計10MB以内にしてください。");
    } else { setFiles(next); setRequestId(createRequestId()); }
    if (inputRef.current) inputRef.current.value = "";
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const attachments = await Promise.all(files.map(async item => ({ name: item.name.trim(), mimeType: item.file.type || "application/octet-stream", data: await fileData(item.file) })));
      saved(await api<CustomerDetail>(`${base}/notes${rangeQuery}`, { requestId, text, files: attachments }));
      setText(""); setFiles([]); setRequestId(createRequestId()); setNotice("メモを投稿しました。");
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <form className="customer-note-composer" onSubmit={submit}>
    <h3>メモを追加</h3>
    <p className="small muted">店主と参加済みの運営メンバーで共有します。</p>
    {error && <div className="alert" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <label htmlFor="customer-note">お客様メモ</label>
    <textarea id="customer-note" rows={4} maxLength={10000} value={text} disabled={busy} onChange={event => { setText(event.target.value); setRequestId(createRequestId()); setNotice(""); }} placeholder="接客の記録や次回への申し送りなど" />
    <label htmlFor="customer-note-files">画像・ファイルを添付</label>
    <input id="customer-note-files" ref={inputRef} type="file" multiple disabled={busy} onChange={event => choose(Array.from(event.target.files || []))} />
    <p className="small muted">5ファイルまで。1ファイル5MB・合計10MB以内。</p>
    {files.length > 0 && <ul className="customer-pending-files">{files.map((item, index) => <li key={index}><label>ファイル名（{index + 1}）<input required maxLength={255} value={item.name} disabled={busy} onChange={event => { setFiles(files.map((current, i) => i === index ? { ...current, name: event.target.value } : current)); setRequestId(createRequestId()); }} /></label><small className="muted">元のファイル名：{item.file.name}</small><button type="button" disabled={busy} aria-label={`${item.name} の添付を取り消す`} onClick={() => { setFiles(files.filter((_, i) => i !== index)); setRequestId(createRequestId()); }}>取り消す</button></li>)}</ul>}
    <button className="primary" type="submit" disabled={busy || (!text.trim() && !files.length) || files.some(item => !item.name.trim())}>{busy ? "投稿しています…" : "メモを投稿"}</button>
  </form>;
}

export function CustomerNoteCard({ note, base, rangeQuery, saved, showAttachments = true }: { note: CustomerNote; showAttachments?: boolean; base: string; rangeQuery: string; saved: (customer: CustomerDetail) => void }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [text, setText] = useState(note.text);
  const [names, setNames] = useState(() => note.attachments.map(file => ({ id: file.id, name: file.name })));
  const [editVersion, setEditVersion] = useState(note.updatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function update(remove = false) {
    setBusy(true); setError("");
    try {
      saved(await api<CustomerDetail>(`${base}/notes/${note.id}${remove ? "/delete" : ""}${rangeQuery}`, { text, ...(remove ? {} : { attachmentNames: names }), previousUpdatedAt: remove ? note.updatedAt : editVersion }));
      setEditing(false); setDeleting(false);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="customer-note-card">
    <h3>お店のメモ</h3><p className="small muted">投稿：{note.createdBy}{note.updatedAt !== note.createdAt && ` · 編集：${when(note.updatedAt)} (${note.updatedBy})`}</p>
    {error && <div className="alert" role="alert">{error}</div>}
    {editing ? <form onSubmit={event => { event.preventDefault(); void update(); }}>
      <label>メモ本文<textarea value={text} maxLength={10000} disabled={busy} onChange={event => setText(event.target.value)} /></label>
      {names.map((file, index) => <label key={file.id}>ファイル名（{index + 1}）<input required maxLength={255} value={file.name} disabled={busy} onChange={event => setNames(names.map((current, i) => i === index ? { ...current, name: event.target.value } : current))} /></label>)}
      <div className="actions"><button type="submit" disabled={busy || (!text.trim() && !note.attachments.length) || names.some(file => !file.name.trim())}>変更を保存</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setText(note.text); }}>編集をやめる</button></div>
    </form> : <p className="customer-message">{note.text}</p>}
    <div className="customer-attachments">{showAttachments && note.attachments.map(file => <CustomerFile key={file.id} file={file} path={`${base}/notes/${note.id}/files/${file.id}`} />)}</div>
    {!editing && !deleting && <div className="actions"><button type="button" onClick={() => { setText(note.text); setNames(note.attachments.map(file => ({ id: file.id, name: file.name }))); setEditVersion(note.updatedAt); setEditing(true); }}>メモを編集</button><button type="button" onClick={() => setDeleting(true)}>メモを削除</button></div>}
    {deleting && <div className="notice">このメモを削除しますか？<div className="actions"><button type="button" disabled={busy} onClick={() => void update(true)}>削除する</button><button type="button" disabled={busy} onClick={() => setDeleting(false)}>削除をやめる</button></div></div>}
  </div>;
}

function CustomerFile({ file, path }: { file: CustomerAttachment; path: string }) {
  const api = useApi();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const blobUrl = useRef("");
  const [zoom, setZoom] = useState(false);
  const isImage = previewCustomerImage(file.mimeType);
  async function load() {
    const response = await api<{ data: string }>(path);
    const data = Uint8Array.from(atob(response.data), char => char.charCodeAt(0));
    return URL.createObjectURL(new Blob([data], { type: isImage ? file.mimeType : "application/octet-stream" }));
  }
  useEffect(() => {
    let active = true;
    if (isImage) load().then(result => { if (active) { blobUrl.current = result; setUrl(result); } else URL.revokeObjectURL(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; if (blobUrl.current) URL.revokeObjectURL(blobUrl.current); };
  }, [path]);
  async function download() {
    setBusy(true); setError("");
    try {
      const result = url || await load();
      const anchor = document.createElement("a");
      anchor.href = result; anchor.download = file.name; anchor.click();
      if (!url) setTimeout(() => URL.revokeObjectURL(result), 10000);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="customer-file">
    {url && isImage && <button type="button" className="customer-image-open" onClick={() => setZoom(true)} aria-label={`${file.name} を拡大表示`}><img src={url} alt={file.name} loading="lazy" /></button>}
    <button type="button" disabled={busy} onClick={() => void download()}>{file.name} をダウンロード</button><small className="muted">{Math.ceil(file.size / 1024)} KB</small>
    {error && <p role="alert">{error}</p>}
    {zoom && <CustomerImageDialog items={[{ file, path }]} initialIndex={0} close={() => setZoom(false)} />}
  </div>;
}
