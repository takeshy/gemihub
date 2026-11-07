import { tr } from "../shared/i18n";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChromeEditor, ChromePreview } from "./SiteChrome";
import { ThemePreview } from "./ScreenGallery";
import { ScreenTree } from "./ScreenTree";
import { SyncPreview } from "./SyncPreview";
import { syncStatus, replaceScope, type SyncStatus } from "./editor-sync";
import type { EditorIndex } from "../server/editor-index-schema";
import { ApiProvider, useApi } from "./api";
import { PublicShop, type Workspace, type Session } from "./App";
import { PageEditor } from "./PageEditor";
import { ScreenDesignEditor, ThemeDesignEditor, WholeThemeDesignEditor } from "./DesignEditor";
import { screenIds, type ScreenId } from "../shared/screens";
import { pageSchema, pageValue, scopedSource, scopedConfig, rebaseDraft, same, type ReleaseScope, type ShopPage } from "../server/pages";
import { FixtureEditor } from "./FixtureEditor";
import { fixtureScope, fixturePostEntries, hasFixtureFields } from "./fixture-scope";
import { VisualRequest } from "./VisualRequest";
import { useComparisonScroll } from "./comparison-scroll";
import { DesignVersionHistory } from "./DesignVersionHistory";
import { regionOf } from "../shared/region";
import { shopSchema, planSummary, bookingStaff, type ShopConfig } from "../server/domain";
import { postKey, type PostCategory, type PublicPost } from "../server/post-domain";
import { createRequestId } from "./request-id";
import { articleKinds } from "../shared/article-features";
import { standardTheme, themeHtmlKey } from "../shared/theme-editing";
import { createPreviewClient, draftKey, fixturesSchema, readDraft, sampleFixtures, syncPreviewArticleFeatures, writeDraft, type LocalDraft, type Fixtures } from "./local-preview";

