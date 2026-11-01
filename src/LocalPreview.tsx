import { tr } from "../shared/i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChromeEditor, ChromePreview } from "./SiteChrome";
import { ScreenTree } from "./ScreenTree";
import { SyncPreview } from "./SyncPreview";
import { syncStatus, replaceScope, type SyncStatus } from "./editor-sync";
import type { EditorIndex } from "../server/editor-index-schema";
import { ApiProvider, useApi } from "./api";
import { PublicShop, type Workspace, type Session } from "./App";
import { PageEditor } from "./PageEditor";
import { pageSchema, pageValue, scopedSource, scopedConfig, rebaseDraft, same, type ReleaseScope, type ShopPage } from "../server/pages";
import { FixtureEditor } from "./FixtureEditor";
import { VisualRequest } from "./VisualRequest";
import { shopSchema, planSummary, type ShopConfig } from "../server/domain";
import { postKey, type PostCategory, type PublicPost } from "../server/post-domain";
import { createRequestId } from "./request-id";
import { createPreviewClient, draftKey, fixturesSchema, readDraft, sampleFixtures, writeDraft, type LocalDraft, type Fixtures } from "./local-preview";

type Snapshot = Pick<LocalDraft, "base" | "source" | "config"> & { lastPublishedPlanId?: string };
export function LocalPreview({ shop, email, reload, sidebar, activate, initialScreen, initialArticleKey }: { shop: Workspace; email: string; reload: () => Promise<unknown>; sidebar?: HTMLElement | null; activate?: () => void; initialScreen?: string; initialArticleKey?: string }) {
  const api = useApi();
  const key = draftKey(email, shop.id);
  const [draft, setDraft] = useState<LocalDraft>();
  const latestDraft = useRef<LocalDraft | undefined>(undefined);
  const entrySelected=useRef(false);
  const [fixtureEditing, setFixtureEditing] = useState<Fixtures>();
  const displayMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const menu = displayMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      const menu = displayMenu.current;
      if (event.key === "Escape" && menu?.open) { menu.open = false; menu.querySelector("summary")?.focus(); }
    }
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside, true); document.removeEventListener("keydown", closeOnEscape); };
  }, []);
  const [screen, setScreen] = useState("reserve");
  const [penHost, setPenHost] = useState<HTMLSpanElement | null>(null);
  const [visibility, setVisibility] = useState<Record<string, { header?: boolean; footer?: boolean }>>({});
  const [index, setIndex] = useState<EditorIndex>();
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});
  const [conflict, setConflict] = useState<{ scope: ReleaseScope; localValue: unknown; remoteValue: unknown; remoteConfig?: ShopConfig; baseline: unknown; proposed?: unknown; explanation?: string }>();
  const [pageEditing, setPageEditing] = useState<ShopPage>();
  const [route, setRoute] = useState<{ category?: PostCategory; articleKey?: string; pageSlug?: string; pane: string }>({ pane: "reserve" });
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState(false);
  const [pullReview, setPullReview] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function save(value: LocalDraft) {
    latestDraft.current = value;
    setDraft(value); setReview(false); setSaved(false);
    try { writeDraft(localStorage, key, value); setSaved(true); }
    catch { setError(tr("このブラウザに保存できませんでした。空き容量やサイトデータの保存設定を確認してください。編集内容はこの画面に残っています。")); }
  }
  function restore(value: LocalDraft) {
    save(value);
    setFixtureEditing(structuredClone(value.fixtures));
    setInvalid(""); setVersion(v => v + 1);
  }
  async function refreshIndex() {
    const next = await api<EditorIndex>(`/api/shops/${shop.id}/local-editor/index`);
    setIndex(next);
    return next;
  }
  useEffect(() => {
    let active = true;
    void run(async () => {
      const cached = readDraft(localStorage, key);
      if (cached && active) { restore({ ...cached, downloaded: cached.downloaded || cached.source?.pages.map(p => p.id) || [] }); setIndex(cached.index); }
      try {
        const [current, remote] = await Promise.all([api<Snapshot>(`/api/shops/${shop.id}/local-editor/shared`), api<EditorIndex>(`/api/shops/${shop.id}/local-editor/index`)]);
        if (!active) return;
        setIndex(remote);
        if (!cached) restore({ ...current, downloaded: [], index: remote, fixtures: sampleFixtures(current.config) });
        else if (!cached.pending) restore({ ...cached, index: remote, downloaded: cached.downloaded || cached.source?.pages.map(p => p.id) || [], config: { ...cached.config, menus: current.config.menus, staff: current.config.staff, hours: current.config.hours, rules: current.config.rules } });
      } catch (e) { if (!cached) throw e; setError(tr("リモートの最新状態を確認できません。ローカル編集は保持しています。更新確認を再試行してください。")); }
    });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    if (!latestDraft.current) return;
    let active = true;
    void api<EditorIndex>(`/api/shops/${shop.id}/local-editor/index`).then(remote => { if (active) setIndex(remote); }).catch(() => { if (active) setError(tr("最新の画面一覧を確認できませんでした。")); });
    return () => { active = false; };
  }, [key, shop.revision]);
  useEffect(() => {
    if (!draft || !index) return;
    let active = true;
    const ids = [...new Set([...draft.config.pages, ...draft.source?.pages || [], ...index.pages].map(p => p.id))];
    void Promise.all([syncStatus(draft, index, { kind: "shared" }).then(status => ["shared", status] as const), ...["header", "footer"].map(part => syncStatus(draft, index, { kind: "part", part: part as "header" | "footer" }).then(status => [`part:${part}`, status] as const)), ...ids.map(id => syncStatus(draft, index, { kind: "page", pageId: id }).then(status => [id, status] as const))]).then(entries => { if (active) setStatuses(Object.fromEntries(entries)); }).catch(() => { if (active) setError(tr("状態の比較に失敗しました。ページを再読み込みしてください。")); });
    return () => { active = false; };
  }, [draft, index]);
  useEffect(() => {
    if (!draft || draft.pending || busy || conflict) return;
    let active = true;
    const check = async () => {
      try { const remote = await api<EditorIndex>(`/api/shops/${shop.id}/local-editor/index`); if (active) { setIndex(remote); writeDraft(localStorage, key, { ...(latestDraft.current || draft), index: remote }); } }
      catch { if (active) setError(tr("最新のリモート状態を確認できません。ローカル編集は保持しています。")); }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void check(); }, 30000);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [draft, busy, conflict, key]);
  const mock = useMemo(() => draft ? createPreviewClient(draft.config, draft.fixtures, shop.id, imageId => api(`/api/shops/${shop.id}/menu-images/${imageId}`)) : undefined, [draft?.config, draft?.fixtures, shop.id]);
  const session: Session = { demo: false, user: { name: draft?.fixtures.customerName || tr("サンプルのお客様"), email: "sample@example.com", role: "customer", shopId: shop.id } };
  const scope: ReleaseScope = draft?.pending?.scope || (screen.startsWith("page:") ? { kind: "page", pageId: screen.slice(5) } : screen.startsWith("part:") ? { kind: "part", part: screen === "part:footer" ? "footer" : "header" } : { kind: "shared" });
  let releaseConfig = draft?.config;
  try { if (draft) releaseConfig = scopedConfig(draft.source, draft.config, scope); } catch { releaseConfig = undefined; }
  const summary = draft && releaseConfig ? planSummary(draft.source, releaseConfig) : [];
  const selectedPage = draft && scope.kind === "page" ? pageValue(draft.config, scope.pageId) : undefined;
  const allPages = draft ? [...draft.config.pages, ...(index?.pages || []).filter(p => !draft.config.pages.some(local => local.id === p.id)), ...(draft.source?.pages || []).filter(p => !draft.config.pages.some(local => local.id === p.id) && !index?.pages.some(remote => remote.id === p.id))] : [];
  const status = statuses[scope.kind === "page" ? scope.pageId : scope.kind === "part" ? `part:${scope.part}` : "shared"];
  const selectedRemote = scope.kind === "page" ? index?.pages.find(p => p.id === scope.pageId) : undefined;
  function editPage(page: ShopPage) {
    if (!draft) return;
    setPageEditing(page);
    const check = pageSchema.safeParse(page);
    const config = { ...draft.config, pages: draft.config.pages.map(p => p.id === page.id ? page : p) };
    const valid = shopSchema.safeParse(config);
    if (!check.success || !valid.success) { setInvalid(tr("ページのタイトル・アドレス・画像を確認してください。同じアドレスは使えません。")); return; }
    setInvalid(""); save({ ...draft, config: valid.data });
    setRoute({ pane: "reserve", pageSlug: page.slug });
  }
  function changeConfig(config: ShopConfig) {
    if (!draft || draft.pending) return;
    const parsed = shopSchema.safeParse(config);
    if (!parsed.success) { setInvalid(parsed.error.issues[0]?.message || tr("お店の情報を確認してください")); return; }
    setInvalid(""); save({ ...draft, config: parsed.data });
    if (scope.kind === "page") setPageEditing(parsed.data.pages.find(p => p.id === scope.pageId));
  }
  async function choose(value: string) {
    activate?.();
    const target: ReleaseScope = value.startsWith("page:") ? { kind: "page", pageId: value.slice(5) } : value.startsWith("part:") ? { kind: "part", part: value === "part:footer" ? "footer" : "header" } : { kind: "shared" };
    let currentIndex = index;
    try { currentIndex = await refreshIndex(); } catch { setError(tr("最新の状態を確認できません。保存済みのローカル画面を表示します。")); }
    const currentStatus = draft && currentIndex ? await syncStatus(draft, currentIndex, target) : undefined;
    if (currentStatus === "unfetched" || currentStatus === "remote") await fetchScope(target);
    setScreen(value);
    if (currentStatus === "conflict") await compareConflict(target);
    setInvalid("");
    if (value.startsWith("page:")) {
      const page = latestDraft.current?.config.pages.find(p => p.id === value.slice(5)) || currentIndex?.pages.find(p=>p.id===value.slice(5));
      setPageEditing(undefined); setRoute({ pane: "reserve", pageSlug: page?.slug }); setVersion(v => v + 1); return;
    }
    if (target.kind === "part") { setRoute({ pane: "reserve" }); setVersion(v => v + 1); return; }
    const [category, article] = value.split(":");
    if (category === "blogs" || category === "announcements") {
      const first = draft?.fixtures.posts.find(p => p.category === category);
      setRoute({ category, articleKey: article && first ? postKey(first) : undefined, pane: "reserve" });
    } else setRoute({ pane: value });
    setVersion(v => v + 1);
  }
  useEffect(()=>{
    if(entrySelected.current||!initialScreen||!draft||!index||draft.pending)return;
    entrySelected.current=true;
    const screens=["reserve","about","mine","contact","blogs","blogs:article","announcements","announcements:article",...index.pages.map(page=>`page:${page.id}`),...draft.config.pages.map(page=>`page:${page.id}`)];
    if(!screens.includes(initialScreen)){setError(tr("指定された画面が見つかりません。画面一覧から選んでください。"));return;}
    void run(async()=>{
      await choose(initialScreen);
      const category=initialScreen.split(":")[0];
      if(initialArticleKey&&initialScreen.endsWith(":article")&&(category==="blogs"||category==="announcements")){
        const snapshot=await api<{posts:PublicPost[]}>(`/api/shops/${shop.id}/publication-preview`);
        const post=snapshot.posts.find(post=>post.category===category&&postKey(post)===initialArticleKey);
        if(post&&latestDraft.current){
          const current=latestDraft.current;
          const fixtures={...current.fixtures,posts:[...current.fixtures.posts.filter(item=>item.category!==category||postKey(item)!==initialArticleKey).slice(0,49),post]};
          save({...current,fixtures});setFixtureEditing(structuredClone(fixtures));
          setRoute({category,articleKey:initialArticleKey,pane:"reserve"});setVersion(value=>value+1);
        }else{
          setScreen(category);setRoute({category,pane:"reserve"});
          setNotice(tr("選んだ記事は公開内容から見つかりませんでした。一覧から確認してください。"));
        }
      }
    });
  },[draft,index,initialScreen,initialArticleKey]);
  async function remoteValue(target: ReleaseScope) {
    if (target.kind === "page") return (await api<{ page: ShopPage | null }>(`/api/shops/${shop.id}/local-editor/pages/${target.pageId}`)).page;
    return scopedSource((await api<Snapshot>(`/api/shops/${shop.id}/local-editor/shared`)).source, target);
  }
  async function adopt(target: ReleaseScope, remote: unknown, chosen: unknown, backup = false) {
    if (!draft) return;
    const remoteIndex = await refreshIndex();
    const current = latestDraft.current || draft;
    // A second fetch may finish after the user has chosen an image or edited this scope.
    if (!same(scopedSource(current.config, target), scopedSource(draft.config, target))) return;
    const source = target.kind === "shared" && remote === null ? null : replaceScope(current.source || { ...current.config, pages: [] }, target, remote);
    const config = replaceScope(current.config, target, chosen);
    const downloaded = target.kind === "page" ? [...new Set([...(current.downloaded || []), target.pageId])] : current.downloaded;
    const backups = backup ? [...(current.backups || []), { at: new Date().toISOString(), scope: target, baseline: scopedSource(current.source, target), localValue: scopedSource(current.config, target), remoteValue: remote }].slice(-20) : current.backups;
    const next = { ...current, source, config, base: remoteIndex.base, downloaded, backups, index: remoteIndex };
    writeDraft(localStorage, key, next); restore(next); setConflict(undefined);
    if (target.kind === "page") {
      setPageEditing(config.pages.find(p => p.id === target.pageId));
      if (chosen === null && remote === null) { setScreen("reserve"); setRoute({ pane: "reserve" }); } else setScreen(`page:${target.pageId}`);
    }
  }
  async function fetchScope(target: ReleaseScope, discardConfirmed = false) {
    const value = await remoteValue(target);
    if (draft) {
      const local = scopedSource(draft.config, target), baseline = scopedSource(draft.source, target);
      if (!same(local, baseline) && !same(value, baseline) && !same(local, value)) {
        setConflict({ scope: target, baseline, localValue: local, remoteValue: value }); setPullReview(false); return;
      }
      if (!discardConfirmed && !same(local, baseline) && !same(local, value)) { setPullReview(true); return; }
    }
    await adopt(target, value, value);
  }
  async function compareConflict(target: ReleaseScope = scope) {
    if (!draft) return;
    const [value, remoteSnapshot] = await Promise.all([remoteValue(target), api<Snapshot>(`/api/shops/${shop.id}/local-editor/shared`)]);
    setConflict({ scope: target, baseline: structuredClone(scopedSource(draft.source, target)), localValue: structuredClone(scopedSource(draft.config, target)), remoteValue: value, remoteConfig: remoteSnapshot.config });
  }
  async function resolveConflict(choice: "local" | "remote" | "merged") {
    if (!draft || !conflict) return;
    if (!same(scopedSource(draft.config, conflict.scope), conflict.localValue)) throw new Error(tr("ローカル編集が変わりました。比較を開き直してください"));
    const latest = await remoteValue(conflict.scope);
    if (!same(latest, conflict.remoteValue)) {
      setConflict({ ...conflict, remoteValue: latest, proposed: undefined, explanation: undefined }); await refreshIndex();
      throw new Error(tr("リモートが再更新されました。新しいプレビューを比較し直してください"));
    }
    const chosen = choice === "local" ? conflict.localValue : choice === "remote" ? conflict.remoteValue : conflict.proposed;
    if (chosen === undefined) throw new Error(tr("結合案を確認してください"));
    await adopt(conflict.scope, latest, chosen, true);
    setNotice(choice === "remote" ? tr("リモートをローカルに採用しました。本番は変更していません。") : tr("採用する内容をローカルに保存しました。確認してからこの画面だけを本番に反映してください。"));
  }
  function afterRelease(current: Snapshot, local: LocalDraft, target: ReleaseScope, remote: EditorIndex): LocalDraft {
    const known = new Set([...local.config.pages, ...(local.source?.pages || [])].map(page => page.id));
    const acquired = { ...current.config, pages: current.config.pages.filter(page => known.has(page.id)) };
    const { pending: _, ...remaining } = local;
    return { ...remaining, ...current, ...rebaseDraft(local.source, local.config, acquired, target), index: remote };
  }
  async function release() {
    if (!draft || !saved || invalid) return;
    if (status === "conflict" || status === "remote" || status === "unfetched") throw new Error(tr("先にこの画面のリモート更新を取得するか、競合を解決してください"));
    let next = draft;
    if (!next.pending) {
      next = { ...next, pending: { requestId: createRequestId(), config: structuredClone(next.config), scope } };
      // Save the action identity before the first request so retries remain safe.
      writeDraft(localStorage, key, next); setDraft(next);
    }
    const pending = next.pending!;
    if (!pending.planId) {
      const plan = await api<{ id: string }>(`/api/shops/${shop.id}/plan`, {
        text: tr("ローカルで確認した画面の変更を反映"), config: pending.config,
        local: { base: next.base, source: next.source, requestId: pending.requestId, scope: pending.scope },
      });
      next = { ...next, pending: { ...pending, planId: plan.id } };
      writeDraft(localStorage, key, next); setDraft(next);
    }
    const id = next.pending!.planId!;
    await api(`/api/shops/${shop.id}/plans/${id}/approve`, {});
    await api(`/api/shops/${shop.id}/plans/${id}/publish`, {});
    const current = await api<Snapshot>(`/api/shops/${shop.id}/local-editor`);
    const remote = await refreshIndex();
    restore(afterRelease(current, next, next.pending!.scope || scope, remote));
    if (scope.kind === "page" && !current.config.pages.some(p => p.id === scope.pageId)) { setScreen("reserve"); setRoute({ pane: "reserve" }); }
    setNotice(tr("本番に反映しました。サンプルの予約・問い合わせ・記事は本番には保存していません。"));
    await reload();
  }
  const automaticFetch = useRef("");
  useEffect(() => {
    if (!draft || !index || busy || draft.pending || conflict || !["remote", "unfetched"].includes(status || "")) return;
    const token = scope.kind === "page" ? `${scope.pageId}:${index.pages.find(p => p.id === scope.pageId)?.hash || "deleted"}` : scope.kind === "part" ? `part:${scope.part}:${index.parts[scope.part]}` : `shared:${index.sharedHash}`;
    if (automaticFetch.current === token) return;
    automaticFetch.current = token;
    void run(async () => fetchScope(scope));
  }, [status, screen, index, busy, !!draft?.pending, !!conflict]);
  const tree = <ScreenTree draft={draft} index={index} statuses={statuses} selected={screen} disabled={busy || !!draft?.pending || !!conflict} onChoose={value => void run(async () => choose(value))} />;
  return <div className="local-preview preview-first">
    {sidebar ? createPortal(tree, sidebar) : tree}
    <div className="editor-toolbar">
      <div><strong>{scope.kind === "page" ? allPages.find(p => p.id === scope.pageId)?.title || tr("ページ") : scope.kind === "part" ? (scope.part === "header" ? tr("ヘッダー") : tr("フッター")) : ({ reserve: tr("予約"), about: tr("お店のこと"), mine: tr("マイページ"), contact: tr("お問い合わせ"), blogs: tr("ブログ一覧"), "blogs:article": tr("ブログ記事"), announcements: tr("お知らせ一覧"), "announcements:article": tr("お知らせ記事") } as Record<string, string>)[screen]}</strong>{summary.length > 0 && <span className={`editor-change-badge ${saved ? "" : "unsaved"}`}>{saved ? tr("変更あり") : tr("未保存")}</span>}</div>
      <div className="editor-tools"><span ref={setPenHost} />
        {scope.kind !== "part" && <details ref={displayMenu} className="preview-display-menu"><summary>{tr("表示")}</summary><div>
          <label><input type="checkbox" checked={visibility[screen]?.header === false} onChange={event => setVisibility(v => ({ ...v, [screen]: { ...v[screen], header: !event.target.checked } }))} />{tr("ヘッダーを表示")}</label>
          <label><input type="checkbox" checked={visibility[screen]?.footer === false} onChange={event => setVisibility(v => ({ ...v, [screen]: { ...v[screen], footer: !event.target.checked } }))} />{tr("フッターを表示")}</label>
          <p>{tr("この画面のプレビューだけに適用")}</p>
        </div></details>}
      </div>
      {draft && (summary.length > 0 || draft.pending) && <div className="actions">
        <button className="primary" disabled={busy || !saved || !!invalid || !releaseConfig || !index || !status || status === "conflict" || status === "remote" || status === "unfetched" || !!conflict} onClick={() => setReview(true)}>{draft.pending ? tr("反映を再試行") : tr("反映する")}</button>
        <button disabled={busy || !!draft.pending || !!conflict} onClick={() => setPullReview(true)}>{tr("変更を取り消す")}</button>
      </div>}
      {status === "conflict" && !conflict && <button disabled={busy || !!draft?.pending} onClick={() => void run(async () => compareConflict())}>{tr("競合を比較して解決")}</button>}
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice small" role="status">{notice}<button className="text-button" onClick={() => setNotice("")} aria-label={tr("通知を閉じる")}>×</button></p>}
    {invalid && <p className="alert" role="alert">{invalid}{tr("（編集欄で確認してください）")}</p>}
    {!draft && <p className="panel">{busy ? tr("画面を開いています…") : tr("画面を読み込めませんでした。ページを再読み込みしてください。")}</p>}
        {draft && draft.pending && <div className="notice"><p>{tr("反映処理を完了できていません。ローカル編集は保持しています。同じ内容で反映を再試行してください。")}</p>
          <button disabled={busy} onClick={() => void run(async () => {
            const current = await api<Snapshot>(`/api/shops/${shop.id}/local-editor`);
            if (draft.pending?.planId && current.lastPublishedPlanId === draft.pending.planId) {
              restore(afterRelease(current, draft, draft.pending.scope || scope, await refreshIndex())); setNotice(tr("本番への反映は完了していました。最新の内容を取り込みました。"));
            } else { const { pending: _, ...editable } = draft; restore(editable); setNotice(tr("反映処理を中止しました。最新の本番を取り込むか、編集を続けられます。")); }
          })}>{tr("反映状態を確認して編集に戻る")}</button>
        </div>}
    {conflict && draft && <section className="panel conflict-dialog" role="dialog" aria-modal="true" aria-label={tr("ローカルとリモートの競合")}>
      <h2>{tr("競合を比較して解決")}</h2><p>{tr("採用しても本番には反映されません。解決前の内容はこのブラウザに控えを残します。")}</p>
      <div className="conflict-columns"><div><h3>{tr("ローカル")}</h3><SyncPreview config={draft.config} value={conflict.localValue} scope={conflict.scope} fixtures={draft.fixtures} shopId={shop.id} /></div><div><h3>{tr("リモート")}</h3><SyncPreview config={conflict.remoteConfig || draft.config} value={conflict.remoteValue} scope={conflict.scope} fixtures={draft.fixtures} shopId={shop.id} /></div></div>
      <div className="actions">
        <button disabled={busy} onClick={() => void run(async () => resolveConflict("local"))}>{tr("ローカルを採用")}</button>
        <button disabled={busy} onClick={() => void run(async () => resolveConflict("remote"))}>{tr("リモートを採用")}</button>
        <button disabled={busy} onClick={() => void run(async () => {
          const proposal = await api<{ value: unknown; explanation: string }>(`/api/shops/${shop.id}/local-editor/merge`, { scope: conflict.scope, baseline: conflict.baseline, localValue: conflict.localValue, expectedRemote: conflict.remoteValue });
          setConflict({ ...conflict, proposed: proposal.value, explanation: proposal.explanation });
        })}>{tr("AIで結合案を作る")}</button>
        <button disabled={busy} onClick={() => setConflict(undefined)}>{tr("比較を閉じる")}</button>
      </div>
      {conflict.proposed !== undefined && <div><h3>{tr("AIの結合案")}</h3><p>{conflict.explanation}</p><SyncPreview config={draft.config} value={conflict.proposed} scope={conflict.scope} fixtures={draft.fixtures} shopId={shop.id} /><button className="primary" disabled={busy} onClick={() => void run(async () => resolveConflict("merged"))}>{tr("結合案をローカルに採用")}</button></div>}
    </section>}
    {draft && <>
      {!draft.pending && !invalid && !conflict && (scope.kind !== "page" || selectedPage) && <VisualRequest key={JSON.stringify(draft.config)} shopId={shop.id} config={draft.config} root={root} triggerHost={penHost} onBusyChange={setBusy} local={{ base: draft.base, source: draft.source, pageId: scope.kind === "page" ? scope.pageId : undefined, part: scope.kind === "part" ? scope.part : undefined }} onLocalChange={config => { changeConfig(config); setNotice(tr("ペンの変更をローカルに保存しました。本番に反映する前に画面を確認してください。")); }} />}    </>}
    {draft && mock && !conflict && <>
      {scope.kind === "page" && !selectedPage ? <p className="panel">{status === "unfetched" ? tr("ページを自動で読み込んでいます。") : tr("削除予定のページはプレビューに表示しません。")}</p> : <div ref={root} className="local-preview-screen" onClickCapture={e => {
        const link = (e.target as HTMLElement).closest("a");
        if (link && !link.getAttribute("href")?.startsWith("/s/local-preview")) {
          e.preventDefault(); e.stopPropagation();
          setNotice(tr("リンク先は試す画面では開きません。サイドバーの画面ツリーから選択してください。"));
        }
      }}>
        {scope.kind === "part" ? <ChromePreview config={draft.config} part={scope.part} imageBase={`/api/shops/${shop.id}/images`} /> : <ApiProvider value={mock}>
          <PublicShop key={`${version}-${JSON.stringify(route)}-${JSON.stringify(draft.config)}`} session={session} slug="local-preview" search="" initialPane={route.pane} onPaneChange={pane => void run(async () => choose(pane))} pageSlug={scope.kind === "page" ? selectedPage?.slug : route.pageSlug} category={route.category} articleKey={route.articleKey} hideHeader={visibility[screen]?.header !== false} hideFooter={visibility[screen]?.footer !== false} busy={busy} run={run} notify={setNotice} navigate={href => {
            const url = new URL(href, location.origin);
            const match = url.pathname.match(/^\/s\/local-preview\/(blogs|announcements)(?:\/([^/]+))?$/);
            const pageMatch = url.pathname.match(/^\/s\/local-preview\/pages\/([^/]+)$/);
            if (pageMatch) { const page = draft.config.pages.find(p => p.slug === pageMatch[1]); if (page) choose(`page:${page.id}`); return; }
            if (match) { setScreen(`${match[1]}${match[2] ? ":article" : ""}`); setRoute({ category: match[1] as PostCategory, articleKey: match[2], pane: "reserve" }); }
            else void run(async () => choose(url.searchParams.get("pane") || "reserve"));
          }} />
        </ApiProvider>}
      </div>}
    </>}    {draft && !conflict && <div className="panel editor-secondary">
      {scope.kind === "part" && <details key={`part:${scope.part}`}><summary>{scope.part === "header" ? tr("ヘッダー") : tr("フッター")}{tr("の内容を編集")}</summary><fieldset disabled={busy || !!draft.pending}><ChromeEditor config={draft.config} part={scope.part} shopId={shop.id} onChange={changeConfig} /></fieldset></details>}
      {scope.kind === "page" && <details key={`page:${scope.pageId}`}><summary>{tr("このページの内容を編集")}</summary>
        {scope.kind === "page" && <>
          {!draft.source && <p className="notice">{tr("追加ページを公開する前に、予約画面などを選んでお店の共通設定を反映してください。")}</p>}
          {status === "unfetched" ? <p className="notice">{tr("ページを自動で読み込んでいます。")}</p> : selectedPage ? <fieldset disabled={busy || !!draft.pending || !!conflict}><PageEditor key={selectedPage.id} page={pageEditing?.id === selectedPage.id ? pageEditing : selectedPage} shopId={shop.id} onChange={editPage} onDelete={() => {
            if (!window.confirm(tr("このページをローカルで削除しますか？本番からの削除は反映時に行います。"))) return;
            save({ ...draft, config: { ...draft.config, pages: draft.config.pages.filter(p => p.id !== selectedPage.id) } }); setPageEditing(undefined); setInvalid("");
            if (!draft.source?.pages.some(p => p.id === selectedPage.id)) { setScreen("reserve"); setRoute({ pane: "reserve" }); }
          }} /></fieldset> : <p className="notice">{tr("このページは削除予定です。「本番に反映」で公開ページから削除します。")}<button disabled={busy || !!draft.pending || !!conflict} onClick={() => {
            const page = draft.source?.pages.find(p => scope.kind === "page" && p.id === scope.pageId);
            if (page) { save({ ...draft, config: { ...draft.config, pages: [...draft.config.pages, page] } }); setPageEditing(page); }
          }}>{tr("削除を取り消す")}</button></p>}
        </>}
      </details>}
        <details><summary>{tr("サンプルデータを編集")}</summary>
          <p>{tr("お客様の名前・予約・記事を変更できます。ここでのデータと練習中の操作は本番に反映しません。")}</p>
          <fieldset disabled={busy || !!draft.pending || !!conflict}><FixtureEditor config={draft.config} value={fixtureEditing || draft.fixtures} onChange={setFixtureEditing} /></fieldset>
          <button disabled={busy || !!draft.pending || !!conflict} onClick={() => void run(async () => {
            const fixtures = fixturesSchema.parse(fixtureEditing || draft.fixtures);
            if (fixtures.bookings.some(b => !draft.config.staff.some(s => s.id === b.staffId) || !draft.config.menus.some(m => m.id === b.menuId) || !draft.config.staff.some(s => s.id === b.staffId && s.menuIds.includes(b.menuId)))) throw new Error(tr("サンプル予約のメニュー・担当者を確認してください"));
            save({ ...draft, fixtures }); setScreen("reserve"); setRoute({ pane: "reserve" }); setVersion(v => v + 1); setNotice(tr("サンプルデータを保存しました。"));
          })}>{tr("サンプルをプレビューに反映")}</button>
        </details>
        {!!draft.backups?.length && <details><summary>{tr("競合解決前の控え")}</summary>{draft.backups.map((backup, i) => <p key={`${backup.at}-${i}`}>{backup.at} <button disabled={busy || !!draft.pending || !!conflict} onClick={() => void run(async () => {
          const config = replaceScope(draft.config, backup.scope, backup.localValue);
          const source = backup.baseline === null && backup.scope.kind === "shared" ? null : replaceScope(draft.source || draft.config, backup.scope, backup.baseline);
          const next = { ...draft, config, source }; writeDraft(localStorage, key, next); restore(next); setNotice(tr("競合解決前のローカル編集を復元しました。"));
        })}>{tr("この時点のローカルを復元")}</button></p>)}</details>}
      <details><summary>{tr("保存と同期について")}</summary><p>{tr("編集はこのブラウザだけに保存され、サイトデータを消すと失われます。画面は開くと必要な内容を自動で読み込みます。変更がある画面だけツリーに印を付けます。両側に変更があればプレビューを比較して解決してください。料金・勤務などの本番データは各管理メニューの保存で反映します。練習用の予約や問い合わせは本番には保存せず、Google Calendar にも接続しません。")}</p></details>
    </div>}
    {pullReview && draft && <div className="panel" role="dialog" aria-modal="true" aria-label={tr("この画面の変更を取り消す")}>
      <p>{tr("この画面のローカル変更を取り消します。他の画面の編集とサンプルデータは保持します。")}</p>
      <button disabled={busy} onClick={() => void run(async () => { const latest = await remoteValue(scope); await adopt(scope, latest, latest, true); setPullReview(false); setNotice(tr("この画面の変更を取り消しました。")); })}>{tr("この画面の変更を取り消す")}</button>
      <button disabled={busy} onClick={() => setPullReview(false)}>{tr("戻る")}</button>
    </div>}
    {review && draft && <div className="panel" role="dialog" aria-modal="true" aria-label={tr("本番への反映内容")}>
      <h3>{tr("本番への反映内容：")}{scope.kind === "page" ? allPages.find(p => p.id === scope.pageId)?.title || tr("ページ削除") : scope.kind === "part" ? (scope.part === "header" ? tr("ヘッダー") : tr("フッター")) : tr("お店の共通設定")}</h3><ul>{summary.map(s => <li key={s}>{s}</li>)}</ul>
      <details><summary>{tr("設定の変更前と変更後")}</summary><div className="local-diff"><pre>{JSON.stringify(draft.source, null, 2)}</pre><pre>{JSON.stringify(draft.config, null, 2)}</pre></div></details>
      <p>{tr("選んだページ（または共通設定）だけを本番に反映します。他のページのローカル編集と、サンプルデータは含みません。")}</p>
      <button className="primary" disabled={busy || !saved} onClick={() => void run(release)}>{tr("この内容を本番に反映")}</button>
      <button disabled={busy} onClick={() => setReview(false)}>{tr("戻る")}</button>
    </div>}
  </div>;
}
