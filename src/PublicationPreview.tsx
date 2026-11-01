import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ShopConfig } from "../server/domain";
import type { PublicPost } from "../server/post-domain";
import { useApi } from "./api";
import { PreviewSurface, type PreviewLocation, type PreviewScreen } from "./ScreenGallery";
import { sampleFixtures } from "./local-preview";

type Snapshot = { config: ShopConfig; posts: PublicPost[]; revision: number; hash: string };
const homeScreen: PreviewScreen = { id: "about", name: "お店のこと", description: "お店の紹介", pane: "about" };
export function PublicationPreview({ shopId }: { shopId: string }) {
  const api = useApi();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [currentScreen,setCurrentScreen]=useState<PreviewLocation>(homeScreen);
  const [requestOpen,setRequestOpen]=useState(false);
  const requestDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(requestOpen)requestDialog.current?.showModal();},[requestOpen]);
  const screenLink=`/?${new URLSearchParams({shop:shopId,tab:"try",screen:currentScreen.id,...(currentScreen.articleKey?{article:currentScreen.articleKey}:{})})}`;
  async function load() {
    setBusy(true); setError(""); setSnapshot(undefined);
    try { setSnapshot(await api<Snapshot>(`/api/shops/${shopId}/publication-preview`)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [shopId]);
  const fixtures = useMemo(() => {
    if (!snapshot) return undefined;
    return { ...sampleFixtures(snapshot.config), bookings: [], posts: snapshot.posts };
  }, [snapshot]);
  return <section className="publication-preview">
    <div className="panel"><span className="pill">{published ? "本番公開済み" : "仮公開中・本人のみ閲覧"}</span><h1>画面の確認・本番公開</h1>
      <p>下のお店のメニューやリンクをクリックして、各画面の表示と動きを確認してください。ここで試した予約・キャンセル・問い合わせは練習用で、実際のデータやメールには反映しません。</p>
      <p className="small muted">保存・反映済みの内容を表示しています。編集中の変更や、まだ反映していない提案は表示されません。</p>
      <p>デザインは各画面の編集画面で、スタッフ・料金・営業時間などはそれぞれの設定メニューで変更できます。全体的な表示や機能の修正は「AIとお店をつくる」で相談できます。</p>
      <a className="text-button" href="/">運営画面に戻る</a>
    </div>
    {snapshot && fixtures && <PreviewSurface key={snapshot.hash} config={snapshot.config} shopId={shopId} screen={homeScreen} fixtures={fixtures} onScreenChange={setCurrentScreen} />}
    {published ? <p className="notice" role="status">本番公開しました。ログインしていない方もページを表示できます。</p> : <section className="publication-actions" aria-label="本番公開の操作">
      {error && <div className="alert" role="alert"><p>{error}</p><button disabled={busy} onClick={() => void load()}>変更後の内容を確認し直す</button></div>}
      <div className="publication-actions-row"><div><h2>画面の確認ができたら</h2><p>本番公開すると、どなたでもお店のページを見られます。</p></div><div className="actions">
        <button type="button" disabled={busy||!snapshot} onClick={()=>setRequestOpen(true)}>修正依頼する</button>
        <button className="primary" disabled={busy || !snapshot} onClick={async () => {
          if (!snapshot) return;
          setBusy(true); setError("");
          try { await api(`/api/shops/${shopId}/publication`, { publication: "public", revision: snapshot.revision, hash: snapshot.hash }); setPublished(true); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          finally { setBusy(false); }
        }}>{busy ? "準備しています…" : "本番公開する"}</button>
      </div></div>
    </section>}
    {requestOpen&&<dialog ref={requestDialog} className="publication-request-dialog" aria-labelledby="publication-request-title" onCancel={()=>setRequestOpen(false)} onClose={()=>setRequestOpen(false)} onClick={event=>{if(event.target===event.currentTarget)setRequestOpen(false);}}>
      <h2 id="publication-request-title">どこを修正しますか？</h2>
      <p>いま開いている画面は「{currentScreen.name}」です。</p>
      <div className="publication-request-options">
        <a className="button" aria-label="いま開いている画面を直す" data-shop-request-link href={screenLink}><strong>いま開いている画面を直す</strong><span>「{currentScreen.name}」の編集画面で、デザインや表示を調整します。</span></a>
        <a className="button" aria-label="動作・機能を直す" data-shop-request-link href={`/?${new URLSearchParams({shop:shopId,tab:"build",request:"1",intent:"modify"})}`}><strong>動作・機能を直す</strong><span>予約の流れやお店全体の機能を、AIに修正依頼します。</span></a>
        <a className="button" aria-label="お店の情報・登録データを直す" data-shop-request-link href={`/?${new URLSearchParams({shop:shopId,tab:"data",dataMenu:"1"})}`}><strong>お店の情報・登録データを直す</strong><span>メニュー・料金・予約・記事などを、各管理メニューで変更します。</span></a>
      </div>
      <button type="button" onClick={()=>setRequestOpen(false)}>プレビューに戻る</button>
    </dialog>}
  </section>;
}