type Snapshot = Pick<LocalDraft, "base" | "source" | "config"> & { lastPublishedPlanId?: string };
export function LocalPreview({ shop, email, reload, sidebar, active = true, activate, onScreenChange, initialScreen, initialArticleKey }: { shop: Workspace; email: string; reload: () => Promise<unknown>; sidebar?: HTMLElement | null; active?: boolean; activate?: () => void; onScreenChange?: (screen: string, article?: string) => void; initialScreen?: string; initialArticleKey?: string }) {
  const api = useApi();
  const key = draftKey(email, shop.id);
  const [draft, setDraft] = useState<LocalDraft>();
  const latestDraft = useRef<LocalDraft | undefined>(undefined);
  const checkedRevision = useRef(shop.revision);
  const entrySelected = useRef<string | undefined>(undefined);
  const selectionVersion = useRef(0);
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
  const [historyHost, setHistoryHost] = useState<HTMLSpanElement | null>(null);
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
  const releaseReview = useRef<HTMLDialogElement>(null);
  const releaseHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = releaseReview.current;
    if (review && dialog && !dialog.open) {
      dialog.showModal();
      releaseHeading.current?.focus();
    } else if (!review && dialog?.open) dialog.close();
  }, [review, !!draft]);
  const [pullReview, setPullReview] = useState(false);
  const discardReview = useRef<HTMLDialogElement>(null);
  const discardHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = discardReview.current;
    if (pullReview && dialog && !dialog.open) {
      dialog.showModal();
      discardHeading.current?.focus();
    } else if (!pullReview && dialog?.open) dialog.close();
  }, [pullReview, !!draft]);
  // Side-by-side preview of this screen as published and as edited here, to see what "変更あり" means.
  const [comparing, setComparing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const previewNotice = useRef<HTMLParagraphElement>(null);
  const [previewApplied, setPreviewApplied] = useState(0);
  useEffect(() => {
    if (!previewApplied) return;
    root.current?.focus({ preventScroll: true });
    (previewNotice.current || root.current)?.scrollIntoView({ block: "start" });
  }, [previewApplied]);
  // While the pen shows the captured screen, the live preview below would duplicate it.
  const [penOpen, setPenOpen] = useState(false);
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
      if (cached && active) {
        const updated = shop.published && !cached.pending ? syncPreviewArticleFeatures(cached, shop.published) : cached;
        restore({ ...updated, downloaded: cached.downloaded || cached.source?.pages.map(p => p.id) || [] });
        setIndex(updated === cached ? cached.index : undefined);
      }
      try {
        const [current, remote] = await Promise.all([api<Snapshot>(`/api/shops/${shop.id}/local-editor/shared`), api<EditorIndex>(`/api/shops/${shop.id}/local-editor/index`)]);
        if (!active) return;
        setIndex(remote);
        if (!cached) restore({ ...current, downloaded: [], index: remote, fixtures: sampleFixtures(current.config) });
        else {
          // Build on the draft as it is now: screens chosen while this request was in flight
          // (e.g. a published article added to the fixtures) must not be reverted to the cached copy.
          const local = latestDraft.current || cached;
          if (!local.pending) {
            const updated = syncPreviewArticleFeatures(local, current.config);
            restore({ ...updated, index: remote, downloaded: local.downloaded || local.source?.pages.map(p => p.id) || [], config: { ...updated.config, region: current.config.region, menus: current.config.menus, staff: current.config.staff, hours: current.config.hours, rules: current.config.rules } });
          }
        }
      } catch (e) { if (!cached) throw e; setError(tr("リモートの最新状態を確認できません。ローカル編集は保持しています。更新確認を再試行してください。")); }
    });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    const current = latestDraft.current;
    if (!current || current.pending || !shop.published) return;
    const updated = syncPreviewArticleFeatures(current, shop.published);
    if (updated !== current) { save(updated); setIndex(undefined); }
  }, [key, shop.published?.appearance?.articles?.blogs, shop.published?.appearance?.articles?.announcements]);
  useEffect(() => {
    if (checkedRevision.current === shop.revision) return;
    checkedRevision.current = shop.revision;
    if (!latestDraft.current) return;
    let active = true;
    void api<EditorIndex>(`/api/shops/${shop.id}/local-editor/index`).then(remote => { if (active) setIndex(remote); }).catch(() => { if (active) setError(tr("最新の画面一覧を確認できませんでした。")); });
    return () => { active = false; };
  }, [key, shop.revision]);
  useEffect(() => {
    if (!draft || !index) return;
    let active = true;
    const ids = [...new Set([...draft.config.pages, ...draft.source?.pages || [], ...index.pages].map(p => p.id))];
    void Promise.all([syncStatus(draft, index, { kind: "content" }).then(status => ["content", status] as const), syncStatus(draft, index, { kind: "theme" }).then(status => ["theme", status] as const), ...["header", "footer"].map(part => syncStatus(draft, index, { kind: "part", part: part as "header" | "footer" }).then(status => [`part:${part}`, status] as const)), ...ids.map(id => syncStatus(draft, index, { kind: "page", pageId: id }).then(status => [id, status] as const))]).then(entries => { if (active) setStatuses(Object.fromEntries(entries)); }).catch(() => { if (active) setError(tr("状態の比較に失敗しました。ページを再読み込みしてください。")); });
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
  const mock = useMemo(() => draft ? createPreviewClient(draft.config, draft.fixtures, shop.id, (imageId, view) => api(`/api/shops/${shop.id}/menu-images/${imageId}${view ? `?view=${view}` : ""}`)) : undefined, [draft?.config, draft?.fixtures, shop.id]);
  const session: Session = { demo: false, user: { name: draft?.fixtures.customerName || tr("サンプルのお客様"), email: "sample@example.com", role: "customer", shopId: shop.id } };
  const scope: ReleaseScope = draft?.pending?.scope || (screen.startsWith("page:") ? { kind: "page", pageId: screen.slice(5) } : screen.startsWith("part:") ? { kind: "part", part: screen === "part:footer" ? "footer" : "header" } : screen === "theme" ? { kind: "theme" } : { kind: "content" });
  let releaseConfig = draft?.config;
  try { if (draft) releaseConfig = scopedConfig(draft.source, draft.config, scope); } catch { releaseConfig = undefined; }
  const summary = draft && releaseConfig ? planSummary(draft.source, releaseConfig) : [];
  const selectedPage = draft && scope.kind === "page" ? pageValue(draft.config, scope.pageId) : undefined;
  const allPages = draft ? [...draft.config.pages, ...(index?.pages || []).filter(p => !draft.config.pages.some(local => local.id === p.id)), ...(draft.source?.pages || []).filter(p => !draft.config.pages.some(local => local.id === p.id) && !index?.pages.some(remote => remote.id === p.id))] : [];
  const status = statuses[scope.kind === "page" ? scope.pageId : scope.kind === "part" ? `part:${scope.part}` : scope.kind === "theme" ? "theme" : scope.kind === "content" ? "content" : "shared"];
  // Use the tree's comparison with production, not the order of keys in a cached snapshot.
  const hasChanges = (status === "local" || status === "conflict") && summary.length > 0;
  useEffect(() => {
    if (!draft || !index || busy || conflict || draft.pending?.planId) return;
    const local = scopedSource(draft.config, scope);
    if (draft.pending && !same(scopedSource(draft.pending.config, scope), local)) return;
    if (!draft.pending && same(scopedSource(draft.source, scope), local)) return;
    let active = true;
    // Recompute for this exact draft/index: the status displayed during an edit can
    // still belong to the previous render. Never acknowledge an unverified edit.
    void syncStatus(draft, index, scope).then(current => {
      if (!active || current !== "synced" || latestDraft.current !== draft) return;
      const source = replaceScope(draft.source || draft.config, scope, local);
      const { pending, ...editable } = draft;
      save({ ...editable, source, base: index.base, index });
      if (pending) { setError(""); setNotice(tr("本番と同じ内容のため、反映する変更はありません。")); }
    }).catch(() => { if (active) setError(tr("状態の比較に失敗しました。ページを再読み込みしてください。")); });
    return () => { active = false; };
  }, [draft, index, busy, !!conflict, screen]);
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
    if (!draft || draft.pending) return false;
    const parsed = shopSchema.safeParse(config);
    if (!parsed.success) { setInvalid(parsed.error.issues[0]?.message || tr("お店の情報を確認してください")); return false; }
    setInvalid(""); save({ ...draft, config: parsed.data });
    if (scope.kind === "page") setPageEditing(parsed.data.pages.find(p => p.id === scope.pageId));
    return true;
  }
  function applyDesign(config: ShopConfig) {
    const previous = latestDraft.current?.config;
    if (!changeConfig(config)) return;
    setNotice(same(previous, latestDraft.current?.config)
      ? tr("プレビューは編集内容と同じです。変更はありません。")
      : tr("編集内容をプレビューに反映しました。"));
    setVersion(value => value + 1);
    setPreviewApplied(value => value + 1);
  }
  async function choose(value: string, articleKey?: string, fromLocation = false) {
    if (value.startsWith("part:")) value = "theme";
    const [category, article] = value.split(":");
    if ((category === "blogs" || category === "announcements") && !articleKinds(latestDraft.current?.config).includes(category)) return;
    const firstArticle = latestDraft.current?.fixtures.posts.find(post => post.category === category);
    const requestedArticle = article && (category === "blogs" || category === "announcements") ? articleKey || (firstArticle ? postKey(firstArticle) : undefined) : undefined;
    if (!fromLocation) {
      entrySelected.current = JSON.stringify([value, requestedArticle]);
      if (onScreenChange) onScreenChange(value, requestedArticle); else activate?.();
    }
    const version = ++selectionVersion.current;
    const target: ReleaseScope = value.startsWith("page:") ? { kind: "page", pageId: value.slice(5) } : value.startsWith("part:") ? { kind: "part", part: value === "part:footer" ? "footer" : "header" } : value === "theme" ? { kind: "theme" } : { kind: "content" };
    // Cached screens switch without a network round trip; polling and publication still check remote changes.
    const currentIndex = index;
    const currentDraft = latestDraft.current;
    const currentStatus = currentDraft && currentIndex ? await syncStatus(currentDraft, currentIndex, target) : undefined;
    if (version !== selectionVersion.current) return;
    if (currentStatus === "unfetched" || currentStatus === "remote") await fetchScope(target);
    if (version !== selectionVersion.current) return;
    if (value !== screen || requestedArticle !== route.articleKey) setFixtureEditing(undefined);
    setComparing(false);
    setScreen(value);
    if (currentStatus === "conflict") await compareConflict(target);
    setInvalid("");
    if (value.startsWith("page:")) {
      const page = latestDraft.current?.config.pages.find(p => p.id === value.slice(5)) || currentIndex?.pages.find(p=>p.id===value.slice(5));
      setPageEditing(undefined); setRoute({ pane: "reserve", pageSlug: page?.slug }); setVersion(v => v + 1); return;
    }
    if (target.kind === "part" || value === "theme") { setRoute({ pane: value === "theme" ? "about" : "reserve" }); setVersion(v => v + 1); return; }
    if (category === "blogs" || category === "announcements") {
      if (articleKey && article && !latestDraft.current?.fixtures.posts.some(post => post.category === category && postKey(post) === articleKey)) {
        const snapshot = await api<{ posts: PublicPost[] }>(`/api/shops/${shop.id}/publication-preview`);
        if (version !== selectionVersion.current) return;
        const post = snapshot.posts.find(post => post.category === category && postKey(post) === articleKey);
        if (post && latestDraft.current) {
          const current = latestDraft.current;
          const fixtures = { ...current.fixtures, posts: [...current.fixtures.posts.filter(item => item.category !== category || postKey(item) !== articleKey).slice(0, 49), post] };
          save({ ...current, fixtures }); setFixtureEditing(structuredClone(fixtures));
        } else {
          setScreen(category); setRoute({ category, pane: "reserve" });
          setNotice(tr("選んだ記事は公開内容から見つかりませんでした。一覧から確認してください。"));
          setVersion(v => v + 1); return;
        }
      }
      setRoute({ category, articleKey: requestedArticle, pane: "reserve" });
    } else setRoute({ pane: value });
    setVersion(v => v + 1);
  }
  useEffect(()=>{
    if(!initialScreen||!draft||!index||draft.pending)return;
    const category=initialScreen.split(":")[0];
    if((category==="blogs"||category==="announcements")&&!articleKinds(draft.config).includes(category)){
      onScreenChange?.("reserve");
      void run(async()=>choose("reserve",undefined,true));
      return;
    }
    const selection=JSON.stringify([initialScreen,initialArticleKey]);
    if(entrySelected.current===selection)return;
    entrySelected.current=selection;
    const screens=["part:header","part:footer","theme","reserve","about","mine","contact",...articleKinds(draft.config).flatMap(category=>[category,`${category}:article`]),...index.pages.map(page=>`page:${page.id}`),...draft.config.pages.map(page=>`page:${page.id}`)];
    if(!screens.includes(initialScreen)){setError(tr("指定された画面が見つかりません。画面一覧から選んでください。"));return;}
    void run(async()=>choose(initialScreen,initialArticleKey,true));
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
    const source = (target.kind === "shared" || target.kind === "content") && remote === null ? null : replaceScope(current.source || { ...current.config, pages: [] }, target, remote);
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
  // Keep the local and remote previews at the same position, so the same part of the screen is compared.
  const syncComparisonScroll = useComparisonScroll();
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
    if (!draft.pending && !hasChanges) { setReview(false); return; }
    if (status === "conflict" || status === "remote" || status === "unfetched") throw new Error(tr("先にこの画面のリモート更新を取得するか、競合を解決してください"));
    let next = draft;
    if (!next.pending) {
      next = { ...next, pending: { requestId: createRequestId(), config: structuredClone(next.config), scope } };
      // Save the action identity before the first request so retries remain safe.
      writeDraft(localStorage, key, next); latestDraft.current = next; setDraft(next);
    }
    const pending = next.pending!;
    if (!pending.planId) {
      const plan = await api<{ id: string }>(`/api/shops/${shop.id}/plan`, {
        text: tr("ローカルで確認した画面の変更を反映"), config: pending.config,
        local: { base: next.base, source: next.source, requestId: pending.requestId, scope: pending.scope },
      });
      next = { ...next, pending: { ...pending, planId: plan.id } };
      writeDraft(localStorage, key, next); latestDraft.current = next; setDraft(next);
    }
    const id = next.pending!.planId!;
    await api(`/api/shops/${shop.id}/plans/${id}/approve`, {});
    await api(`/api/shops/${shop.id}/plans/${id}/publish`, {});
    const current = await api<Snapshot>(`/api/shops/${shop.id}/local-editor`);
    const remote = await refreshIndex();
    restore(afterRelease(current, next, next.pending!.scope || scope, remote));
    if (scope.kind === "page" && !current.config.pages.some(p => p.id === scope.pageId)) { setScreen("reserve"); setRoute({ pane: "reserve" }); }
    setNotice(tr("本番に反映しました。"));
    await reload();
  }
  const automaticFetch = useRef("");
  useEffect(() => {
    if (!draft || !index || busy || draft.pending || conflict || !["remote", "unfetched"].includes(status || "")) return;
    const token = scope.kind === "page" ? `${scope.pageId}:${index.pages.find(p => p.id === scope.pageId)?.hash || "deleted"}` : scope.kind === "part" ? `part:${scope.part}:${index.parts[scope.part]}` : scope.kind === "theme" ? `theme:${index.themeHash}` : scope.kind === "content" ? `content:${index.contentHash}` : `shared:${index.sharedHash}`;
    if (automaticFetch.current === token) return;
    automaticFetch.current = token;
    const updated = status === "remote";
    void run(async () => {
      await fetchScope(scope);
      // Only production changed, so it is adopted without asking; say so instead of changing silently.
      if (updated) setNotice(tr("本番で更新された内容を取り込みました。このブラウザに未反映の変更はなかったので、そのまま最新にしました。"));
    });
  }, [status, screen, index, busy, !!draft?.pending, !!conflict]);
  const hideHeader = screen === "theme" ? visibility[screen]?.header === true : visibility[screen]?.header !== false;
  const hideFooter = screen === "theme" ? visibility[screen]?.footer === true : visibility[screen]?.footer !== false;
  const screenPage = scope.kind === "page" ? allPages.find(p => p.id === scope.pageId) : undefined;
  const samples = draft ? fixtureScope(draft.config, screen, route.articleKey, draft.fixtures) : undefined;
  const screenLabel = scope.kind === "page" ? screenPage?.title || tr("ページ") : scope.kind === "part" ? (scope.part === "header" ? tr("ヘッダー") : tr("フッター")) : screen === "theme" ? tr("ページ全体") : ({ reserve: tr("予約"), about: tr("お店のこと"), mine: tr("マイページ"), contact: tr("お問い合わせ"), blogs: tr("ブログ一覧"), "blogs:article": tr("ブログ記事"), announcements: tr("お知らせ一覧"), "announcements:article": tr("お知らせ記事") } as Record<string, string>)[screen] || screen;
  // The exported file that renders this screen, so the pen request names the screen even without marks.
  // Each screen restores only its own design; article screens have none of their own (use the whole-design history).
  const historyTarget = scope.kind === "theme" ? "theme" : scope.kind === "page" ? `page:${scope.pageId}` : scope.kind === "part" ? `part:${scope.part}` : (screenIds as readonly string[]).includes(screen) ? `screen:${screen}` : undefined;
  const screenFile = scope.kind === "page" ? `web/pages/${screenPage?.slug || scope.pageId}.html` : scope.kind === "part" ? `web/parts/${scope.part}.html` : `web/index.html#${screen}`;
  const tree = <ScreenTree draft={draft} index={index} statuses={statuses} selected={active ? screen : ""} disabled={busy || !!draft?.pending || !!conflict} onChoose={value => void run(async () => choose(value))} />;
  return <div className="local-preview preview-first">
    {sidebar ? createPortal(tree, sidebar) : tree}
    <div className="editor-toolbar">
      <div><strong>{screenLabel}</strong>{hasChanges && <span className={`editor-change-badge ${saved ? "" : "unsaved"}`}>{saved ? tr("変更あり") : tr("未保存")}</span>}</div>
      <div className="editor-tools"><span ref={setPenHost} />
        {scope.kind !== "part" && scope.kind !== "theme" && <details ref={displayMenu} className="preview-display-menu"><summary><svg className="editor-action-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 16h18" /></svg>{tr("表示")}</summary><div>
          <label><input type="checkbox" checked={screen === "theme" ? visibility[screen]?.header !== true : visibility[screen]?.header === false} onChange={event => setVisibility(v => ({ ...v, [screen]: { ...v[screen], header: !event.target.checked } }))} />{tr("ヘッダーを表示")}</label>
          <label><input type="checkbox" checked={screen === "theme" ? visibility[screen]?.footer !== true : visibility[screen]?.footer === false} onChange={event => setVisibility(v => ({ ...v, [screen]: { ...v[screen], footer: !event.target.checked } }))} />{tr("フッターを表示")}</label>
          <p>{tr("この画面のプレビューだけに適用")}</p>
        </div></details>}
        <span ref={setHistoryHost} />
      </div>
      {draft && (hasChanges || draft.pending) && <div className="actions">
        <button className="primary" disabled={busy || !saved || !!invalid || !releaseConfig || !index || !status || status === "conflict" || status === "remote" || status === "unfetched" || !!conflict} onClick={() => setReview(true)}>{draft.pending ? tr("反映を再試行") : tr("反映する")}</button>
        {!draft.pending && status === "local" && <button disabled={busy || !!conflict} aria-pressed={comparing} onClick={() => setComparing(value => !value)}>{tr("変更を比較")}</button>}
        <button disabled={busy || !!draft.pending || !!conflict} onClick={() => setPullReview(true)}>{tr("変更を取り消す")}</button>
      </div>}
      {status === "conflict" && !conflict && <button disabled={busy || !!draft?.pending} onClick={() => void run(async () => compareConflict())}>{tr("競合を比較して解決")}</button>}
    </div>
    {historyTarget && <DesignVersionHistory key={historyTarget} target={historyTarget} targetLabel={screenLabel} shopId={shop.id} revision={shop.revision} timeZone={regionOf(shop.published).timeZone} disabled={busy || penOpen || !!draft?.pending} onRestored={async () => {
      await reload();
      const remote = await refreshIndex();
      // A fresh browser could not initialize while the interrupted restore paused the editor APIs.
      if (!latestDraft.current) {
        const current = await api<Snapshot>(`/api/shops/${shop.id}/local-editor/shared`);
        restore({ ...current, downloaded: [], index: remote, fixtures: sampleFixtures(current.config) });
      }
      setError("");
    }} />}
    {error && !review && !pullReview && <p className="alert" role="alert">{error}</p>}
    {notice && <p ref={previewNotice} className="notice small" role="status">{notice}<button className="text-button" onClick={() => setNotice("")} aria-label={tr("通知を閉じる")}>×</button></p>}
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
      <div className="conflict-columns" onScrollCapture={syncComparisonScroll}><div><h3>{tr("ローカル")}</h3><SyncPreview config={conflict.remoteConfig || draft.config} value={conflict.localValue} scope={conflict.scope} fixtures={draft.fixtures} shopId={shop.id} route={route} hideHeader={hideHeader} hideFooter={hideFooter} /></div><div><h3>{tr("リモート")}</h3><SyncPreview config={conflict.remoteConfig || draft.config} value={conflict.remoteValue} scope={conflict.scope} fixtures={draft.fixtures} shopId={shop.id} route={route} hideHeader={hideHeader} hideFooter={hideFooter} /></div></div>
      <div className="actions">
        <button disabled={busy} onClick={() => void run(async () => resolveConflict("local"))}>{tr("ローカルを採用")}</button>
        <button disabled={busy} onClick={() => void run(async () => resolveConflict("remote"))}>{tr("リモートを採用")}</button>
        <button disabled={busy} onClick={() => void run(async () => {
          const proposal = await api<{ value: unknown; explanation: string }>(`/api/shops/${shop.id}/local-editor/merge`, { scope: conflict.scope, baseline: conflict.baseline, localValue: conflict.localValue, expectedRemote: conflict.remoteValue });
          setConflict({ ...conflict, proposed: proposal.value, explanation: proposal.explanation });
        })}>{tr("AIで結合案を作る")}</button>
        <button disabled={busy} onClick={() => setConflict(undefined)}>{tr("比較を閉じる")}</button>
      </div>
      {conflict.proposed !== undefined && <div><h3>{tr("AIの結合案")}</h3><p>{conflict.explanation}</p><SyncPreview config={conflict.remoteConfig || draft.config} value={conflict.proposed} scope={conflict.scope} fixtures={draft.fixtures} shopId={shop.id} route={route} hideHeader={hideHeader} hideFooter={hideFooter} /><button className="primary" disabled={busy} onClick={() => void run(async () => resolveConflict("merged"))}>{tr("結合案をローカルに採用")}</button></div>}
    </section>}
    {comparing && status === "local" && draft && !conflict && !draft.pending && <section className="panel conflict-dialog" aria-label={tr("変更内容の比較")}>
      <h2>{tr("変更内容の比較")}</h2><p>{tr("編集後と反映前を、同じ画面・同じサンプルデータで比較します。比較しても何も変更しません。")}</p>
      {summary.length > 0 && <ul className="check-list">{summary.map(item => <li key={item}>{item}</li>)}</ul>}
      {/* Apply each side to the same context: business settings and other parts are not this edit. */}
      <div className="conflict-columns" onScrollCapture={syncComparisonScroll}><div><h3>{tr("ローカル（編集後）")}</h3><SyncPreview config={draft.config} value={scopedSource(draft.config, scope)} scope={scope} fixtures={draft.fixtures} shopId={shop.id} route={route} hideHeader={hideHeader} hideFooter={hideFooter} /></div><div><h3>{tr("本番（反映前）")}</h3><SyncPreview config={draft.config} value={scopedSource(draft.source, scope)} scope={scope} fixtures={draft.fixtures} shopId={shop.id} route={route} hideHeader={hideHeader} hideFooter={hideFooter} /></div></div>
      <div className="actions"><button onClick={() => setComparing(false)}>{tr("比較を閉じる")}</button></div>
    </section>}
    {draft && !(comparing && status === "local") && <>
      {!draft.pending && !invalid && !conflict && (scope.kind !== "page" || selectedPage) && <VisualRequest key={screen} disabled={busy} shopId={shop.id} config={draft.config} root={root} triggerHost={penHost} historyHost={historyHost} onBusyChange={setBusy} onActiveChange={setPenOpen} screen={{ id: screen, label: screenLabel, file: screenFile }} reviewPreview={{ fixtures: draft.fixtures, hideHeader, hideFooter, articleKey: route.articleKey }} renderPreview={config => <SyncPreview config={config} value={scopedSource(config, scope)} scope={scope} fixtures={draft.fixtures} shopId={shop.id} route={route} hideHeader={hideHeader} hideFooter={hideFooter} />} local={{ base: draft.base, source: draft.source, theme: scope.kind === "theme", pageId: scope.kind === "page" ? scope.pageId : undefined, part: scope.kind === "part" ? scope.part : undefined }} onLocalChange={config => { changeConfig(config); setNotice(tr("ペンの変更をローカルに保存しました。本番に反映する前に画面を確認してください。")); }} />}    </>}
    {draft && mock && !conflict && !(comparing && status === "local") && <>
      {scope.kind === "page" && !selectedPage ? <p className="panel">{status === "unfetched" ? tr("ページを自動で読み込んでいます。") : tr("削除予定のページはプレビューに表示しません。")}</p> : <div ref={root} tabIndex={-1} role="region" aria-label={tr("プレビュー")} hidden={penOpen} className="local-preview-screen" onClickCapture={e => {
        const link = (e.target as HTMLElement).closest("a");
        if (link && !link.getAttribute("href")?.startsWith("/s/local-preview")) {
          e.preventDefault(); e.stopPropagation();
          setNotice(tr("リンク先は試す画面では開きません。サイドバーの画面ツリーから選択してください。"));
        }
      }}>
        {scope.kind === "theme" ? <ThemePreview config={draft.config} shopId={shop.id} /> : scope.kind === "part" ? <ChromePreview config={draft.config} part={scope.part} imageBase={`/api/shops/${shop.id}/images`} /> : <ApiProvider value={mock}>
          <PublicShop key={`${version}-${JSON.stringify(route)}-${JSON.stringify(draft.config)}`} session={session} slug="local-preview" search="" initialPane={route.pane} onPaneChange={pane => void run(async () => choose(pane))} pageSlug={scope.kind === "page" ? selectedPage?.slug : route.pageSlug} category={route.category} articleKey={route.articleKey} hideHeader={hideHeader} hideFooter={hideFooter} busy={busy} run={run} notify={setNotice} navigate={href => {
            const url = new URL(href, location.origin);
            const match = url.pathname.match(/^\/s\/local-preview\/(blogs|announcements)(?:\/([^/]+))?$/);
            const pageMatch = url.pathname.match(/^\/s\/local-preview\/pages\/([^/]+)$/);
            if (pageMatch) { const page = draft.config.pages.find(p => p.slug === pageMatch[1]); if (page) void run(async () => choose(`page:${page.id}`)); return; }
            if (match) void run(async () => choose(`${match[1]}${match[2] ? ":article" : ""}`, match[2]));
            else void run(async () => choose(url.searchParams.get("pane") || "reserve"));
          }} />
        </ApiProvider>}
      </div>}
    </>}    {draft && !conflict && <div className="panel editor-secondary">
      {scope.kind === "part" && <details key={`part:${scope.part}`}><summary>{scope.part === "header" ? tr("ヘッダー") : tr("フッター")}{tr("の内容を編集")}</summary><fieldset disabled={busy || !!draft.pending}><ChromeEditor config={draft.config} part={scope.part} shopId={shop.id} onChange={changeConfig} /></fieldset></details>}
      {(scope.kind === "shared" || scope.kind === "content") && (screenIds as readonly string[]).includes(screen) && <details key={`screen:${screen}`}><summary>{tr("この画面の HTML を編集")}</summary><fieldset disabled={busy || !!draft.pending}><ScreenDesignEditor key={`${screen}:${draft.config.screens?.[screen as ScreenId]?.html || ""}`} config={draft.config} screen={screen as ScreenId} shopId={shop.id} onChange={applyDesign} /></fieldset></details>}
      {scope.kind === "part" && <details key={`part-html:${scope.part}`}><summary>{scope.part === "header" ? tr("ヘッダーの HTML を編集") : tr("フッターの HTML を編集")}</summary><fieldset disabled={busy || !!draft.pending}><ThemeDesignEditor key={JSON.stringify([scope.part, (draft.config.appearance?.theme || standardTheme)[themeHtmlKey(scope.part)], draft.config.appearance?.theme?.[`${scope.part}Css`]])} part={scope.part} config={draft.config} shopId={shop.id} onChange={applyDesign} openFrame={() => void run(async () => choose("theme"))} /></fieldset></details>}
      {screen === "theme" && <details><summary>{tr("ページ全体の HTML を編集")}</summary><fieldset disabled={busy || !!draft.pending}><WholeThemeDesignEditor key={JSON.stringify(draft.config.appearance?.theme)} config={draft.config} shopId={shop.id} onChange={applyDesign} /></fieldset></details>}
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
        {samples && hasFixtureFields(samples) && (!samples.articleBody || fixturePostEntries(draft.fixtures, samples).length > 0) && <details key={`fixtures:${screen}:${route.articleKey || ""}`}><summary>{tr("サンプルデータを編集")}</summary>
          <p>{tr("この画面で使うサンプルだけを編集します。サンプルデータと練習中の操作は本番に反映しません。")}</p>
          <fieldset disabled={busy || !!draft.pending || !!conflict}><FixtureEditor config={draft.config} value={fixtureEditing || draft.fixtures} onChange={setFixtureEditing} scope={samples} /></fieldset>
          <div className="actions">
            <button className="primary" disabled={busy || !!draft.pending || !!conflict} onClick={() => void run(async () => {
              const fixtures = fixturesSchema.parse(fixtureEditing || draft.fixtures);
              if (samples.bookings && fixtures.bookings.some(b => !bookingStaff(draft.config).some(s => s.id === b.staffId) || !draft.config.menus.some(m => m.id === b.menuId) || !bookingStaff(draft.config).some(s => s.id === b.staffId && s.menuIds.includes(b.menuId)))) throw new Error(tr("サンプル予約のメニュー・担当者を確認してください"));
              const articleIndex = samples.articleBody ? fixturePostEntries(draft.fixtures, samples)[0]?.index : undefined;
              save({ ...draft, fixtures });
              await choose(screen, articleIndex === undefined ? route.articleKey : postKey(fixtures.posts[articleIndex]));
              setNotice(tr("サンプルデータを保存しました。"));
            })}>{tr("サンプルをプレビューに反映")}</button>
          </div>
        </details>}
        {!!draft.backups?.length && <details><summary>{tr("競合解決前の控え")}</summary>{draft.backups.map((backup, i) => <p key={`${backup.at}-${i}`}>{backup.at} <button disabled={busy || !!draft.pending || !!conflict} onClick={() => void run(async () => {
          const config = replaceScope(draft.config, backup.scope, backup.localValue);
          const source = backup.baseline === null && backup.scope.kind === "shared" ? null : replaceScope(draft.source || draft.config, backup.scope, backup.baseline);
          const next = { ...draft, config, source }; writeDraft(localStorage, key, next); restore(next); setNotice(tr("競合解決前のローカル編集を復元しました。"));
        })}>{tr("この時点のローカルを復元")}</button></p>)}</details>}
      <details><summary>{tr("保存と同期について")}</summary><p>{tr("編集はこのブラウザだけに保存され、サイトデータを消すと失われます。画面は開くと必要な内容を自動で読み込みます。変更がある画面だけツリーに印を付けます。両側に変更があればプレビューを比較して解決してください。料金・勤務などの本番データは各管理メニューの保存で反映します。練習用の予約や問い合わせは本番には保存せず、Google Calendar にも接続しません。")}</p></details>
    </div>}
    {draft && createPortal(<dialog ref={discardReview} className="editor-release-dialog" aria-label={tr("この画面の変更を取り消す")} onClose={() => setPullReview(false)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <h3 ref={discardHeading} tabIndex={-1}>{tr("この画面の変更を取り消す")}</h3>
      <p><strong>{screenLabel}</strong></p>
      <p>{tr("この画面のローカル変更を取り消します。他の画面の編集とサンプルデータは保持します。")}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {busy && <p className="notice" role="status">{tr("変更を取り消しています…")}</p>}
      <div className="actions editor-release-actions">
      <button disabled={busy} onClick={() => void run(async () => { const latest = await remoteValue(scope); await adopt(scope, latest, latest, true); setPullReview(false); setNotice(tr("この画面の変更を取り消しました。")); })}>{tr("この画面の変更を取り消す")}</button>
      <button disabled={busy} onClick={() => setPullReview(false)}>{tr("戻る")}</button>
      </div>
    </dialog>, document.body)}
    {draft && createPortal(<dialog ref={releaseReview} className="editor-release-dialog" aria-label={tr("本番への反映内容")} onClose={() => setReview(false)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <h3 ref={releaseHeading} tabIndex={-1}>{tr("本番への反映内容：")}{scope.kind === "page" ? allPages.find(p => p.id === scope.pageId)?.title || tr("ページ削除") : scope.kind === "part" ? (scope.part === "header" ? tr("ヘッダー") : tr("フッター")) : screen === "theme" ? tr("ページ全体") : tr("お店の共通設定")}</h3><ul>{summary.map(s => <li key={s}>{s}</li>)}</ul>
      <details><summary>{tr("設定の変更前と変更後")}</summary><div className="local-diff"><pre>{JSON.stringify(draft.source, null, 2)}</pre><pre>{JSON.stringify(draft.config, null, 2)}</pre></div></details>
      <p>{tr("選んだページ（または共通設定）だけを本番に反映します。他のページのローカル編集と、サンプルデータは含みません。")}</p>
      {error && <p className="alert" role="alert">{error}</p>}
      {busy && <p className="notice" role="status">{tr("本番に反映しています…このままお待ちください。")}</p>}
      <div className="actions editor-release-actions">
      <button className="primary" disabled={busy || !saved || (!draft.pending && !hasChanges)} onClick={() => void run(release)}>{tr("この内容を本番に反映")}</button>
      <button disabled={busy} onClick={() => setReview(false)}>{tr("戻る")}</button>
      </div>
    </dialog>, document.body)}
  </div>;
}
