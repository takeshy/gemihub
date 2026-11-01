import { StaffAccounts, StaffCalendar, StaffLogin, StaffPhoto } from "./StaffAccounts";
import { Inquiries } from "./Inquiries";
import type { RequestIntent } from "../server/request-intent";
import type { ChatReference } from "../server/shop-chat";
import { DateInput } from "./DateInput";
import { CustomerRegistration } from "./CustomerRegistration";
import type { MemberProfile } from "../server/customer-profile";
import { BlogEditor, PublicBlog, RecentPosts, type Navigate } from "./Blog";
import type { PostCategory, PostSummary } from "../server/post-domain";
import { DataManagement } from "./DataManagement";
import { ShopOverview } from "./ShopOverview";
import { ImageLibrary } from "./ImageLibrary";
import { PublicationPreview } from "./PublicationPreview";
import { ShopRequest } from "./ShopRequest";
import { SiteHeader, SiteFooter } from "./SiteChrome";
import { CustomPage } from "./CustomPage";
import { LiveSettings } from "./LiveSettings";
import { LocalPreview } from "./LocalPreview";
import { Manual } from "./Manual";
import { MenuImage, MenuImageEditor } from "./MenuImage";
import { Customers } from "./Customers";
import { createRequestId } from "./request-id";
import React, { useEffect, useState, useRef } from "react";
import { useApi } from "./api";
import type { ShopConfig, Booking } from "../server/domain";
import type { Shop, User } from "../server/store";
import "./style.css";
export type Plan = {
  id: string;
  config: ShopConfig;
  summary: string[];
  approved: boolean;
  requiresSetup?: boolean;
  chat?: ChatReference;
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
  initialTab = new URLSearchParams(search).has("customer") ? "customers" : new URLSearchParams(search).get("calendar") === "connected" ? "staff" : "try",
  initialPane,
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
    /^\/(s)\/([^/]+)(?:\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?)?$/,
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
                : initialPane || (session.user ? "mine" : "about"))!
            }
            pageSlug={(match?.[3] || hostedPost?.[1]) === "pages" ? match?.[4] || hostedPost?.[2] : undefined}
            category={
              ((match?.[3] || hostedPost?.[1]) === "pages" ? undefined : match?.[3] || hostedPost?.[1]) as PostCategory | undefined
            }
            articleKey={match?.[4] || hostedPost?.[2]}
            navigate={navigate}
            slug={session.hosted || match![2]}
            run={run}
            busy={busy}
            notify={setNotice}
          />
        ) : /^\/staff-login\/[^/]+$/.test(path) ? (
          <StaffLogin shopId={path.split("/")[2]} />
        ) : /^\/publication-preview\/[^/]+$/.test(path) ? (
          <PublicationPreview shopId={path.split("/")[2]} />
        ) : session.user ? (
          <Dashboard
            initialTab={new URLSearchParams(search).has("customer")?"customers":["build","try","data","inquiries","customers","bookings","staff"].includes(new URLSearchParams(search).get("tab") || "") ? new URLSearchParams(search).get("tab")! : initialTab}
            initialScreen={new URLSearchParams(search).get("screen") || undefined}
            initialArticleKey={new URLSearchParams(search).get("article") || undefined}
            requestIntent={new URLSearchParams(search).get("intent") === "modify" ? "modify" : undefined}
            openDataMenu={new URLSearchParams(search).get("dataMenu") === "1"}
            initialShop={new URLSearchParams(search).get("shop") || ""}
            focusRequest={new URLSearchParams(search).get("request") === "1"}
            initialCustomer={new URLSearchParams(search).get("customer") || ""}
            initialInquiryId={new URLSearchParams(search).get("inquiry") || ""}
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
  initialShop = "",
  focusRequest = false,
  initialScreen,
  initialArticleKey,
  requestIntent,
  openDataMenu = false,
  initialCustomer = "",
  initialCustomerImages = false,
  initialInquiryId = "",
  session,
  run,
  busy,
  notify,
}: {
  initialTab?: string;
  initialShop?: string;
  focusRequest?: boolean;
  initialScreen?: string;
  initialArticleKey?: string;
  requestIntent?: RequestIntent;
  openDataMenu?: boolean;
  initialCustomer?: string;
  initialCustomerImages?: boolean;
  initialInquiryId?: string;
  session: Session;
  run: Run;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const api = useApi();
  const [shops, setShops] = useState<Workspace[]>([]);
  const [chosen, setChosen] = useState(initialShop);
  const [tab, setTab] = useState(initialTab === "team" ? "staff" : initialTab === "create-page" ? "build" : ["hours","rules"].includes(initialTab)?"basic":initialTab);
  const [treeHost, setTreeHost] = useState<HTMLDivElement | null>(null);
  const buildReview = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<Plan>();
  async function load() {
    const w = await api<{ shops: Workspace[] }>("/api/workspace");
    setShops(w.shops);
    return w.shops;
  }
  useEffect(() => {
    run(async () => {
      await load();
    });
  }, []);
  const shop = shops.find((s) => s.id === chosen) || shops[0];
  useEffect(() => { if (shop && !shop.isOwner && ["try", "data"].includes(tab)) setTab("bookings"); }, [shop?.id, shop?.isOwner, tab]);
  const activePlan =
    plan && plan.base === shop?.revision && shop.plans.some((p) => p.id === plan.id)
      ? plan
      : shop?.plans.find(p => p.base === shop.revision && p.id === new URLSearchParams(location.search).get("plan")) || shop?.plans.filter((p) => p.base === shop.revision).at(-1);
  const request = (action: string, data: unknown = {}) =>
    api(`/api/shops/${shop.id}/${action}`, data);
  const acceptPlan = async (p: Plan) => {
    const publication = !shop.published || shop.publication === "provisional" ? "provisional" : "public";
    await request(`plans/${p.id}/approve`);
    await request(`plans/${p.id}/publish`, { publication });
    setPlan(undefined);
    await load();
    notify(publication === "provisional" ? "仮公開しました。あなたのログインでだけページを表示できます。" : "変更を反映しました。");
  };
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
            ["build", "✧", "AIとお店をつくる"],
            ...(shop?.isOwner ? [["try", "▣", "画面を試す・編集"], ["images", "▧", "画像管理"]] : []),
            ["bookings", "▦", "予約を管理"],
            ...(shop ? [["customers", "♧", "お客様"]] : []),
            ...(shop?.isOwner ? [["basic", "⌂", "お店の基本情報"], ["menus", "≡", "メニュー・料金"], ["staff", "♧", "スタッフ・勤務"]] : []),
            ["inquiries", "✉", "お問い合わせ"],
            ["blog", "✎", "ブログ・お知らせ"],
            ...(!shop?.isOwner ? [["staff", "♧", "自分のカレンダー"]] : []),
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
        {!shop ? (
          <p>
            運営できるお店はありません。スタッフの方は、店主から案内されたスタッフ用ログインURLからログインしてください。
          </p>
        ) : (
          <>
            {tab === "manual" ? (
              <Manual />
            ) : (
              <>
                {shop.published && shop.publication === "provisional" && <section className="notice publication-status" aria-label="公開状態">
                  <div className="publication-status-top"><div><h2>仮公開中</h2>
                  <p>ページを用意したGoogleアカウントでログインした本人だけが見られます。</p></div>
                  {shop.isOwner && <div className="publication-next-step"><b>お客様への公開はこちら</b>
                    <a className="button primary" data-publication-preview-link href={`/publication-preview/${shop.id}`}>画面を確認して本番公開へ <span aria-hidden="true">→</span></a>
                    <p>次の画面で表示を確かめてから、本番公開できます。</p>
                  </div>}</div>
                  <p>スタッフ・メニュー・料金・営業時間などは、それぞれの設定メニューで更新できます。</p>
                  <p className="editing-guidance">デザインは各画面の編集画面で更新してください。<button className="text-button" onClick={() => setTab("try")}>画面を試す・編集を開く →</button><br />全体的な表示や機能の修正は<button className="text-button" onClick={() => setTab("build")}>AIとお店をつくる</button>で相談できます。</p>
                </section>}
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
                    {shop.published && <ShopOverview key={`${shop.id}-${shop.revision}`} shopId={shop.id} focusRequest={focusRequest} initialIntent={requestIntent} google={shop.google} isOwner={shop.isOwner} open={setTab} plan={activePlan} onAccept={acceptPlan} onPlan={async (text, context, imageIds, intent, chat) => {
                      const p = await api<Plan>(`/api/shops/${shop.id}/plan`, { text, context, imageIds, intent, chat });
                      setPlan(p); await load(); return p;
                    }} />}
                    {!shop.published && <div className="steps initial-steps">{["内容を確認", "仮公開", "本番公開"].map((label, i) => <div key={label} className={i === 0 ? "current" : ""} aria-current={i === 0 ? "step" : undefined}><span>0{i + 1}</span>{label}</div>)}</div>}
                    <div ref={buildReview} className="build-plan-area">
                      <div>
                        {!shop.published && <div className="panel interview">{!activePlan && <h2>AIとお店をつくる</h2>}<ShopRequest shopId={shop.id} published={false} isOwner={shop.isOwner} context={{revision:shop.revision,hash:""}} plan={activePlan} onPlan={async (text, imageIds, intent, chat) => { const p = await api<Plan>(`/api/shops/${shop.id}/plan`, { text, imageIds, intent, chat }); setPlan(p); await load(); return p; }} onAccept={acceptPlan} /></div>}
                      </div>
                    </div>
                  </>
                )}
                {tab === "basic" && shop.isOwner && <section className="basic-settings" aria-label="お店の基本情報と予約の設定">{(["basic","hours","rules"] as const).map(section=><LiveSettings key={`${shop.id}-${section}`} shop={shop} section={section} reload={load}/>)}</section>}
                {tab === "menus" && shop.isOwner && <LiveSettings key={`${shop.id}-menus`} shop={shop} section="menus" reload={load} />}
                {tab === "staff" && <>{shop.isOwner && <><LiveSettings key={`${shop.id}-staff`} shop={shop} section="staff" reload={load} /><StaffAccounts key={`${shop.id}-${shop.revision}`} shop={shop}/></>}<StaffCalendar key={shop.id} shop={shop}/>{!shop.isOwner && <StaffPhoto shop={shop} reload={load}/>}</>}
                {tab === "images" && shop.isOwner && <ImageLibrary key={shop.id} shopId={shop.id} />}
                {tab === "bookings" && (
                  <Reservations shop={shop} run={run} reload={load} />
                )}
                {tab === "customers" && <Customers key={shop.id} shopId={shop.id} config={shop.published} initialEmail={initialCustomer} initialImages={initialCustomerImages} initialInquiryId={initialInquiryId} backToInquiries={()=>setTab("inquiries")} inquiriesChanged={load} />}
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
                <div hidden={tab!=="inquiries"}><Inquiries shopId={shop.id} inquiries={shop.inquiries}/></div>
                {tab === "data" && shop.isOwner && <DataManagement key={shop.id} shopId={shop.id} open={setTab} showMenus={openDataMenu} />}
                {tab === "settings" && (
                  <Settings shop={shop} run={run} reload={load} />
                )}
              </>
            )}
          </>
        )}
        {shop?.isOwner && <div hidden={tab !== "try"}><LocalPreview key={shop.id} initialScreen={initialScreen} initialArticleKey={initialArticleKey} shop={shop} email={session.user!.email} reload={load} sidebar={treeHost} activate={() => setTab("try")} /></div>}
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
          <span>予約のお知らせを受け取るメール</span>
          <b>{c.notificationEmail}</b>
        </div>
        <div><span>住所・アクセス</span><b>{c.address || "未入力"}</b></div>
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
      <details>
        <summary>スタッフと予約の決まりを見る</summary>
        <h4>スタッフが働く日と時間</h4>
        <ul>{c.staff.map(staff => <li key={staff.id}><b>{staff.name}</b>：{staff.weekdays.map(day => weekdays[day]).join("・") || "勤務日なし"} {staff.start}〜{staff.end}（担当：{staff.menuIds.map(id => c.menus.find(menu => menu.id === id)?.name).filter(Boolean).join("、") || "なし"}）</li>)}</ul>
        <h4>予約の決まり</h4>
        <ul>
          <li>予約できるのは{c.rules.advanceDays}日先まで、開始の{c.rules.leadMinutes}分前までです。</li>
          <li>当日の予約は{c.rules.sameDay ? "受け付けます" : "受け付けません"}。</li>
          <li>予約の時刻は{c.rules.interval}分ごとに選べます。</li>
          <li>キャンセルは開始の{c.rules.cancelHours}時間前までです。</li>
          <li>臨時のお休み：{c.hours.holidays.join("、") || "なし"}</li>
        </ul>
      </details>
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
          {shopId && <MenuImageEditor shopId={shopId} imageId={p.imageId} name={p.name} label="スタッフ写真（任意）" uploading={onImageUploading} change={imageId => put("staff", c.staff.map((staff,j) => j===i ? {...staff,imageId} : staff))}/>}
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
      <Field label="臨時休業日（カンマ区切り・例：2026/12/31,2027/01/01）">
        <input
          value={c.hours.holidays.map(value => value.replace(/-/g, "/")).join(",")}
          onChange={(e) =>
            put("hours", {
              ...c.hours,
              holidays: e.target.value
                ? e.target.value.split(",").map((v) => v.trim().replace(/\//g, "-"))
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
          <DateInput aria-label="日付（日本時間）"
            value={date}
            onValueChange={value => setDate(value)} />
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
  initialPane,
  onPaneChange,
  session,
  slug,
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
  run: Run;
  busy: boolean;
  notify: (s: string) => void;
}) {
  const api = useApi();
  const basePath = session.hosted ? "" : `/s/${slug}`;
  const base = `/api/public/${slug}`;
  const [data, setData] = useState<{
    config: ShopConfig;
    shopId: string;
    authUrl?: string;
    publication?: "provisional" | "public";
    recentPosts?: PostSummary[];
    customerProfile?: MemberProfile | null;
    registrationRequired?: boolean;
  }>();
  const [menu, setMenu] = useState("");
  const [staff, setStaff] = useState("");
  const [date, setDate] = useState(localDate());
  const [times, setTimes] = useState<
    { start: string; end: string; staffId: string }[]
  >([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState(session.user?.name || "");
  useEffect(() => { setName(session.user?.name || ""); }, [session.user?.email, session.user?.name]);
  const [mine, setMine] = useState<Booking[]>([]);
  const [message, setMessage] = useState("");
  const [bookingMessage, setBookingMessage] = useState("");
  const [pane, setPane] = useState(initialPane || (session.user ? "mine" : "about"));
  const [complete, setComplete] = useState(false);
  const [requestId, setRequestId] = useState(() => createRequestId());
  const isCustomer =
    session.user?.role === "customer" && session.user.shopId === data?.shopId;
  const loadMine = async () => {
    if (isCustomer) setMine(await api(`${base}/bookings`));
  };
  useEffect(() => {
    run(async () => {
      const d = await api<{
        config: ShopConfig;
        shopId: string;
        authUrl: string;
        customerProfile?: MemberProfile | null;
        registrationRequired?: boolean;
      }>(base);
      setData(d);
      if (d.customerProfile) setName(d.customerProfile.name);
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
    <div className={`public-shop accent-${c.appearance?.accent || "sage"} layout-${c.appearance?.layout || "standard"}`}>
      {data.publication === "provisional" && <div className="preview-banner">仮公開中 · このページを用意したGoogleアカウントでログインした本人だけが表示できます。</div>}
      {!hideHeader && <SiteHeader config={c} imageBase={`${base}/images`}>
      <nav className="public-nav">
        {(session.user ? [["mine", "マイページ"],
          ["reserve", "ご予約"],
          ["about", "お店のこと"],
          ["contact", "お問い合わせ"]] : [["about", "お店のこと"], ["reserve", "ご予約"], ["contact", "お問い合わせ"]]).map(([id, label]) => (
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
        {
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
      {!hideHeader&&!isCustomer&&<section className="public-auth" aria-label="会員登録・ログイン">
        <div className="public-auth-intro"><strong>ご予約をご利用の方へ</strong><p>Googleアカウントでご利用いただけます。</p></div>
        <div className="public-auth-actions"><div><span>初めての方</span><a className="button primary" href={data.authUrl}>会員登録</a></div><div><span>登録済みの方</span><a className="button" href={data.authUrl}>ログイン</a></div>{session.demo&&<button type="button" onClick={()=>run(async()=>{await api("/api/demo-login",{role:"customer",shopId:data.shopId});location.reload();})}>お客様デモでログイン</button>}</div>
      </section>}
      {isCustomer && data.registrationRequired ? <CustomerRegistration base={base} email={session.user!.email} name={session.user!.name} profile={data.customerProfile} onSaved={profile => { setData(current => current && { ...current, customerProfile: profile, registrationRequired: false }); setName(profile.name); setPane("reserve"); }} /> : pageSlug ? (
        c.pages.find(page => page.slug === pageSlug) ? <CustomPage page={c.pages.find(page => page.slug === pageSlug)!} imageBase={`${base}/images`} /> : <p className="alert">ページがありません。</p>
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
          {pane === "mine" && (
            <RecentPosts
              posts={data.recentPosts || []}
              basePath={basePath}
              navigate={navigate}
            />
          )}
          {pane === "mine" && isCustomer && <div className="member-information"><span>{data.customerProfile?.name || session.user!.name} さん</span><button type="button" onClick={() => setData(current => current && { ...current, registrationRequired: true })}>会員情報を変更</button></div>}
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
                        <MenuImage imageId={m.imageId} imageBase={`${base}/menu-images`} name={m.name} />
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
                {staff && <MenuImage imageId={c.staff.find(person=>person.id===staff)?.imageId} imageBase={`${base}/images`} name={c.staff.find(person=>person.id===staff)?.name || "スタッフ"} className="staff-photo"/>}
                <Field label="ご希望の日付（日本時間）">
                  <DateInput aria-label="ご希望の日付（日本時間）"
                    min={localDate()}
                    value={date}
                    onValueChange={value => setDate(value)} />
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
                    (!isCustomer) ||
                    complete
                  }
                  onClick={() =>
                    run(async () => {
                      await api(`${base}/bookings`, {
                        name,
                        message: bookingMessage,
                        menuId: menu,
                        staffId: staff,
                        start: selected,
                        requestId,
                      });
                      setComplete(true);
                      notify(
                        "ご予約を承りました。マイページからご確認いただけます。",
                      );
                      await loadMine();
                    })
                  }
                >
                  {complete
                    ? "✓ 予約を受け付けました"
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
                    <MenuImage imageId={m.imageId} imageBase={`${base}/menu-images`} name={m.name} />
                    {m.name} · {m.duration}分 <b>{yen(m.price)}</b>
                  </div>
                ))}
              <h3>スタッフ</h3>
              <div className="public-staff-list">{c.staff.map(person => <div key={person.id}><MenuImage imageId={person.imageId} imageBase={`${base}/images`} name={person.name} className="staff-photo"/><span>{person.name}</span></div>)}</div>
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
              {!mine.length ? (
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
              className="panel contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
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
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="メールアドレス">
                <input aria-label="メールアドレス" type="email" autoComplete="email" required readOnly value={session.user?.email || ""} />
                <small className="muted">{session.user ? "ログイン中のGoogleアカウントのメールアドレスです。返信はこちらに届きます。" : "ログインすると、お名前とメールアドレスが自動入力されます。"}</small>
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
                disabled={busy || (!isCustomer)}
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
