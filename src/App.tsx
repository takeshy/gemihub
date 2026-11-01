import { BlogEditor, PublicBlog, RecentPosts, type Navigate } from "./Blog";
import type { PostCategory, PostSummary } from "../server/post-domain";
import { DataManagement } from "./DataManagement";
import { DataOverview } from "./DataOverview";
import { ShopOverview } from "./ShopOverview";
import { ShopRequest } from "./ShopRequest";
import { VisualRequest } from "./VisualRequest";
import { SiteHeader, SiteFooter } from "./SiteChrome";
import { CustomPage } from "./CustomPage";
import { LiveSettings } from "./LiveSettings";
import { PageBuilder } from "./PageBuilder";
import { LocalPreview, type LocalEditorHandle } from "./LocalPreview";
import { Manual } from "./Manual";
import { MenuImage, MenuImageEditor } from "./MenuImage";
import { Customers } from "./Customers";
import { createRequestId } from "./request-id";
import React, { useEffect, useState, useRef } from "react";
import { useApi } from "./api";
import type { ShopConfig, Booking } from "../server/domain";
import { sample } from "../server/domain";
import type { Shop, User } from "../server/store";
import "./style.css";
export type Plan = {
  id: string;
  config: ShopConfig;
  summary: string[];
  approved: boolean;
  base: number;
};
export type Inquiry = {
  id: string;
  name: string;
  email: string;
  message: string;
  reply: string;
  status: string;
  at?: string;
};
export type Workspace = Shop & {
  isOwner: boolean;
  plans: Plan[];
  bookings: Booking[];
  inquiries: Inquiry[];
  members: { email: string; accepted: boolean; status?: string }[];
  jobs: { type: string; error?: string }[];
  publicUrl: string;
};
export type Session = { user: User | null; demo: boolean; hosted?: string };
const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const when = (s: string) =>
  new Date(s).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const localDate = () =>
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
function Brand() {
  return (
    <a href="/" className="brand">
      <span className="brand-icon">
        o<span>✳</span>
      </span>
      omaiweb<span className="brand-dot">.</span>
    </a>
  );
}
export type AppProps = {
  path?: string;
  search?: string;
  initialTab?: string;
  initialPane?: string;
  navigate?: Navigate;
};
export function App({
  path = location.pathname,
  search = location.search,
  initialTab = new URLSearchParams(search).has("customer") ? "customers" : new URLSearchParams(search).get("calendar") === "connected" ? "team" : "try",
  initialPane = "mine",
  navigate = (href) => location.assign(href),
}: AppProps = {}) {
  const api = useApi();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = () => api<Session>("/api/session").then(setSession);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const logout = () =>
    run(async () => {
      await api("/api/logout", {});
      location.href = "/";
    });
  if (!session)
    return <div className="loading">{error || "お店の準備をしています…"}</div>;
  const match = path.match(
    /^\/(s|preview)\/([^/]+)(?:\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?)?$/,
  );
  const hostedPost = session.hosted
    ? path.match(/^\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?$/)
    : null;
  const isPublic = !!match || !!session.hosted;
  return (
    <>
      {!isPublic && <header>
        <Brand />
        <div className="header-right">
          <span className="small muted">
            {session.user?.name || "あなたのお店を、あなたの言葉で。"}
          </span>
          {!isPublic && (
            <a className="text-button" href="/manual">
              使い方
            </a>
          )}
          {session.user && (
            <button className="text-button" onClick={logout}>
              ログアウト
            </button>
          )}
        </div>
      </header>}
      <main>
        {session.demo && (
          <div className="demo-banner">
            デモモード · Google には接続せず、サンプルで動作を確認できます。
          </div>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="エラーを閉じる">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {path === "/manual" && !isPublic ? (
          <Manual />
        ) : isPublic ? (
          <PublicShop
            session={session}
            search={search}
            initialPane={
              (["reserve", "about", "mine", "contact"].includes(
                new URLSearchParams(search).get("pane") || "",
              )
                ? new URLSearchParams(search).get("pane")
                : match?.[1] === "preview" ? "reserve" : initialPane)!
            }
            pageSlug={(match?.[3] || hostedPost?.[1]) === "pages" ? match?.[4] || hostedPost?.[2] : undefined}
            category={
              ((match?.[3] || hostedPost?.[1]) === "pages" ? undefined : match?.[3] || hostedPost?.[1]) as PostCategory | undefined
            }
            articleKey={match?.[4] || hostedPost?.[2]}
            navigate={navigate}
            slug={session.hosted || match![2]}
            preview={match?.[1] === "preview"}
            run={run}
            busy={busy}
            notify={setNotice}
          />
        ) : session.user ? (
          <Dashboard
            initialTab={initialTab}
            initialCustomer={new URLSearchParams(search).get("customer") || ""}
            initialCustomerImages={new URLSearchParams(search).get("customerView") === "images"}
            session={session}
            run={run}
            busy={busy}
            notify={setNotice}
          />
        ) : (
          <Landing demo={session.demo} run={run} />
        )}
      </main>
      {!isPublic && <footer>
        <span>omaiweb — Oh my web.</span>
        <span>データも、仕様も、あなたの手の中に。</span>
      </footer>}
      {busy && (
        <div className="busy" role="status">
          処理しています…
        </div>
      )}
    </>
  );
}
type Run = (fn: () => Promise<void>) => Promise<void>;
function Landing({ demo, run }: { demo: boolean; run: Run }) {
  const api = useApi();
  return (
    <div className="landing">
      <div className="eyebrow">小さなお店に、ぴったりの予約システム。</div>
      <h1>
        お店のことを話す。
        <br />
        予約の仕組みが、<em>できあがる。</em>
      </h1>
      <p className="lead">
        メニューも、営業時間も、いつもの言葉で。
        <br />
        あなたのお店のルールに合う予約ページを、一緒に作ります。
      </p>
      <a className="button primary" href="/auth/google">
        G　Google でお店をはじめる <span>↗</span>
      </a>
      {demo && (
        <button
          className="button"
          onClick={() =>
            run(async () => {
              await api("/api/demo-login", { role: "owner" });
              location.reload();
            })
          }
        >
          サロンのデモを試す →
        </button>
      )}
      <div className="hero-card">
        <span className="pill">あなたの言葉が、はじまり。</span>
        <div className="chat-message">
          夫婦で営む、小さなネイルサロンです。
          <br />
          火曜日はお休み。指名なしでも予約できるようにしたい。
        </div>
        <div className="chat-answer">
          <span>✳</span>
          <p>
            お二人のどちらかが空いていれば予約できる、
            <br />
            お店専用の仕組みをご提案します。
          </p>
        </div>
        <div className="flow">
          <span>01 話す</span>
          <span>02 確かめる</span>
          <span>03 公開する</span>
        </div>
      </div>
      <div className="values">
        <div>
          <b>あなたのお店に合わせる</b>
          <p>メニュー、スタッフ、予約のルールまで。</p>
        </div>
        <div>
          <b>公開したあとも、言葉で</b>
          <p>変更内容を確認してから、お店に反映。</p>
        </div>
        <div>
          <b>データは、あなたのもの</b>
          <p>Google スプレッドシートでいつでも確認。</p>
        </div>
      </div>
    </div>
  );
}
function Dashboard({
  initialTab = "try",
  initialCustomer = "",
  initialCustomerImages = false,
  session,
  run,
  busy,
  notify,
}: {
  initialTab?: string;
  initialCustomer?: string;
  initialCustomerImages?: boolean;
  session: Session;
  run: Run;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const api = useApi();
  const [shops, setShops] = useState<Workspace[]>([]);
  const [chosen, setChosen] = useState(() => new URLSearchParams(location.search).get("shop") || "");
  const [tab, setTab] = useState(initialTab);
  const [treeHost, setTreeHost] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<LocalEditorHandle>(null);
  const buildReview = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<Plan>();
  const [edit, setEdit] = useState<ShopConfig>();
  const [invites, setInvites] = useState<{ shopId: string; name: string }[]>(
    [],
  );
  async function load() {
    const [w, i] = await Promise.all([
      api<{ shops: Workspace[] }>("/api/workspace"),
      api<{ shopId: string; name: string }[]>("/api/invitations"),
    ]);
    setShops(w.shops);
    setInvites(i);
    return w.shops;
  }
  useEffect(() => {
    run(async () => {
      await load();
    });
  }, []);
  const shop = shops.find((s) => s.id === chosen) || shops[0];
  useEffect(() => { if (shop && !shop.isOwner && ["try", "create-page", "data"].includes(tab)) setTab("bookings"); }, [shop?.id, shop?.isOwner, tab]);
  const activePlan =
    plan && plan.base === shop?.revision && shop.plans.some((p) => p.id === plan.id)
      ? plan
      : shop?.plans.find(p => p.base === shop.revision && p.id === new URLSearchParams(location.search).get("plan")) || shop?.plans.filter((p) => p.base === shop.revision).at(-1);
  const request = (action: string, data: unknown = {}) =>
    api(`/api/shops/${shop.id}/${action}`, data);
  const generate = () =>
    run(async () => {
      const p = await api<Plan>(`/api/shops/${shop.id}/plan`, {
        text: "入力したお店の情報で作成",
        ...(edit ? { config: edit } : {}),
      });
      setPlan(p);
      setEdit(undefined);
      await load();
      notify("プランができました。内容を確認してから承認してください。");
    });
  return (
    <div className="dashboard">
      <aside>
        <div className="sidebar-label">MY SHOP</div>
        <div className="shop-switch">
          <span className="shop-avatar">✳</span>
          <strong>{shop?.published?.name || "わたしのお店"}</strong>
        </div>
        {shops.length > 1 && (
          <select
            value={shop?.id}
            onChange={(e) => {
              setChosen(e.target.value);
              setPlan(undefined);
              setEdit(undefined);
            }}
          >
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.published?.name || s.slug}
              </option>
            ))}
          </select>
        )}
        <nav>
          {[
            ["build", "✧", "お店をつくる・直す"],
            ...(shop?.isOwner ? [["try", "▣", "画面を試す・編集"], ["create-page", "＋", "ページをつくる"]] : []),
            ["bookings", "▦", "予約を管理"],
            ...(shop ? [["customers", "♧", "お客様"]] : []),
            ...(shop?.isOwner ? [["basic", "⌂", "お店の基本情報"], ["menus", "≡", "メニュー・料金"], ["staff", "♧", "スタッフ・勤務"], ["hours", "◷", "営業時間・休業日"], ["rules", "⚙", "予約ルール"]] : []),
            ["inquiries", "✉", "お問い合わせ"],
            ["blog", "✎", "ブログ・お知らせ"],
            ["team", "♧", "家族・スタッフ"],
            ...(shop?.isOwner ? [["data", "▤", "データ管理"]] : []),
            ["settings", "⚙", "公開の設定"],
            ["manual", "?", "使い方"],
          ].map(([id, icon, label]) => (
            <React.Fragment key={id}><button
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <span>{icon}</span>
              {label}
            </button>{id === "try" && <div className="sidebar-editor-tree" ref={setTreeHost} />}</React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <i className={shop?.published ? "online" : ""} />
          {shop?.published ? "予約ページを公開中" : "公開前の準備中"}
          <p>
            まずは、お店のことを
            <br />
            聞かせてください。
          </p>
        </div>
      </aside>
      <section className="workspace">
        {invites.map((i) => (
          <div className="notice" key={i.shopId}>
            {i.name} の運営に招待されています。
            <button
              onClick={() =>
                run(async () => {
                  await api(`/api/invitations/${i.shopId}/accept`, {});
                  setChosen(i.shopId);
                  await load();
                })
              }
            >
              招待を承諾
            </button>
          </div>
        ))}
        {!shop ? (
          <p>
            運営できるお店はありません。招待された Google
            アカウントでログインしてください。
          </p>
        ) : (
          <>
            {tab === "manual" ? (
              <Manual />
            ) : (
              <>
                {shop.publishingPlanId && (
                  <div className="alert">
                    保存・反映が未完了です。予約受付を一時停止しています。操作した管理画面から再試行してください。
                  </div>
                )}
                {shop.jobs.length > 0 && (
                  <div className="alert">
                    Google 連携に未処理が {shop.jobs.length}{" "}
                    件あります。予約は保存されています。
                    <button
                      onClick={() =>
                        run(async () => {
                          await request("retry");
                          await load();
                        })
                      }
                    >
                      再送する
                    </button>
                    {shop.jobs.some((j) => j.error) && (
                      <p className="small">
                        {shop.jobs.find((j) => j.error)?.error}
                      </p>
                    )}
                  </div>
                )}
                {tab === "build" && (
                  <>
                    {shop.published && <ShopOverview key={`${shop.id}-${shop.revision}`} shopId={shop.id} google={shop.google} isOwner={shop.isOwner} open={setTab} plan={activePlan} onAccept={async p => { await request(`plans/${p.id}/approve`); setPlan({ ...p, approved: true }); await load(); requestAnimationFrame(() => buildReview.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }} onPlan={async (text, context) => {
                      const p = await api<Plan>(`/api/shops/${shop.id}/plan`, { text, context });
                      setPlan(p); setEdit(undefined); await load(); return p;
                    }} />}
                    {!shop.published && <div className="steps">
                      {["お店の情報", "プランを確認", "プレビュー", "公開"].map(
                        (s, i) => (
                          <div
                            className={
                              (i === 0 && !activePlan) ||
                              (i === 1 && activePlan && !activePlan.approved) ||
                              (i === 2 && activePlan?.approved) ||
                              (i === 3 && shop.published && !activePlan)
                                ? "current"
                                : ""
                            }
                            key={s}
                          >
                            <span>0{i + 1}</span>
                            {s}
                          </div>
                        ),
                      )}
                    </div>}
                    <div ref={buildReview} className={shop.published ? "build-plan-area" : "build-grid"}>
                      <div>
                        {!shop.published && <div className="panel interview"><h2>どんなお店をつくりますか？</h2><ShopRequest shopId={shop.id} published={false} isOwner={shop.isOwner} plan={activePlan} onPlan={async text => { const p = await api<Plan>(`/api/shops/${shop.id}/plan`, { text }); setPlan(p); await load(); return p; }} onAccept={async p => { await request(`plans/${p.id}/approve`); setPlan({ ...p, approved: true }); await load(); }} /><button disabled={!shop.isOwner} onClick={() => setEdit(structuredClone(sample))}>項目ごとに入力・修正</button></div>}
                        {edit && (
                          <div className="panel">
                            <h2>お店の情報</h2>
                            <ConfigEditor config={edit} onChange={setEdit} shopId={shop.id} />
                            <button
                              className="primary"
                              onClick={generate}
                              disabled={busy}
                            >
                              この内容でプランを確認 →
                            </button>
                          </div>
                        )}
                        {activePlan?.approved && (
                          <div className="panel plan">
                            <span className="pill">
                              {activePlan.approved ? "承認済み" : "ご提案"}
                            </span>
                            <h2>こんな予約システムをつくります。</h2>
                            <ul className="check-list">
                              {activePlan.summary.map((s) => (
                                <li key={s}>
                                  ✓ <span>{s}</span>
                                </li>
                              ))}
                            </ul>
                            <ConfigSummary config={activePlan.config} />
                            <details>
                              <summary>すべての設定を確認</summary>
                              <pre>
                                {JSON.stringify(activePlan.config, null, 2)}
                              </pre>
                            </details>
                            <div className="actions">
                              <button
                                onClick={() => {
                                  setEdit(structuredClone(activePlan.config));
                                  setPlan(undefined);
                                }}
                              >
                                内容を修正する
                              </button>
                              {!activePlan.approved ? (
                                <button
                                  className="primary"
                                  disabled={busy || !shop.isOwner}
                                  onClick={() =>
                                    run(async () => {
                                      await request(
                                        `plans/${activePlan.id}/approve`,
                                      );
                                      setPlan({
                                        ...activePlan,
                                        approved: true,
                                      });
                                      await load();
                                      notify(
                                        "承認しました。公開前にプレビューでお確かめください。",
                                      );
                                    })
                                  }
                                >
                                  このプランでつくる →
                                </button>
                              ) : (
                                <>
                                  <a
                                    className="button"
                                    href={`/preview/${shop.id}?plan=${activePlan.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    プレビュー ↗
                                  </a>
                                  <button
                                    className="primary"
                                    disabled={busy || !shop.isOwner}
                                    onClick={() =>
                                      run(async () => {
                                        await request(
                                          `plans/${activePlan.id}/publish`,
                                        );
                                        setPlan(undefined);
                                        await load();
                                        notify(
                                          "予約ページを公開しました。お客様の予約を受け付けられます。",
                                        );
                                      })
                                    }
                                  >
                                    お店のページを公開 →
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {!shop.published && <div className="right-column">
                        <div className="panel guide">
                          <div className="line-flower">✳</div>
                          <h2>
                            お店に合わせて、
                            <br />
                            少しずつ。
                          </h2>
                          <p>
                            最初から完璧でなくても大丈夫。
                            <br />
                            プランを確かめて、試してから公開。
                            <br />
                            あとから何度でも直せます。
                          </p>
                          <hr />
                          <b>データは、あなたのもの。</b>
                          <p className="small">
                            予約はあなたの Google
                            スプレッドシートに。お店の仕様と変更履歴も、あなたのドライブに残ります。
                          </p>
                        </div>
                        <div className="small muted tip">
                          ☀ プレビューでの予約は練習用です。
                          <br />
                          実際の予約には影響しません。
                        </div>
                      </div>}
                    </div>
                    {!shop.published && <DataOverview isOwner={shop.isOwner} google={shop.google} open={setTab} />}
                  </>
                )}
                {["basic", "menus", "staff", "hours", "rules"].includes(tab) && shop.isOwner && <LiveSettings key={`${shop.id}-${tab}`} shop={shop} section={tab as "basic" | "menus" | "staff" | "hours" | "rules"} reload={load} />}
                {tab === "create-page" && shop.isOwner && <PageBuilder key={shop.id} shopId={shop.id} email={session.user!.email} onAdd={page => { if (!editorRef.current) throw new Error("画面の読み込みが完了するまでお待ちください"); editorRef.current.addPage(page); setTab("try"); }} />}
                {tab === "bookings" && (
                  <Reservations shop={shop} run={run} reload={load} />
                )}
                {tab === "customers" && <Customers key={shop.id} shopId={shop.id} config={shop.published} initialEmail={initialCustomer} initialImages={initialCustomerImages} />}
                {tab === "blog" && (
                  <BlogEditor
                    shop={shop}
                    run={run}
                    busy={busy}
                    notify={notify}
                    reload={load}
                    demo={session.demo}
                  />
                )}
                {tab === "inquiries" && (
                  <div className="panel">
                    <h2>お問い合わせ</h2>
                    {!shop.inquiries.length && (
                      <Empty text="まだお問い合わせはありません。" />
                    )}
                    {shop.inquiries.map((q) => (
                      <InquiryCard
                        key={q.id}
                        q={q}
                        send={(text) =>
                          run(async () => {
                            await request(`inquiries/${q.id}/reply`, { text });
                            await load();
                            notify("返信を受け付けました。");
                          })
                        }
                      />
                    ))}
                  </div>
                )}
                {tab === "team" && <Team shop={shop} run={run} reload={load} />}
                {tab === "data" && shop.isOwner && <DataManagement key={shop.id} shopId={shop.id} open={setTab} />}
                {tab === "settings" && (
                  <Settings shop={shop} run={run} reload={load} />
                )}
              </>
            )}
          </>
        )}
        {shop?.isOwner && <div hidden={tab !== "try"}><LocalPreview key={shop.id} shop={shop} email={session.user!.email} reload={load} sidebar={treeHost} activate={() => setTab("try")} actionsRef={editorRef} /></div>}
      </section>
    </div>
  );
}
export function ConfigSummary({ config: c }: { config: ShopConfig }) {
  return (
    <div className="config-summary">
      <h3>{c.name}</h3>
      <p>{c.description}</p>
      <div className="summary-grid">
        <div>
          <span>営業時間</span>
          <b>
            {c.hours.start} – {c.hours.end}
          </b>
        </div>
        <div>
          <span>定休日</span>
          <b>
            {c.hours.closedWeekdays.map((d) => weekdays[d]).join("・") ||
              "なし"}
          </b>
        </div>
        <div>
          <span>予約の受け方</span>
          <b>
            お客様が指名・指名なしを選ぶ
          </b>
        </div>
        <div>
          <span>通知先</span>
          <b>{c.notificationEmail}</b>
        </div>
      </div>
      {c.menus
        .filter((m) => m.active)
        .map((m) => (
          <div className="menu-row" key={m.id}>
            <span>
              {m.name} <small>{m.duration}分</small>
            </span>
            <b>{yen(m.price)}</b>
          </div>
        ))}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function ConfigEditor({
  config: c,
  onChange: set,
  section,
  shopId,
  onImageUploading,
}: {
  config: ShopConfig;
  shopId?: string;
  onImageUploading?: (busy: boolean) => void;
  section?: "basic" | "profile" | "menus" | "staff" | "hours" | "rules";
  onChange: (c: ShopConfig) => void;
}) {
  const put = <K extends keyof ShopConfig>(k: K, v: ShopConfig[K]) =>
    set({ ...c, [k]: v });
  return (
    <div className="editor">
      {(!section || section === "profile" || section === "basic") && <>
      <div className="form-grid">
        <Field label="店名">
          <input value={c.name} onChange={(e) => put("name", e.target.value)} />
        </Field>
        <Field label="業種">
          <select
            value={c.industry}
            onChange={(e) =>
              put("industry", e.target.value as ShopConfig["industry"])
            }
          >
            <option value="nail">ネイルサロン</option>
            <option value="hair">美容室</option>
            <option value="other">その他</option>
          </select>
        </Field>
      </div>
      <Field label="お店の紹介">
        <textarea
          value={c.description}
          onChange={(e) => put("description", e.target.value)}
        />
      </Field>
      <Field label="住所・アクセス">
        <input
          value={c.address}
          onChange={(e) => put("address", e.target.value)}
        />
      </Field>
      <Field label="通知メールの宛先">
        <input
          type="email"
          value={c.notificationEmail}
          onChange={(e) => put("notificationEmail", e.target.value)}
        />
      </Field>
      </>}
      {(!section || section === "menus") && <>
      <h3>メニュー</h3>
      {c.menus.map((m, i) => (
        <div className="menu-edit-block" key={m.id}><div className="edit-row">
          <input
            aria-label="メニュー名"
            value={m.name}
            onChange={(e) =>
              put(
                "menus",
                c.menus.map((v, j) =>
                  j === i ? { ...v, name: e.target.value } : v,
                ),
              )
            }
          />
          <Field label="所要時間（分）">
            <input
              type="number"
              min="15"
              value={m.duration}
              onChange={(e) =>
                put(
                  "menus",
                  c.menus.map((v, j) =>
                    j === i ? { ...v, duration: +e.target.value } : v,
                  ),
                )
              }
            />
          </Field>
          <Field label="料金（円）">
            <input
              type="number"
              min="0"
              value={m.price}
              onChange={(e) =>
                put(
                  "menus",
                  c.menus.map((v, j) =>
                    j === i ? { ...v, price: +e.target.value } : v,
                  ),
                )
              }
            />
          </Field>
          <label>
            <input
              type="checkbox"
              checked={m.active}
              onChange={(e) =>
                put(
                  "menus",
                  c.menus.map((v, j) =>
                    j === i ? { ...v, active: e.target.checked } : v,
                  ),
                )
              }
            />
            有効
          </label>
        </div>{shopId && <MenuImageEditor shopId={shopId} imageId={m.imageId} name={m.name} uploading={onImageUploading} change={imageId => put("menus", c.menus.map((menu, index) => index === i ? { ...menu, imageId } : menu))} />}</div>
      ))}
      <button
        onClick={() =>
          put("menus", [
            ...c.menus,
            {
              id: `menu-${Date.now()}`,
              name: "新しいコース",
              duration: 60,
              price: 5000,
              active: section === "menus" ? false : true,
            },
          ])
        }
      >
        ＋ メニューを追加
      </button>
      </>}
      {(!section || section === "profile") && <>
      <h3>ページの見た目</h3>
      <div className="form-grid">
        <Field label="色"><select value={c.appearance?.accent || "sage"} onChange={e => put("appearance", {...(c.appearance || {accent: "sage", layout: "standard", imageUrl: ""}), accent: e.target.value as "sage" | "rose" | "navy"})}><option value="sage">グリーン</option><option value="rose">ローズ</option><option value="navy">ネイビー</option></select></Field>
        <Field label="配置"><select value={c.appearance?.layout || "standard"} onChange={e => put("appearance", {...(c.appearance || {accent: "sage", layout: "standard", imageUrl: ""}), layout: e.target.value as "standard" | "compact"})}><option value="standard">ゆったり</option><option value="compact">コンパクト</option></select></Field>
        <Field label="紹介画像の URL（HTTPS）"><input type="url" value={c.appearance?.imageUrl || ""} onChange={e => put("appearance", {...(c.appearance || {accent: "sage", layout: "standard", imageUrl: ""}), imageUrl: e.target.value})}/></Field>
      </div>
      </>}
      {(!section || section === "staff") && <>
      <h3>スタッフと勤務</h3>
      {c.staff.map((p, i) => (
        <div className="staff-editor" key={p.id}>
          <Field label="名前">
            <input
              value={p.name}
              onChange={(e) =>
                put(
                  "staff",
                  c.staff.map((v, j) =>
                    j === i ? { ...v, name: e.target.value } : v,
                  ),
                )
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="勤務開始">
              <input
                type="time"
                value={p.start}
                onChange={(e) =>
                  put(
                    "staff",
                    c.staff.map((v, j) =>
                      j === i ? { ...v, start: e.target.value } : v,
                    ),
                  )
                }
              />
            </Field>
            <Field label="勤務終了">
              <input
                type="time"
                value={p.end}
                onChange={(e) =>
                  put(
                    "staff",
                    c.staff.map((v, j) =>
                      j === i ? { ...v, end: e.target.value } : v,
                    ),
                  )
                }
              />
            </Field>
          </div>
          <span className="small">勤務曜日</span>
          <div className="checkboxes">
            {weekdays.map((d, n) => (
              <label key={d}>
                <input
                  type="checkbox"
                  checked={p.weekdays.includes(n)}
                  onChange={(e) =>
                    put(
                      "staff",
                      c.staff.map((v, j) =>
                        j === i
                          ? {
                              ...v,
                              weekdays: e.target.checked
                                ? [...v.weekdays, n]
                                : v.weekdays.filter((x) => x !== n),
                            }
                          : v,
                      ),
                    )
                  }
                />
                {d}
              </label>
            ))}
          </div>
          <span className="small">対応メニュー</span>
          <div className="checkboxes">
            {c.menus.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={p.menuIds.includes(m.id)}
                  onChange={(e) =>
                    put(
                      "staff",
                      c.staff.map((v, j) =>
                        j === i
                          ? {
                              ...v,
                              menuIds: e.target.checked
                                ? [...v.menuIds, m.id]
                                : v.menuIds.filter((x) => x !== m.id),
                            }
                          : v,
                      ),
                    )
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
          <button
            disabled={c.staff.length === 1}
            onClick={() =>
              put(
                "staff",
                c.staff.filter((_, j) => i !== j),
              )
            }
          >
            このスタッフを削除
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          put("staff", [
            ...c.staff,
            {
              id: `staff-${Date.now()}`,
              name: "新しいスタッフ",
              start: c.hours.start,
              end: c.hours.end,
              weekdays: [1, 2, 3, 4, 5, 6],
              menuIds: c.menus.map((m) => m.id),
            },
          ])
        }
      >
        ＋ スタッフを追加
      </button>
      </>}
      {(!section || section === "hours") && <>
      <h3>営業時間とお休み</h3>
      <div className="form-grid">
        {(["start", "end"] as const).map((k) => (
          <Field key={k} label={k === "start" ? "開店" : "閉店"}>
            <input
              type="time"
              value={c.hours[k]}
              onChange={(e) =>
                put("hours", { ...c.hours, [k]: e.target.value })
              }
            />
          </Field>
        ))}
      </div>
      <span className="small">定休日</span>
      <div className="checkboxes">
        {weekdays.map((d, i) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={c.hours.closedWeekdays.includes(i)}
              onChange={(e) =>
                put("hours", {
                  ...c.hours,
                  closedWeekdays: e.target.checked
                    ? [...c.hours.closedWeekdays, i]
                    : c.hours.closedWeekdays.filter((v) => v !== i),
                })
              }
            />
            {d}
          </label>
        ))}
      </div>
      <Field label="臨時休業日（カンマ区切り・例：2026-12-31,2027-01-01）">
        <input
          value={c.hours.holidays.join(",")}
          onChange={(e) =>
            put("hours", {
              ...c.hours,
              holidays: e.target.value
                ? e.target.value.split(",").map((v) => v.trim())
                : [],
            })
          }
        />
      </Field>
      </>}
      {(!section || section === "rules") && <>
      <h3>予約のルール</h3>
      <p className="muted">お客様が予約時に、指名なしまたは希望するスタッフを選べます。</p>
      <div className="form-grid">
        {(
          [
            ["interval", "予約枠の間隔（分）"],
            ["advanceDays", "何日先まで予約できるか"],
            ["leadMinutes", "開始何分前まで予約できるか"],
            ["cancelHours", "開始何時間前までキャンセルできるか"],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <input
              type="number"
              min="0"
              value={c.rules[k]}
              onChange={(e) =>
                put("rules", { ...c.rules, [k]: +e.target.value })
              }
            />
          </Field>
        ))}
      </div>
      <label>
        <input
          type="checkbox"
          checked={c.rules.sameDay}
          onChange={(e) =>
            put("rules", { ...c.rules, sameDay: e.target.checked })
          }
        />{" "}
        当日の予約を受け付ける
      </label>
      <p className="small muted">
        {section ? "この項目は保存すると反映されます。" : "設定はプラン確認・承認・公開のあとに反映されます。"}
      </p>
      </>}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>✳</span>
      <p>{text}</p>
    </div>
  );
}
function Reservations({
  shop,
  run,
  reload,
}: {
  shop: Workspace;
  run: Run;
  reload: () => Promise<unknown>;
}) {
  const api = useApi();
  const [date, setDate] = useState("");
  const [staff, setStaff] = useState("");
  return (
    <div className="panel">
      <div className="section-top">
        <h2>
          予約一覧{" "}
          <span className="count">
            {shop.bookings.filter((b) => b.status === "active").length}
          </span>
        </h2>
        <button
          onClick={() =>
            run(async () => {
              await reload();
            })
          }
        >
          更新
        </button>
      </div>
      <div className="filters">
        <Field label="日付（日本時間）">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="スタッフ">
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">すべて</option>
            {shop.published?.staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          onClick={() => {
            setDate("");
            setStaff("");
          }}
        >
          絞り込みを解除
        </button>
      </div>
      {!shop.bookings.length && (
        <Empty text="最初の予約を、楽しみに待ちましょう。" />
      )}
      <div className="booking-list">
        {shop.bookings
          .filter(
            (b) =>
              (!date ||
                new Date(Date.parse(b.start) + 9 * 3600000)
                  .toISOString()
                  .startsWith(date)) &&
              (!staff || b.staffId === staff),
          )
          .map((b) => (
            <div className="booking-card" key={b.id}>
              <div>
                <span className={`status ${b.status}`}>
                  {b.status === "active"
                    ? "予約確定"
                    : b.status === "no_show"
                      ? "無断キャンセル"
                      : "キャンセル済み"}
                </span>
                <h3>
                  {b.name} 様 <small>{when(b.start)}</small>
                </h3>
                <p>
                  {shop.published?.menus.find((m) => m.id === b.menuId)?.name ||
                    b.menuId}{" "}
                  /{" "}
                  {shop.published?.staff.find((p) => p.id === b.staffId)
                    ?.name || b.staffId}
                </p>
                <span className="small muted">{b.customer}</span>
                {b.message && <p className="pre-wrap"><b>予約時のメッセージ</b><br />{b.message}</p>}
              </div>
              {b.status === "active" && (
                <div className="actions">
                  {(["cancelled", "no_show"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/api/shops/${shop.id}/bookings/${b.id}/status`,
                            { status },
                          );
                          await reload();
                        })
                      }
                    >
                      {status === "cancelled"
                        ? "予約をキャンセル"
                        : "無断キャンセルを記録"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
function InquiryCard({ q, send }: { q: Inquiry; send: (s: string) => void }) {
  const [text, setText] = useState(q.reply);
  return (
    <div className="inquiry">
      <b>{q.name} 様</b>
      <span className="small muted"> {q.email}</span>
      <p className="pre-wrap">{q.message}</p>
      {q.reply && <p className="notice pre-wrap">返信：{q.reply}</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="返信を書いてください"
        aria-label="返信内容"
      />
      <button
        className="primary"
        disabled={!text.trim()}
        onClick={() => send(text)}
      >
        メールで返信
      </button>
    </div>
  );
}
function CalendarPanel({ shop, run }: { shop: Workspace; run: Run }) {
  const api = useApi();
  const [connection, setConnection] = useState<{ connected: boolean; staffId?: string; email: string; configured: boolean }>();
  const [staffId, setStaffId] = useState("");
  const reload = async () => {
    const value = await api<NonNullable<typeof connection>>(`/api/shops/${shop.id}/calendar`);
    setConnection(value);
    setStaffId(value.staffId || "");
  };
  useEffect(() => { setConnection(undefined); run(reload); }, [shop.id]);
  const config = shop.published;
  return <section>
    <h3>自分の Google Calendar と連携</h3>
    <p className="muted">各メンバーが自分のアカウントで接続してください。メインカレンダーで「予定あり」の時間を、選んだ担当者の予約枠から除外します。終日の予定にも対応します。予定の件名・本文は取得しません。</p>
    <p className="small muted">追加カレンダーは対象外です。予約の書き込みは行いません。連携先を確認できないときは、その担当者を含む予約受付を一時停止します。</p>
    {connection && <>
      <p>{connection.email} · {connection.connected ? `連携中（${config?.staff.find(s => s.id === connection.staffId)?.name || "担当者が削除されています"}）` : "未連携"}</p>
      {!connection.configured && <p className="notice">利用にはサーバーの Google OAuth 設定が必要です。</p>}
      {!config ? <p>お店を公開すると連携できます。</p> : <>
        <Field label="自分に対応する予約の担当者">
          <select value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">担当者を選択</option>
            {config.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <button disabled={!staffId || !connection.configured} onClick={() => run(async () => {
          const result = await api<{ authUrl: string }>(`/api/shops/${shop.id}/calendar/connect`, { staffId });
          location.assign(result.authUrl);
        })}>{connection.connected ? "再接続・担当者を変更" : "Google Calendar を接続"}</button>
      </>}
      {connection.connected && <button onClick={() => run(async () => { await api(`/api/shops/${shop.id}/calendar/disconnect`, {}); await reload(); })}>カレンダー連携を解除</button>}
    </>}
  </section>;
}
function Team({
  shop,
  run,
  reload,
}: {
  shop: Workspace;
  run: Run;
  reload: () => Promise<unknown>;
}) {
  const api = useApi();
  const [email, setEmail] = useState("");
  return (
    <div className="panel">
      <h2>家族・スタッフの招待</h2>
      <CalendarPanel shop={shop} run={run} />
      <p className="muted">
        同じお店の予約とお問い合わせを、一緒に管理できます。保存先は店主の
        Google ドライブのままです。
      </p>
      <div className="member-row">
        <b>{shop.owner}</b>
        <span className="pill">店主</span>
      </div>
      {shop.members.map((m) => (
        <div className="member-row" key={m.email}>
          {m.email}
          <span className="pill">{m.status === "revoked" ? "解除済み" : m.accepted ? "参加済み" : "招待中"}</span>
          {shop.isOwner && m.status!=="revoked" && <button onClick={()=>run(async()=>{await api(`/api/shops/${shop.id}/members/revoke`,{email:m.email});await reload();})}>参加を解除</button>}
        </div>
      ))}
      {shop.isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api(`/api/shops/${shop.id}/invite`, { email });
              setEmail("");
              await reload();
            });
          }}
        >
          <Field label="招待する Google アカウントのメールアドレス">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <button className="primary">招待を送る →</button>
        </form>
      )}
    </div>
  );
}
function Settings({
  shop,
  run,
  reload,
}: {
  shop: Workspace;
  run: Run;
  reload: () => Promise<unknown>;
}) {
  const api = useApi();
  const [domain, setDomain] = useState(shop.domain || "");
  return (
    <div className="panel">
      <h2>予約ページのアドレス</h2>
      {shop.published ? (
        <>
          <p className="muted">お客様に公開している本番のお店を別タブで開きます。</p>
          <a className="button" href={shop.publicUrl} target="_blank" rel="noreferrer">
            公開中のお店を開く ↗
          </a>
          <p className="small muted">{shop.publicUrl}</p>
        </>
      ) : (
        <p>お店のページを公開すると、アドレスができあがります。</p>
      )}
      <h3>お店独自のドメイン</h3>
      <p className="muted">
        お持ちのドメインを使う場合に設定してください。DNS と HTTPS
        の接続設定が必要です。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api(`/api/shops/${shop.id}/domain`, { domain });
            await reload();
          });
        }}
      >
        <Field label="ドメイン名">
          <input
            value={domain}
            placeholder="reserve.example.com"
            onChange={(e) => setDomain(e.target.value)}
            disabled={!shop.isOwner}
          />
        </Field>
        <button disabled={!shop.isOwner}>ドメインを設定</button>
      </form>
      {shop.domainToken && (
        <div className="config-summary">
          <p>DNS 管理画面で次のレコードを追加してください。</p>
          <code>TXT _omaiweb.{shop.domain}</code>
          <pre>{shop.domainToken}</pre>
          <p className="small">
            加えて、このサービスの公開先への DNS 接続と HTTPS
            証明書をサーバーの運用担当者に設定してもらってください。
          </p>
          <p className="pill">
            {shop.domainVerified ? "所有権を確認済み" : "所有権の確認待ち"}
          </p>
          <button
            disabled={!shop.isOwner}
            onClick={() =>
              run(async () => {
                await api(`/api/shops/${shop.id}/domain/verify`, {});
                await reload();
              })
            }
          >
            DNS の所有権を確認する
          </button>
        </div>
      )}
    </div>
  );
}
export function PublicShop({
  hideHeader = false,
  hideFooter = false,
  pageSlug,
  category,
  articleKey,
  navigate,
  search = location.search,
  initialPane = "mine",
  onPaneChange,
  session,
  slug,
  preview,
  run,
  busy,
  notify,
}: {
  hideHeader?: boolean;
  hideFooter?: boolean;
  pageSlug?: string;
  category?: PostCategory;
  articleKey?: string;
  navigate: Navigate;
  search?: string;
  initialPane?: string;
  onPaneChange?: (pane: string) => void;
  session: Session;
  slug: string;
  preview: boolean;
  run: Run;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const api = useApi();
  const pageRoot = useRef<HTMLDivElement>(null);
  const plan = new URLSearchParams(search).get("plan");
  const basePath = session.hosted ? "" : `/s/${slug}`;
  const base = preview ? `/api/preview/${slug}` : `/api/public/${slug}`;
  const suffix = preview ? `?plan=${plan}` : "";
  const [data, setData] = useState<{
    config: ShopConfig;
    shopId: string;
    canEdit?: boolean;
    authUrl?: string;
    recentPosts?: PostSummary[];
  }>();
  const [menu, setMenu] = useState("");
  const [staff, setStaff] = useState("");
  const [date, setDate] = useState(localDate());
  const [times, setTimes] = useState<
    { start: string; end: string; staffId: string }[]
  >([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState(session.user?.name || "");
  const [mine, setMine] = useState<Booking[]>([]);
  const [message, setMessage] = useState("");
  const [bookingMessage, setBookingMessage] = useState("");
  const [pane, setPane] = useState(initialPane);
  const [complete, setComplete] = useState(false);
  const [requestId, setRequestId] = useState(() => createRequestId());
  const isCustomer =
    session.user?.role === "customer" && session.user.shopId === data?.shopId;
  const loadMine = async () => {
    if (!preview && isCustomer) setMine(await api(`${base}/bookings`));
  };
  useEffect(() => {
    run(async () => {
      const d = await api<{
        config: ShopConfig;
        shopId: string;
        authUrl: string;
      }>(base + suffix);
      setData(d);
      setMenu(d.config.menus.find((m) => m.active)?.id || "");
      setStaff("");
    });
  }, [base]);
  useEffect(() => {
    if (!data) return;
    if (
      staff &&
      !data.config.staff.some((p) => p.id === staff && p.menuIds.includes(menu))
    ) {
      setStaff("");
      return;
    }
    setSelected("");
    setComplete(false);
    setRequestId(createRequestId());
    setTimes([]);
    let cancelled = false;
    const query = new URLSearchParams({
      date,
      menu,
      staff,
      ...(preview ? { plan: plan || "" } : {}),
    });
    api<typeof times>(`${base}/slots?${query}`)
      .then((t) => {
        if (!cancelled) setTimes(t);
      })
      .catch(() => {
        if (!cancelled) setTimes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date, menu, staff, data]);
  useEffect(() => {
    run(loadMine);
  }, [isCustomer]);
  if (!data)
    return <div className="loading">お店のページを準備しています…</div>;
  const c = data.config;
  return (
    <div ref={pageRoot} className={`public-shop accent-${c.appearance?.accent || "sage"} layout-${c.appearance?.layout || "standard"}`}>
      {data.canEdit && !session.hosted && <VisualRequest key={`${data.shopId}-${plan || "live"}`} shopId={data.shopId} config={c} planId={preview ? plan || undefined : undefined} root={pageRoot} /> }
      {preview && (
        <div className="preview-banner">
          ✧ プレビュー · 練習用の予約画面です。実際の予約は作成されません。
        </div>
      )}
      {!hideHeader && <SiteHeader config={c}>
      <nav className="public-nav">
        {[
          ["mine", "マイページ"],
          ["reserve", "ご予約"],
          ["about", "お店のこと"],
          ["contact", "お問い合わせ"],
        ].map(([id, label]) => (
          <button
            className={!category && !pageSlug && pane === id ? "active" : ""}
            onClick={() =>
              (category || pageSlug) ? navigate(`${basePath || "/"}?pane=${id}`) : onPaneChange ? onPaneChange(id) : setPane(id)
            }
            key={id}
          >
            {label}
          </button>
        ))}
        {!preview &&
          (["blogs", "announcements"] as const).map((cat) => (
            <button
              key={cat}
              className={category === cat ? "active" : ""}
              onClick={() => navigate(`${basePath}/${cat}`)}
            >
              {cat === "blogs" ? "ブログ" : "お知らせ"}
            </button>
          ))}
        {c.pages.map(page => <button key={page.id} className={pageSlug === page.slug ? "active" : ""} onClick={() => navigate(`${basePath}/pages/${page.slug}`)}>{page.navigationLabel}</button>)}
      </nav>
      </SiteHeader>}
      {pageSlug ? (
        c.pages.find(page => page.slug === pageSlug) ? <CustomPage page={c.pages.find(page => page.slug === pageSlug)!} /> : <p className="alert">ページがありません。</p>
      ) : category ? (
        <PublicBlog
          baseApi={base}
          basePath={basePath}
          category={category}
          articleKey={articleKey}
          navigate={navigate}
        />
      ) : (
        <>
          {!preview && pane === "mine" && (
            <RecentPosts
              posts={data.recentPosts || []}
              basePath={basePath}
              navigate={navigate}
            />
          )}
          {!preview && !isCustomer && (
            <div className="login-strip">
              <span>
                ご予約・マイページは Google
                アカウントでログインしてご利用ください。
              </span>
              <a className="button primary" href={data.authUrl}>
                Google でログイン
              </a>
              {session.demo && (
                <button
                  onClick={() =>
                    run(async () => {
                      await api("/api/demo-login", {
                        role: "customer",
                        shopId: data.shopId,
                      });
                      location.reload();
                    })
                  }
                >
                  お客様デモでログイン
                </button>
              )}
            </div>
          )}
          {pane === "reserve" && (
            <div className="reservation-layout">
              <div className="panel">
                <span className="eyebrow">RESERVATION</span>
                <h2>自分のための、ひとときを。</h2>
                <h3>01 メニューを選ぶ</h3>
                <div className="menu-options">
                  {c.menus
                    .filter((m) => m.active)
                    .map((m) => (
                      <button
                        className={menu === m.id ? "selected" : ""}
                        onClick={() => {
                          setMenu(m.id);
                          setComplete(false);
                        }}
                        key={m.id}
                      >
                        <MenuImage imageId={m.imageId} imageBase={`${base}/menu-images`} suffix={suffix} name={m.name} />
                        <span>
                          <b>{m.name}</b>
                          <small>{m.duration}分</small>
                        </span>
                        <strong>
                          {yen(m.price)}{" "}
                          <span>{menu === m.id ? "●" : "○"}</span>
                        </strong>
                      </button>
                    ))}
                </div>
                <h3>02 スタッフと日時</h3>
                <Field label="スタッフ">
                  <select
                    value={staff}
                    onChange={(e) => setStaff(e.target.value)}
                  >
                    <option value="">指名なし（空いているスタッフ）</option>
                    {c.staff
                      .filter((p) => p.menuIds.includes(menu))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="ご希望の日付（日本時間）">
                  <input
                    type="date"
                    min={localDate()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <div className="time-grid">
                  {times.map((t) => (
                    <button
                      className={selected === t.start ? "selected" : ""}
                      key={t.start}
                      onClick={() => {
                        setSelected(t.start);
                        setComplete(false);
                        setRequestId(createRequestId());
                      }}
                    >
                      {new Date(t.start).toLocaleTimeString("ja-JP", {
                        timeZone: "Asia/Tokyo",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </button>
                  ))}
                </div>
                {!times.length && (
                  <p className="empty-slots">
                    この日にご案内できる時間はありません。別の日付をお選びください。
                  </p>
                )}
                <h3>03 予約内容を確認</h3>
                <Field label="お名前">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="お名前"
                  />
                </Field>
                <Field label="お店へのメッセージ（任意）">
                  <textarea maxLength={2000} rows={3} value={bookingMessage} onChange={event => { setBookingMessage(event.target.value); setRequestId(createRequestId()); }} placeholder="ご希望や事前に伝えたいことがあればご記入ください" />
                </Field>
                <p className="small muted">
                  キャンセルは開始 {c.rules.cancelHours}{" "}
                  時間前までマイページで承ります。それ以降はお問い合わせください。
                </p>
                <button
                  className="primary wide"
                  disabled={
                    busy ||
                    !selected ||
                    !name.trim() ||
                    (!preview && !isCustomer) ||
                    complete
                  }
                  onClick={() =>
                    run(async () => {
                      await api(`${base}/bookings${suffix}`, {
                        name,
                        message: bookingMessage,
                        menuId: menu,
                        staffId: staff,
                        start: selected,
                        requestId,
                      });
                      setComplete(true);
                      notify(
                        preview
                          ? "プレビューで予約を確認しました。実際のデータは変更していません。"
                          : "ご予約を承りました。マイページからご確認いただけます。",
                      );
                      await loadMine();
                    })
                  }
                >
                  {complete
                    ? "✓ 予約を受け付けました"
                    : preview
                      ? "プレビューで予約を試す"
                      : "この内容で予約する"}{" "}
                  →
                </button>
              </div>
              <div className="panel booking-summary">
                <span className="line-flower">✳</span>
                <h3>ご予約内容</h3>
                <p>{c.menus.find((m) => m.id === menu)?.name}</p>
                <p className="price">
                  {yen(c.menus.find((m) => m.id === menu)?.price || 0)}
                </p>
                <hr />
                <p>{selected ? when(selected) : "日時をお選びください"}</p>
                <p className="small muted">
                  {!staff
                    ? "スタッフの指名なし"
                    : c.staff.find((p) => p.id === staff)?.name}
                </p>
                <p className="small muted">{c.address}</p>
              </div>
            </div>
          )}
          {pane === "about" && (
            <div className="panel about">
              <h2>{c.name}</h2>
              <p>{c.description}</p>
              <h3>メニュー</h3>
              {c.menus
                .filter((m) => m.active)
                .map((m) => (
                  <div className="menu-row" key={m.id}>
                    <MenuImage imageId={m.imageId} imageBase={`${base}/menu-images`} suffix={suffix} name={m.name} />
                    {m.name} · {m.duration}分 <b>{yen(m.price)}</b>
                  </div>
                ))}
              <h3>スタッフ</h3>
              <p>{c.staff.map((p) => p.name).join("・")}</p>
              <h3>アクセス</h3>
              <p>{c.address}</p>
              <h3>営業時間</h3>
              <p>
                {c.hours.start} – {c.hours.end} / 定休日：
                {c.hours.closedWeekdays.map((d) => weekdays[d]).join("・")}
              </p>
              {c.hours.holidays.length > 0 && (
                <p>臨時休業：{c.hours.holidays.join("、")}</p>
              )}
            </div>
          )}
          {pane === "mine" && (
            <div className="panel">
              <h2>あなたのご予約</h2>
              {preview ? (
                <Empty text="プレビューでは実際のお客様の予約を読み込みません。" />
              ) : !mine.length ? (
                <Empty text="ご予約はまだありません。" />
              ) : (
                mine.map((b) => (
                  <div className="booking-card" key={b.id}>
                    <div>
                      <span className={`status ${b.status}`}>
                        {b.status === "active"
                          ? "予約確定"
                          : b.status === "no_show"
                            ? "無断キャンセル"
                            : "キャンセル済み"}
                      </span>
                      <h3>{when(b.start)}</h3>
                      <p>
                        {c.menus.find((m) => m.id === b.menuId)?.name ||
                          b.menuId}
                      </p>
                      {b.message && <p className="pre-wrap"><b>予約時のメッセージ</b><br />{b.message}</p>}
                      <p className="small muted">予約番号：{b.id}</p>
                    </div>
                    {b.status === "active" && (
                      <button
                        onClick={() =>
                          run(async () => {
                            await api(`${base}/bookings/${b.id}/cancel`, {});
                            await loadMine();
                            notify("予約をキャンセルしました。");
                          })
                        }
                      >
                        キャンセルする
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          {pane === "contact" && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (preview) {
                    notify(
                      "プレビューのお問い合わせです。実際の送信は行いません。",
                    );
                    return;
                  }
                  await api(`${base}/inquiries`, { name, message });
                  setMessage("");
                  notify(
                    "お問い合わせを受け付けました。返信はメールでお送りします。",
                  );
                });
              }}
            >
              <h2>お問い合わせ</h2>
              <Field label="お名前">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="ご相談内容">
                <textarea
                  required
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
              <button
                className="primary"
                disabled={busy || (!preview && !isCustomer)}
              >
                お問い合わせを送る →
              </button>
            </form>
          )}
        </>
      )}
      {!hideFooter && <SiteFooter config={c} />}
    </div>
  );
}
