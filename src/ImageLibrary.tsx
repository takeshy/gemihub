import React, { useEffect, useState } from "react";
import { useApi } from "./api";
import { MenuImage } from "./MenuImage";
import { DictationButton } from "./DictationButton";
import { CustomerImageDialog } from "./CustomerImages";
import { createRequestId } from "./request-id";
import { generateImageSchema, type GenerateImageInput, type LibraryImage } from "../server/image-library-domain";
import { RequestImagePicker } from "./RequestImagePicker";

const toData = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("画像を読み込めませんでした")); reader.readAsDataURL(file); });
export function ImageLibrary({ shopId, onSelect, selectedId }: { shopId: string; onSelect?: (id: string) => void; selectedId?: string }) {
  const api = useApi();
  const base = `/api/shops/${shopId}/images`;
  const pendingKey = `omaiweb:image-generation:${shopId}`;
  const [images, setImages] = useState<LibraryImage[]>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [method, setMethod] = useState<"text" | "voice">();
  const [generated, setGenerated] = useState<{ id: string; name: string }>();
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("生成画像.png");
  const [ratio, setRatio] = useState<GenerateImageInput["aspectRatio"]>("4:3");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState<GenerateImageInput>();
  const [upload, setUpload] = useState<{ file: File; requestId: string }>();
  const [editing, setEditing] = useState<{ id: string; name: string }>();
  const [deleting, setDeleting] = useState<string>();
  const [zoomId, setZoomId] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    api<LibraryImage[]>(base).then(result => { if (active) setImages(result); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [base, api, attempt]);
  useEffect(() => {
    try { const saved = localStorage.getItem(pendingKey); if (saved) { const input = generateImageSchema.parse(JSON.parse(saved)); setPending(input); setPrompt(input.prompt); setName(input.name); setRatio(input.aspectRatio); setReference(input.referenceImageId || ""); setMethod("text"); setGeneratorOpen(true); setNotice("未完了の画像生成があります。同じ内容で生成・保存を再試行できます。"); } }
    catch { setError("前回の生成内容を復元できませんでした。新しい生成として指示を入力してください。"); }
  }, [pendingKey]);
  async function run(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function saveUpload(action: { file: File; requestId: string }) {
    await run(async () => { await api(base, { requestId: action.requestId, name: action.file.name, mimeType: action.file.type, data: await toData(action.file) }); setUpload(undefined); setAttempt(v => v + 1); setNotice("画像を登録しました。依頼時に「依頼に使う画像を選ぶ」から選べます。"); });
  }
  function newGeneration() {
    try { localStorage.removeItem(pendingKey); } catch { setError("前回の生成記録を消せませんでした。"); return; }
    setPending(undefined); setNotice(""); setError("");
  }
  function startGeneration(referenceId = "") {
    setGeneratorOpen(true);
    if (pending) return;
    setMethod(undefined); setGenerated(undefined); setPrompt(""); setName("生成画像.png"); setRatio("4:3"); setReference(referenceId); setNotice(""); setError("");
  }
  const visible = images?.filter(image => (source === "all" || image.source === source) && `${image.name} ${image.prompt || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const zoomIndex = visible?.findIndex(image => image.id === zoomId) ?? -1;
  return <section className={onSelect ? "image-library image-picker-library" : "panel image-library"} aria-label={onSelect ? "画像を選ぶ" : "画像管理"}>
    <div className="section-top">{onSelect ? <h3>画像を選ぶ</h3> : <h2>画像管理</h2>}<button type="button" disabled={busy || listening} onClick={() => setAttempt(v => v + 1)}>一覧を更新</button></div>
    <p>アップロードした画像とAIで生成した画像をまとめて管理します。ページやメニューで使って保存・反映するまで、お客様には公開されません。</p>
    {error && <p className="alert" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="image-library-tools"><label>画像をアップロード<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy || listening} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) { setError("5MB以内のPNG・JPEG・GIF・WebP画像を選んでください。"); return; }
      const action = { file, requestId: createRequestId() }; setUpload(action); void saveUpload(action);
    }} /></label><button type="button" disabled={busy || listening} onClick={() => generatorOpen ? setGeneratorOpen(false) : startGeneration()}>AIで生成</button></div>
    <p className="small muted">PNG・JPEG・GIF・WebP、1枚5MBまで。お客様メモの添付はこの一覧には表示しません。</p>
    {upload && !busy && <button type="button" onClick={() => void saveUpload(upload)}>アップロードを再試行</button>}
    {generatorOpen && <section className="image-generation" aria-label="AIで画像を生成する">
      <h3>AIで画像を生成する</h3>
      {!generated && <>
      <p>作りたい画像のイメージを、文章か音声で伝えてください。</p>
      <div className="request-methods" role="group" aria-label="画像生成の依頼方法">
        <button type="button" className={method === "text" ? "selected" : ""} aria-pressed={method === "text"} disabled={busy || listening || !!pending} onClick={() => setMethod("text")}><span aria-hidden="true">✎</span><b>文章で依頼</b><small>作りたい画像を書く</small></button>
        <button type="button" className={method === "voice" ? "selected" : ""} aria-pressed={method === "voice"} disabled={busy || listening || !!pending} onClick={() => setMethod("voice")}><span aria-hidden="true">◉</span><b>音声で依頼</b><small>声でイメージを伝える</small></button>
      </div>
      {method && <form onSubmit={event => { event.preventDefault(); void run(async () => {
      const input = pending || generateImageSchema.parse({ requestId: createRequestId(), prompt, name, aspectRatio: ratio, ...(reference ? { referenceImageId: reference } : {}) });
      localStorage.setItem(pendingKey, JSON.stringify(input)); setPending(input);
      const result = await api<{ imageId: string }>(`${base}/generate`, input);
      localStorage.removeItem(pendingKey); setPending(undefined); setAttempt(v => v + 1); setGenerated({ id: result.imageId, name: input.name }); setNotice("AIで生成した画像を画像管理に保存しました。内容を確認してから使用してください。");
    }); }}>
      {method === "voice" && <div className="image-voice-request"><h4>作りたい画像を声で伝える</h4><p>下のボタンを押して話してください。話した内容を確認・修正してから生成します。</p><DictationButton disabled={busy || !!pending} onListening={setListening} value={prompt} onChange={setPrompt} label="音声で指示する" /></div>}
      <fieldset disabled={busy || !!pending || listening}>
        <label>画像の名前<input required value={name} maxLength={255} onChange={event => setName(event.target.value)} /></label>
        <label>{method === "voice" ? "音声で伝えた内容・修正" : "生成したい画像"}<textarea aria-label={method === "voice" ? "音声で伝えた内容・修正" : "生成したい画像"} required rows={4} maxLength={4000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={method === "voice" ? "話した内容がここに表示されます。文字でも修正できます。" : "例：明るい窓辺に季節の花を飾った、お店の紹介ページ向けの写真"} /></label>
        <label>画像の比率<select value={ratio} onChange={event => setRatio(event.target.value as GenerateImageInput["aspectRatio"])}>{["1:1", "4:3", "3:4", "16:9", "9:16"].map(value => <option key={value}>{value}</option>)}</select></label>
      </fieldset>
      <RequestImagePicker shopId={shopId} max={1} value={reference ? [reference] : []} onChange={ids => setReference(ids[0] || "")} disabled={busy || !!pending || listening} label="参考画像を選ぶ" />
      <div className="actions"><button className="primary" type="submit" disabled={busy || listening || !prompt.trim() || !name.trim()}>{busy ? "画像を生成しています…" : pending ? "生成・保存を再試行" : "生成して結果を確認"}</button>{pending && <button type="button" disabled={busy || listening} onClick={newGeneration}>新しい生成として入力し直す</button>}</div>
    </form>}
    </>}
    {generated && <section className="request-review image-generation-result" aria-label="生成した画像を確認"><span className="pill">確認</span><h3>生成した画像を確認</h3><MenuImage imageId={generated.id} imageBase={base} name={generated.name} className="library-image" /><p>{generated.name}</p><p className="small muted">画像管理に保存しました。ページに使う場合は、依頼や編集画面から選んでください。</p><div className="actions"><button type="button" onClick={() => { setReference(generated.id); setGenerated(undefined); setMethod(undefined); setNotice(""); }}>さらに依頼する</button><button type="button" className="primary" onClick={() => { setGeneratorOpen(false); if (onSelect) onSelect(generated.id); }}>これでOK</button></div></section>}
    </section>}
    <div className="customer-controls"><label>画像を検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><label>画像の種類<select value={source} onChange={event => setSource(event.target.value)}><option value="all">すべて</option><option value="upload">アップロード</option><option value="ai">AI生成</option></select></label></div>
    {!images && !error && <p role="status">画像を読み込んでいます…</p>}
    {images && !visible?.length && <p className="empty">{images.length ? "条件に合う画像はありません。" : "まだ画像はありません。アップロードするか、AIで生成してください。"}</p>}
    <div className="image-library-grid">{visible?.map(image => <figure key={image.id} className={selectedId === image.id ? "image-selected" : ""}>
      <button type="button" className="image-preview-button" aria-label={`${image.name}を拡大`} onClick={() => setZoomId(image.id)}><MenuImage imageId={image.id} imageBase={base} name={image.name} className="library-image" /></button>
      <figcaption><strong>{image.name}</strong><span className="pill">{image.source === "ai" ? "AI生成" : "アップロード"}</span><small>{Math.ceil(image.size / 1024)} KB{image.createdAt && ` · ${new Date(image.createdAt).toLocaleDateString("ja-JP")}`}</small>{image.usedBy.length > 0 && <p className="small muted">使用中：{image.usedBy.join("、")}</p>}</figcaption>
      {image.prompt && <details><summary>生成したときの指示</summary><p className="pre-wrap">{image.prompt}</p></details>}
      <div className="actions">{onSelect && <button type="button" className="primary" disabled={busy || listening} onClick={() => onSelect(image.id)}>{selectedId === image.id ? "選択中の画像を使う" : "この画像を使う"}</button>}<button type="button" disabled={busy || listening || !!pending} onClick={() => startGeneration(image.id)}>この画像をもとに生成</button></div>
      {editing?.id === image.id ? <form onSubmit={event => { event.preventDefault(); void run(async () => { await api(`${base}/${image.id}/rename`, { name: editing.name }); setEditing(undefined); setAttempt(v => v + 1); setNotice("画像の名前を変更しました。"); }); }}><label>新しい画像名<input required maxLength={255} value={editing.name} disabled={busy} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label><div className="actions"><button type="submit" disabled={busy}>名前を保存</button><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>やめる</button></div></form> : <button type="button" disabled={busy} onClick={() => setEditing({ id: image.id, name: image.name })}>名前を変更</button>}
      {deleting === image.id ? <div className="notice">画像管理から削除します。Drive のファイルは残ります。<div className="actions"><button type="button" disabled={busy} onClick={() => void run(async () => { await api(`${base}/${image.id}/archive`, {}); setDeleting(undefined); setAttempt(v => v + 1); setNotice("画像管理から削除しました。"); })}>削除する</button><button type="button" disabled={busy} onClick={() => setDeleting(undefined)}>やめる</button></div></div> : <button type="button" disabled={busy || image.usedBy.length > 0} onClick={() => setDeleting(image.id)}>画像管理から削除</button>}
    </figure>)}</div>
    {zoomIndex >= 0 && <CustomerImageDialog items={visible!.map(image => ({ file: { id: image.id, name: image.name, mimeType: image.mimeType, size: image.size }, path: `${base}/${image.id}`, createdAt: image.createdAt || undefined }))} initialIndex={zoomIndex} close={() => setZoomId(undefined)} />}
  </section>;
}

export function ImagePicker({ shopId, value, change, preview = true }: { shopId: string; value?: string; change: (id: string | undefined) => void; preview?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className="image-picker"><div className="actions"><button type="button" onClick={() => setOpen(value => !value)}>{open ? "画像の選択を閉じる" : "画像管理から選ぶ・AIで生成"}</button>{value && <button type="button" onClick={() => change(undefined)}>管理画像を外す</button>}</div>{preview && value && <MenuImage imageId={value} imageBase={`/api/shops/${shopId}/images`} name="選択した画像" />}{open && <ImageLibrary shopId={shopId} selectedId={value} onSelect={id => { change(id); setOpen(false); }} />}</div>;
}
