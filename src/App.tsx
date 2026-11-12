import { storefrontText } from "../shared/storefront-copy";
import { setAiName, type AiName } from "./ai-name";
import { primaryNavigationItems } from "../shared/navigation";
import { InquiryFilePicker, useInquiryFiles } from "./InquiryFiles";
import { serviceName } from "../shared/brand";
import { Brand } from "./Brand";
import { Pagination, usePagination } from "./Pagination";
import { tr, intlLocale, listSeparator } from "../shared/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PaymentDetails } from "./PaymentDetails";
import { PaymentOperations } from "./PaymentOperations";
import { WaitlistRequest, WaitlistWishes, type SlotWish } from "./Waitlist";
import { BookingTransferControl, TransferBuying, TransferHistory, TransferOffers, type CancellationQuote, type MyTransfers, type TransferCheckout, type TransferListing } from "./Transfers";
import { BookingComplete } from "./BookingComplete";
import { browserVisitorId } from "./shop-access";
import { ShopAnalytics } from "./ShopAnalytics";
import type { BookingStep } from "../shared/booking-analytics";
import { Coupons, CouponWallet } from "./Coupons";
import { PhoneBooking, PhoneReplacement } from "./PhoneBooking";
import { couponDiscount, couponDiscountLabel, type CouponWalletItem } from "../shared/coupons";
import { defaultRefundTiers, policyText } from "../server/payment-domain";
import { StaffAccounts, StaffCalendar, StaffLogin, StaffPhoto } from "./StaffAccounts";
import { Inquiries } from "./Inquiries";
import type { ChatReference } from "../server/shop-chat";
import { DateInput } from "./DateInput";
import { CustomerRegistration } from "./CustomerRegistration";
import { CustomerEmailLogin } from "./CustomerEmailLogin";
import type { MemberProfile } from "../server/customer-profile";
import { BlogEditor, PublicBlog, RecentPosts, type Navigate } from "./Blog";
import type { PostCategory, PostSummary } from "../server/post-domain";
import { ShopOverview } from "./ShopOverview";
import { ManagementDashboard } from "./ManagementDashboard";
import { RecordDetailsDialog } from "./RecordDetailsDialog";
import { ConsultationWorkspace } from "./ConsultationHistory";
import { PublicationPreview } from "./PublicationPreview";
import { ShopRequest } from "./ShopRequest";
import { SiteHeader, SiteFooter, ThemeBody } from "./SiteChrome";
import { hasThemeFrame } from "../shared/theme-editing";
import { CustomPage } from "./CustomPage";
import { LiveSettings } from "./LiveSettings";
import { PhoneReception } from "./PhoneReception";
import type { PhoneSettings } from "../shared/phone";
import { LocalPreview } from "./LocalPreview";
import { Manual } from "./Manual";
import { MenuImage, MenuImageEditor } from "./MenuImage";
import { Customers } from "./Customers";
import { createRequestId } from "./request-id";
import { dashboardTab, useDashboardNavigation } from "./dashboard-navigation";
import React, { useCallback, useEffect, useState, useRef, useId } from "react";
import { useApi } from "./api";
import { bookableMenus, bookingStaff, bookingStaffName, bookingMenuName, bookingDates, menuSelection, menuAllowsOption, hoursText, specialDaysText, ownerStaffId, type ShopConfig, type Booking } from "../server/domain";
import type { Shop, User } from "../server/store";
import "./style.css";
import "./ManagementTypography.css";
import { LegacyNotes } from "./LegacyNotes";
import { JudgeStart, JudgeMenu, JudgeBar, AccessPassword } from "./JudgeAccess";
import { ShopReset } from "./ShopReset";
import { ImageLibrary } from "./ImageLibrary";
import { articleKinds } from "../shared/article-features";
import { Admin } from "./Admin";
import { Assistant } from "./Assistant";
import type { PayPalAlertState } from "../server/paypal-ops";
import type { OwnerIntegrationAlert } from "../server/integration-alerts";
import { ShopAbout } from "./ShopAbout";
import { Presentation } from "./Presentation";
import type { ScreenId } from "../shared/screens";
import { paid, createDisplay, useShopDisplay, ShopRegionContext } from "./money";
import { currencyOf, regionOf, dateIn, usTimeZones, type Region, type Currency } from "../shared/region";
export type Plan = {
  id: string;
  config: ShopConfig;
  summary: string[];
  approved: boolean;
  requiresSetup?: boolean;
  themeReview?: { attempts: number; approved: boolean; rendered?: boolean };
  chat?: ChatReference;
  base: number;
};
export type Inquiry = Omit<import("../server/customers").Inquiry, "shopId" | "at"> & { at?: string };
export type Workspace = Shop & {
  domainConnection?: import("../shared/custom-domain").DomainConnection;
  domainAddress?: string;
  isOwner: boolean;
  plans: Plan[];
  bookings: Booking[];
  paymentCheckouts?: { id: string; start: string; amount: number; currency?: Currency; phase: string; review: boolean; customer: string; name: string }[];
  transferListings?: { id: string; bookingId: string; price: number; currency: Currency; discountPercent: number; deadline: string; buying: boolean; review: boolean; unsold: number }[];
  transferHistory?: (NonNullable<Workspace["transferListings"]>[number] & { phase: "listed" | "sold" | "expired" | "withdrawn" })[];
  paypalAlerts?: PayPalAlertState;
  paypalSettings?: { enabled: boolean; digestHour: number };
  phoneSettings?: PhoneSettings;
  inquiries: Inquiry[];
  members: { email: string; accepted: boolean; status?: string }[];
  jobs: { type: string; attempts?: number; mailKind?: string; terminalReason?: string }[];
  integrationAlerts?: OwnerIntegrationAlert[];
  publicUrl: string;
};
export type Session = { user: (User & { admin?: boolean }) | null; demo: boolean; aiName?: AiName; hosted?: string; invite?: boolean; judgeCustomer?: boolean; judgeOwnerAvailable?: boolean; judgePublished?: boolean; assistantVoice?: boolean };
const weekdays = () => [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
export type AppProps = {
  path?: string;
  search?: string;
  initialTab?: string;
  initialPane?: string;
  navigate?: Navigate;
};
const attentionCount = (shop?: Workspace) => (shop?.paypalAlerts?.items.length || 0) + (shop?.integrationAlerts?.length || 0);
export function App({
  path = location.pathname,
  search = location.search,
  initialTab = new URLSearchParams(search).has("customer") ? "customers" : new URLSearchParams(search).get("calendar") === "connected" ? "staff" : "dashboard",
  initialPane,
  navigate: customNavigate,
}: AppProps = {}) {
  const navigate: Navigate = customNavigate || (href => location.assign(href));
  const api = useApi();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Ctrl+Shift+L toggles operator controls. Judges see theirs once the shop is published, and a hidden choice
  // survives reloads in the same tab so a recording can hide them once; others start hidden on every load.
  const judgeControlsKey = "gemihub:judgeControlsHidden";
  const [operatorControlsShown, setOperatorControlsShown] = useState(false);
  const [judgeControlsHidden, setJudgeControlsHidden] = useState(() => {
    try { return sessionStorage.getItem(judgeControlsKey) === "1"; } catch { return false; }
  });
  const judgeSession = !!(session?.user?.judge || session?.judgeCustomer || session?.judgeOwnerAvailable);
  useEffect(() => {
    if (!judgeSession) return;
    try { sessionStorage.setItem(judgeControlsKey, judgeControlsHidden ? "1" : "0"); } catch { /* storage unavailable */ }
  }, [judgeSession, judgeControlsHidden]);
  const refresh = () => api<Session>("/api/session").then(next => { setAiName(next.aiName); setSession(next); });
  const judgePublishedChanged = useCallback((published: boolean) => {
    setSession(current => current?.user?.judge && current.judgePublished !== published ? { ...current, judgePublished: published } : current);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const toggleOperatorControls = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && !event.isComposing && (event.code === "KeyL" || event.key.toLowerCase() === "l")) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) { setOperatorControlsShown(value => !value); setJudgeControlsHidden(value => !value); }
      }
    };
    window.addEventListener("keydown", toggleOperatorControls, true);
    return () => window.removeEventListener("keydown", toggleOperatorControls, true);
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
    return <div className="loading">{error || tr("お店の準備をしています…")}</div>;
  const showOperatorControls = judgeSession ? !judgeControlsHidden : operatorControlsShown;
  const showJudgeControls = showOperatorControls && !!(session.judgePublished || session.judgeCustomer || session.judgeOwnerAvailable);
  const displaySession = !showJudgeControls && session.user && (session.user.judge || session.judgeCustomer)
    ? { ...session, user: { ...session.user, name: "John" } }
    : session;
  const match = path.match(
    /^\/(s)\/([^/]+)(?:\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?)?$/,
  );
  const hostedPost = session.hosted
    ? path.match(/^\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?$/)
    : null;
  const isPublic = !!match || !!session.hosted;
  return (
    <>
      {isPublic && <LanguageSwitcher />}
      {!isPublic && <header className="app-header">
        <Brand />
        <div className="header-right">
          <div className="header-language"><LanguageSwitcher /></div>
          <details className="header-language-menu">
            <summary>{tr("言語")}</summary>
            <LanguageSwitcher embedded />
          </details>
          <span className="small muted">
            {displaySession.user?.name || tr("あなたのお店を、あなたの言葉で。")}
          </span>
          {session.user?.role === "owner" && session.user.legacyNotes && <a className="text-button" href="/settings/migration">{tr("旧環境からの引き継ぎ")}</a>}
          {showJudgeControls && (session.user?.judge || session.judgeCustomer || session.judgeOwnerAvailable) && <a className="text-button" href="/judge-menu">{tr("審査メニュー")}</a>}
          {showOperatorControls && session.user?.admin && <a className="text-button" href="/admin">{tr("運営管理")}</a>}
          {session.user?.role === "owner" && session.user.shopId && !session.user.judge && !session.user.legacyNotes && !session.user.accessPending && <ShopReset shopId={session.user.shopId} navigate={navigate} showButton={showOperatorControls} />}
          {!session.user && <a className="text-button" href="/lp">{tr("サービス紹介")}</a>}
          {!isPublic && (
            <a className="text-button" href="/manual">
              {tr("使い方")}</a>
          )}
          {session.user && (
            <button className="text-button" onClick={logout}>
              {tr("ログアウト")}</button>
          )}
        </div>
      </header>}
      <main>
        {showJudgeControls && session.user?.judge && !isPublic && (
          <div className="demo-banner judge-banner">
            {tr("審査員アクセス · メールは送信されません。内容は")}<a href="/judge-menu">{tr("審査メニュー")}</a>{tr("で確認できます。")}</div>
        )}
        {showJudgeControls && path !== "/judge-menu" && !session.hosted && (session.judgeCustomer || session.user?.judge || session.judgeOwnerAvailable) && <JudgeBar customer={session.user?.role !== "owner"} recovery={session.judgeOwnerAvailable} published={!!session.judgePublished} run={run} />}
        {error && (
          <div className="alert" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label={tr("エラーを閉じる")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {/^\/judge\/[^/]+$/.test(path) ? (
          <JudgeStart invite={path.split("/")[2]} signedIn={!!(session.user?.judge || session.judgeCustomer || session.judgeOwnerAvailable)} run={run} />
        ) : path === "/judge-menu" && (session.user?.judge || session.judgeCustomer || session.judgeOwnerAvailable) ? (
          <JudgeMenu customer={session.user?.role !== "owner"} canReturnToOwner={session.judgeOwnerAvailable} run={run} />
        ) : path === "/admin" && session.user?.admin ? (
          <Admin run={run} />
        ) : path !== "/manual" && !isPublic && session.user?.role === "owner" && session.user.accessPending ? (
          <AccessPassword email={session.user.email} run={run} />
        ) : path !== "/manual" && !isPublic && session.user?.role === "owner" && session.user.legacyNotes ? (
          <LegacyNotes email={session.user.email} check={async force => { await api("/api/legacy-notes/check", { force }); navigate("/"); }} />
        ) : path === "/manual" && !isPublic ? (
          <Manual />
        ) : isPublic ? (
          <PublicShop
            session={displaySession}
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
        ) : session.judgeCustomer || !session.user && session.judgeOwnerAvailable ? (
          <JudgeMenu customer run={run} />
        ) : session.user ? (
          <Dashboard
            initialTab={initialTab}
            search={search}
            browserNavigation={!customNavigate}
            session={session}
            run={run}
            busy={busy}
            notify={setNotice}
            onPublishedChange={judgePublishedChanged}
          />
        ) : (
          <Landing demo={session.demo} invite={!!session.invite} run={run} />
        )}
      </main>
      {!isPublic && <footer>
        <span>{serviceName} — {tr("お店のシステムを、言葉で。")}</span>
        <span>{tr("データも、仕様も、あなたの手の中に。")}</span>
      </footer>}
      {busy && (
        <div className="busy" role="status">
          {tr("処理しています…")}</div>
      )}
    </>
  );
}
type Run = (fn: () => Promise<void>) => Promise<void>;
function Landing({ demo, invite, run }: { demo: boolean; invite: boolean; run: Run }) {
  const api = useApi();
  return (
    <div className="landing">
      <div className="eyebrow">{tr("小さなお店に、ぴったりの予約システム。")}</div>
      <h1>
        {tr("お店のことを話す。")}<br />
        {tr("予約の仕組みが、")}<em>{tr("できあがる。")}</em>
      </h1>
      <p className="lead">
        {tr("メニューも、営業時間も、いつもの言葉で。")}<br />
        {tr("あなたのお店のルールに合う予約ページを、一緒に作ります。")}</p>
      <a className="button primary" href="/auth/google">
        {tr("G　Google でお店をはじめる ")}<span>↗</span>
      </a>
      {invite && <p className="small muted invite-note">{tr("現在は招待制です。新しくお店をはじめるには、ログイン後に招待パスワードが必要です。")}</p>}
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
          {tr("サロンのデモを試す →")}</button>
      )}
      <div className="hero-card">
        <span className="pill">{tr("あなたの言葉が、はじまり。")}</span>
        <div className="chat-message">
          {tr("夫婦で営む、小さなネイルサロンです。")}<br />
          {tr("火曜日はお休み。指名なしでも予約できるようにしたい。")}</div>
        <div className="chat-answer">
          <span>✳</span>
          <p>
            {tr("お二人のどちらかが空いていれば予約できる、")}<br />
            {tr("お店専用の仕組みをご提案します。")}</p>
        </div>
        <div className="flow">
          <span>{tr("01 話す")}</span>
          <span>{tr("02 確かめる")}</span>
          <span>{tr("03 公開する")}</span>
        </div>
      </div>
      <div className="values">
        <div>
          <b>{tr("あなたのお店に合わせる")}</b>
          <p>{tr("メニュー、スタッフ、予約のルールまで。")}</p>
        </div>
        <div>
          <b>{tr("公開したあとも、言葉で")}</b>
          <p>{tr("変更内容を確認してから、お店に反映。")}</p>
        </div>
        <div>
          <b>{tr("データは、あなたのもの")}</b>
          <p>{tr("JSON・CSVでいつでも書き出し。")}</p>
        </div>
      </div>
    </div>
  );
}
function Dashboard({
  initialTab = "dashboard",
  search,
  browserNavigation,
  session,
  run,
  busy,
  notify,
  onPublishedChange,
}: {
  initialTab?: string;
  search: string;
  browserNavigation: boolean;
  session: Session;
  run: Run;
  busy: boolean;
  notify: (s: string) => void;
  onPublishedChange?: (published: boolean) => void;
}) {
  const api = useApi();
  const navigation = useDashboardNavigation(search, initialTab, browserNavigation);
  const { tab, shop: chosen, screen: initialScreen, article: initialArticleKey, customer: initialCustomer, customerImages: initialCustomerImages, inquiry: initialInquiryId, focusRequest, intent: requestIntent, conversation: selectedConversation } = navigation.route;
  const editorSelection = useRef({ screen: initialScreen || "theme", article: initialArticleKey });
  const [shops, setShops] = useState<Workspace[]>([]);
  const [consultationRevision, setConsultationRevision] = useState(0);
  const [assistantQuestion, setAssistantQuestion] = useState<{shopId:string;conversationId:string;question:string}>();
  const attentionRequest = useRef<{question:string;requestId:string} | undefined>(undefined);
  // Until the first workspace response, an empty list means "loading", not "no shops".
  const [loaded, setLoaded] = useState(false);
  const [treeHost, setTreeHost] = useState<HTMLDivElement | null>(null);
  const [editorTreeOpen, setEditorTreeOpen] = useState(true);
  const editorTreeId = useId();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const buildReview = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<Plan>();
  async function load() {
    const w = await api<{ shops: Workspace[] }>("/api/workspace");
    setShops(w.shops);
    setLoaded(true);
    return w.shops;
  }
  async function reloadInquiries(shopId: string) {
    const inquiries = await api<Inquiry[]>(`/api/shops/${shopId}/inquiries`);
    setShops(current => current.map(item => item.id === shopId ? { ...item, inquiries } : item));
  }
  useEffect(() => {
    run(async () => {
      await load();
    });
  }, []);
  const shop = shops.find((s) => s.id === chosen) || shops[0];
  useEffect(() => { if (shop && session.user?.judge) onPublishedChange?.(!!shop.published); }, [shop?.id, !!shop?.published, session.user?.judge, onPublishedChange]);
  const creating = !!shop?.isOwner && !shop.published;
  const publiclyPublished = !!shop?.published && shop.publication !== "provisional";
  const shopRegion = shop?.published ? regionOf(shop.published) : shop?.regionDefault || regionOf(null);
  // The dashboard needs a published configuration; staff of an unpublished shop start on their own page.
  const fallbackTab = shop?.published ? "dashboard" : "staff";
  const activeTab = (!publiclyPublished && ["bookings", "payments", "transfers", "customers", "analytics", "coupons"].includes(tab)) || (tab === "dashboard" && !shop?.published)
    ? fallbackTab : tab;
  const view = creating ? "build" : activeTab;
  function closeMobileMenu() {
    setMobileMenuOpen(false);
    if (mobileMenuOpen && window.matchMedia("(max-width: 760px)").matches) menuToggle.current?.focus();
  }
  function setTab(value: string, recordId?: string) {
    closeMobileMenu();
    const next = dashboardTab(value);
    navigation.visit(next, shop?.id || chosen, next === "try" ? editorSelection.current.screen : undefined, next === "try" ? editorSelection.current.article : undefined, false, undefined, recordId);
  }
  function selectConsultation(id?: string, replace = false) {
    closeMobileMenu(); navigation.visit("assistant", shop.id, undefined, undefined, replace, id);
  }
  async function askFromDashboard(question: string) {
    if (attentionRequest.current?.question !== question) attentionRequest.current = {question,requestId:createRequestId()};
    const chat = await api<{id:string}>(`/api/shops/${shop.id}/conversations`, {intent:"consult",requestId:attentionRequest.current.requestId});
    attentionRequest.current = undefined;
    setAssistantQuestion({shopId:shop.id,conversationId:chat.id,question});
    setConsultationRevision(value => value + 1); selectConsultation(chat.id);
  }
  useEffect(() => {
    if (!shop) return;
    const allowed = !shop.isOwner && ["try", "images", "basic", "menus", "coupons", "payments", "transfers"].includes(tab) ? fallbackTab : view;
    if (allowed !== tab) navigation.visit(allowed, shop.id, undefined, undefined, true);
  }, [shop?.id, shop?.isOwner, view, tab, publiclyPublished]);
  useEffect(() => {
    if (tab === "try" && view === "try") editorSelection.current = { screen: initialScreen || "reserve", article: initialArticleKey };
  }, [tab, initialScreen, initialArticleKey]);
  useEffect(() => { setPlan(undefined); }, [shop?.id]);
  const activePlan =
    shop?.plans.find(p => p.id === shop.publishingPlanId) || (plan && plan.base === shop?.revision && shop.plans.some((p) => p.id === plan.id)
      ? plan
      : shop?.plans.find(p => p.base === shop.revision && p.id === navigation.route.plan) || shop?.plans.filter((p) => p.base === shop.revision).at(-1));
  const request = (action: string, data: unknown = {}) =>
    api(`/api/shops/${shop.id}/${action}`, data);
  const acceptPlan = async (p: Plan) => {
    const publication = !shop.published || shop.publication === "provisional" ? "provisional" : "public";
    await request(`plans/${p.id}/approve`);
    await request(`plans/${p.id}/publish`, { publication });
    setPlan(undefined);
    await load();
    if (!shop.published) setTab("dashboard");
    notify(publication === "provisional" ? tr("仮公開しました。あなたのログインでだけページを表示できます。") : tr("変更を反映しました。"));
  };
  const menuItems = [
    ["dashboard", "⌂", tr("ダッシュボード")],
    ["assistant", "✳", tr("相談・質問")],
    ["configuration", "⚙", tr("設定")],
    ...(shop?.isOwner ? [["try", "✧", tr("AIとお店をつくる")]] : []),
    ...(publiclyPublished ? [["bookings", "▦", tr("予約を管理")], ["customers", "♧", tr("お客様")], ["analytics", "▥", tr("分析")]] : []),
    ...(publiclyPublished && shop?.isOwner ? [["coupons", "◇", tr("クーポン")]] : []),
    ...(publiclyPublished && shop?.isOwner ? [["payments", currencyOf(shopRegion) === "USD" ? "$" : "¥", tr("決済・返金")], ["transfers", "↻", tr("キャンセル枠の再販売")]] : []),
    ["inquiries", "✉", tr("お問い合わせ")],
    ...(articleKinds(shop?.published).length ? [["blog", "✎", articleKinds(shop?.published).length === 2 ? tr("ブログ・お知らせ") : articleKinds(shop?.published)[0] === "blogs" ? tr("ブログ") : tr("お知らせ")]] : []),
    ...(!shop?.isOwner ? [["staff", "♧", tr("自分のカレンダー")]] : []),
    ["manual", "?", tr("使い方")],
  ];
  const settingItems = [
    ...(shop?.isOwner ? [["basic", "⌂", tr("お店の基本情報")], ["menus", "≡", tr("メニュー・料金")], ["staff", "♧", tr("スタッフ・勤務")], ["images", "▧", tr("画像管理")]] : []),
    ["settings", "⚙", tr("公開の設定")],
  ];
  const currentMenuLabel = view === "build" && shop?.published ? tr("ページ追加・機能変更") : [...menuItems, ...settingItems].find(([id]) => id === view)?.[2];
  const shopUrl = shop?.published ? new URL(shop.publicUrl, location.origin).href : undefined;
  return (
    <ShopRegionContext.Provider value={shopRegion}>
    <div className={`dashboard${creating || !shop ? " dashboard-creation" : ""}`}>
      {shop && !creating && <aside className={mobileMenuOpen ? "mobile-menu-open" : ""} onKeyDown={event => {
        if (event.key === "Escape" && mobileMenuOpen) { event.preventDefault(); closeMobileMenu(); }
      }}>
        <button type="button" className="mobile-menu-toggle" ref={menuToggle} aria-expanded={mobileMenuOpen} aria-controls={menuId} onClick={() => setMobileMenuOpen(open => !open)}>
          <span className="mobile-menu-icon" aria-hidden="true">{mobileMenuOpen ? "×" : "☰"}</span>
          <span className="mobile-menu-label">{mobileMenuOpen ? tr("メニューを閉じる") : tr("管理メニュー")}</span>
          <span className="mobile-menu-current">{currentMenuLabel}</span>
        </button>
        <div className="sidebar-label">MY SHOP</div>
        <div className="shop-switch">
          <span className="shop-avatar">✳</span>
          <strong>{shop?.published?.name || tr("わたしのお店")}</strong>
        </div>
        {shopUrl && <div className="sidebar-shop-url">
          {shop.publication === "provisional" && <span className="muted">{tr("仮公開")}</span>}
          <a href={shopUrl} target="_blank" rel="noreferrer" aria-label={`${tr("お店のアドレス")}: ${shopUrl}`}>
            {shopUrl} <span aria-hidden="true">↗</span>
          </a>
        </div>}
        {shops.length > 1 && (
          <select
            value={shop?.id}
            onChange={(e) => {
              closeMobileMenu();
              if (!navigation.visit(tab, e.target.value, tab === "try" ? "reserve" : undefined)) return;
              editorSelection.current = { screen: "reserve", article: undefined };
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
        <nav id={menuId} aria-label={tr("管理メニュー")}>
          {menuItems.map(([id, icon, label]) => (
            id === "configuration" ? <details className="sidebar-settings" key={id} open>
              <summary><span aria-hidden="true">{icon}</span>{label}</summary>
              <div className="sidebar-settings-items" role="group" aria-label={label}>
                {settingItems.map(([setting, settingIcon, settingLabel]) => <button key={setting} className={view === setting ? "active" : ""} aria-current={view === setting ? "page" : undefined} onClick={() => setTab(setting)}><span aria-hidden="true">{settingIcon}</span>{settingLabel}</button>)}
              </div>
            </details> : id === "try" ? <div className="sidebar-editor" key={id}>
              <div className={`sidebar-editor-row${view === id || view === "build" ? " active" : ""}`}>
                <button type="button" className="sidebar-editor-toggle" aria-label={editorTreeOpen ? tr("画面一覧を折り畳む") : tr("画面一覧を開く")} aria-expanded={editorTreeOpen} aria-controls={editorTreeId} onClick={() => setEditorTreeOpen(open => !open)}><span aria-hidden="true">{editorTreeOpen ? "▾" : "▸"}</span></button>
                <button className="sidebar-editor-open" aria-current={view === id ? "page" : undefined} onClick={() => setTab(id)}><span aria-hidden="true">{icon}</span>{label}</button>
              </div>
              <div className="sidebar-editor-tree" id={editorTreeId} hidden={!editorTreeOpen} ref={setTreeHost} />
            </div> : <button key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {id === "dashboard" && shop?.isOwner && attentionCount(shop) > 0 && <span className="alert-badge" aria-label={tr("要対応 {0}件", attentionCount(shop))}>{attentionCount(shop)}</span>}
            </button>
          ))}
          <div className="sidebar-language">
            <span className="small muted">{tr("言語")}</span>
            <LanguageSwitcher embedded />
          </div>
        </nav>
        {!shop?.published && <div className="sidebar-bottom">
          <i />
          {tr("公開前の準備中")}
          <p>{tr("まずは、お店のことを")}<br />{tr("聞かせてください。")}</p>
        </div>}
      </aside>}
      <section className="workspace">
        {!shop ? (
          loaded ? <p>
            {tr("運営できるお店はありません。スタッフの方は、店主から案内されたスタッフ用ログインURLからログインしてください。")}</p>
            : <p className="loading" role="status">{tr("お店の準備をしています…")}</p>
        ) : (
          <>
            {view === "manual" ? (
              <Manual />
            ) : (
              <>
                {shop.published && shop.publication === "provisional" && <section className="notice publication-status" aria-label={tr("公開状態")}>
                  <div className="publication-status-top"><div><h2>{tr("仮公開中")}</h2>
                  <p>{tr("ページを用意したGoogleアカウントでログインした本人だけが見られます。")}</p></div>
                  {shop.isOwner && <div className="publication-next-step"><b>{tr("お客様への公開はこちら")}</b>
                    <a className="button primary" data-publication-preview-link href={`/publication-preview/${shop.id}`}>{tr("画面を確認して本番公開へ ")}<span aria-hidden="true">→</span></a>
                    <p>{tr("次の画面で表示を確かめてから、本番公開できます。")}</p>
                  </div>}</div>
                  <p>{tr("スタッフ・メニュー・料金・営業時間などは、それぞれの設定メニューで更新できます。")}</p>
                  <p className="editing-guidance">{tr("デザインは各画面の編集画面で更新してください。")}<button className="text-button" onClick={() => setTab("try")}>{tr("AIとお店をつくる →")}</button><br />{tr("全体的な表示や機能の修正は")}<button className="text-button" onClick={() => setTab("build")}>{tr("ページ追加・機能変更")}</button>{tr("で相談できます。")}</p>
                </section>}
                {shop.publishingPlanId && (
                  <div className="alert">
                    {tr("保存・反映が未完了です。予約受付を一時停止しています。操作した管理画面から再試行してください。")}</div>
                )}
                {view === "dashboard" && shop.published && <ManagementDashboard key={shop.id} shop={shop} busy={busy} refresh={() => void run(async () => { await load(); })} reload={load} onAsk={askFromDashboard} open={setTab} />}
                {view === "build" && (
                  <>
                    {shop.published && <ShopOverview key={`${shop.id}-${shop.revision}`} shopId={shop.id} focusRequest={focusRequest} initialIntent={requestIntent} isOwner={shop.isOwner} plan={activePlan} onAccept={acceptPlan} onPlan={async (text, context, imageIds, intent, chat) => {
                      const p = await api<Plan>(`/api/shops/${shop.id}/plan`, { text, context, imageIds, intent, chat });
                      setPlan(p); await load(); return p;
                    }} />}
                    {!shop.published && <div className="steps initial-steps">{[tr("内容を確認"), tr("仮公開"), tr("本番公開")].map((label, i) => <div key={label} className={i === 0 ? "current" : ""} aria-current={i === 0 ? "step" : undefined}><span>0{i + 1}</span>{label}</div>)}</div>}
                    <div ref={buildReview} className="build-plan-area">
                      <div>
                        {!shop.published && <div className="panel interview">{!activePlan && <h2>{tr("AIとお店をつくる")}</h2>}<ShopRequest key={`${shop.id}:${session.user?.email}`} shopId={shop.id} published={false} isOwner={shop.isOwner} context={{revision:shop.revision,hash:""}} plan={activePlan} onPlan={async (text, imageIds, intent, chat) => { const p = await api<Plan>(`/api/shops/${shop.id}/plan`, { text, imageIds, intent, chat }); setPlan(p); await load(); return p; }} onAccept={acceptPlan} /></div>}
                      </div>
                    </div>
                  </>
                )}
                {view === "assistant" && shop.published && <ConsultationWorkspace key={`${shop.id}:${session.user?.email}`} shopId={shop.id} email={session.user!.email} active selected={selectedConversation} revision={consultationRevision} onSelect={selectConsultation}>{selectedConversation ? <Assistant key={`${shop.id}:${session.user?.email}:${selectedConversation}`} conversationId={selectedConversation} initialQuestion={assistantQuestion?.shopId === shop.id && assistantQuestion.conversationId === selectedConversation ? assistantQuestion.question : undefined} onInitialQuestionConsumed={() => setAssistantQuestion(undefined)} onConversationChange={() => setConsultationRevision(value => value + 1)} shop={shop} userEmail={session.user?.email || ""} voice={!!session.assistantVoice} acceptPlan={acceptPlan} reload={load} /> : <section className="panel"><h2>{tr("相談・質問")}</h2><p>{tr("左の「＋新規の相談」から相談を始められます。")}</p></section>}</ConsultationWorkspace>}
                {view === "analytics" && <ShopAnalytics shopId={shop.id} />}
                {view === "basic" && shop.isOwner && <section className="basic-settings" aria-label={tr("お店の基本情報と予約の設定")}>{(["basic","hours","rules"] as const).map(section=><LiveSettings key={`${shop.id}-${section}`} shop={shop} section={section} reload={load}/>)}</section>}
                {view === "menus" && shop.isOwner && <LiveSettings key={`${shop.id}-menus`} shop={shop} section="menus" reload={load} />}
                {view === "coupons" && shop.isOwner && shop.published && <Coupons key={shop.id} shopId={shop.id} config={shop.published}/>}
                {view === "staff" && <>{shop.isOwner && <><LiveSettings key={`${shop.id}-staff`} shop={shop} section="staff" reload={load} /><StaffAccounts key={`${shop.id}-${shop.revision}`} shop={shop} onSaved={load}/></>}{!shop.isOwner && <><StaffCalendar key={shop.id} shop={shop} onSaved={load}/><StaffPhoto shop={shop} reload={load}/></>}</>}
                {view === "bookings" && (
                  <Reservations key={shop.id} shop={shop} run={run} reload={load} open={setTab} />
                )}
                {(view === "payments" || view === "transfers") && shop.isOwner && <PaymentOperations key={`${shop.id}:${view}`} mode={view} shop={shop} reload={load} onAsk={askFromDashboard} open={setTab} />}
                {view === "customers" && <Customers key={`${shop.id}:${initialCustomer}:${initialCustomerImages}:${initialInquiryId}`} shopId={shop.id} config={shop.published} initialEmail={initialCustomer} initialImages={initialCustomerImages} initialInquiryId={initialInquiryId} backToInquiries={()=>setTab("inquiries")} inquiriesChanged={()=>reloadInquiries(shop.id)} />}
                {view === "blog" && (
                  <BlogEditor
                    shop={shop}
                    run={run}
                    busy={busy}
                    notify={notify}
                    reload={load}
                    demo={session.demo}
                  />
                )}
                {!creating && <div hidden={view!=="inquiries"}><Inquiries key={shop.id} shopId={shop.id} inquiries={shop.inquiries} initialInquiryId={view === "inquiries" ? initialInquiryId : undefined} back={() => setTab("inquiries")} reload={()=>reloadInquiries(shop.id)}/></div>}
                {view === "images" && shop.isOwner && <ImageLibrary key={shop.id} shopId={shop.id} />}
                {view === "settings" && (
                  <Settings shop={shop} run={run} reload={load} hasLegacyNotes={!!session.user?.legacyNotes} />
                )}
              </>
            )}
          </>
        )}
        {shop?.isOwner && shop.published && <div hidden={view !== "try"}><LocalPreview key={shop.id} active={view === "try"} changesSelected={view === "build"} onChooseChanges={() => setTab("build")} initialScreen={tab === "try" ? initialScreen || "reserve" : undefined} initialArticleKey={tab === "try" ? initialArticleKey : undefined} onScreenChange={(screen, article) => { closeMobileMenu(); editorSelection.current = { screen, article }; navigation.visit("try", shop.id, screen, article); }} shop={shop} email={session.user!.email} reload={load} sidebar={treeHost} /></div>}
      </section>
    </div>
    </ShopRegionContext.Provider>
  );
}
export function ConfigSummary({ config: c }: { config: ShopConfig }) {
  const { money: yen } = createDisplay(regionOf(c));
  return (
    <div className="config-summary">
      <h3>{c.name}</h3>
      <p>{c.description}</p>
      <div className="summary-grid">
        <div>
          <span>{tr("営業時間")}</span>
          <b>
            {hoursText(c)}
          </b>
        </div>
        <div>
          <span>{tr("定休日")}</span>
          <b>
            {c.hours.closedWeekdays.map((d) => weekdays()[d]).join(listSeparator()) ||
              tr("なし")}
          </b>
        </div>
        <div>
          <span>{tr("予約の受け方")}</span>
          <b>
            {tr("お客様が指名・指名なしを選ぶ")}</b>
        </div>
        <div>
          <span>{tr("予約のお知らせを受け取るメール")}</span>
          <b>{c.notificationEmail}</b>
        </div>
        <div><span>{tr("住所・アクセス")}</span><b>{c.address || tr("未入力")}</b></div>
      </div>
      {c.menus
        .filter((m) => m.active)
        .map((m) => (
          <div className="menu-row" key={m.id}>
            <span>
              {m.name} <small>{m.duration}{tr("分")}</small>
            </span>
            <b>{yen(m.price)}</b>
          </div>
        ))}
      <details>
        <summary>{tr("スタッフと予約の決まりを見る")}</summary>
        <h4>{tr("スタッフが働く日と時間")}</h4>
        <ul>{bookingStaff(c).map(staff => <li key={staff.id}><b>{staff.name}</b>：{staff.weekdays.map(day => weekdays()[day]).join(listSeparator()) || tr("勤務日なし")} {staff.start}〜{staff.end}{tr("（担当：")}{staff.menuIds.map(id => c.menus.find(menu => menu.id === id)?.name).filter(Boolean).join(listSeparator("、")) || tr("なし")}）</li>)}</ul>
        <h4>{tr("予約の決まり")}</h4>
        <ul>
          <li>{tr("予約できるのは")}{c.rules.advanceDays}{tr("日先まで、開始の")}{c.rules.leadMinutes}{tr("分前までです。")}</li>
          <li>{tr("当日の予約は")}{c.rules.sameDay ? tr("受け付けます") : tr("受け付けません")}。</li>
          <li>{tr("予約の時刻は")}{c.rules.interval}{tr("分ごとに選べます。")}</li>
          <li>{c.rules.payment?.enabled ? tr("予約時にPayPalでお支払い。{0}", policyText(c.rules.payment.refundTiers)) : tr("キャンセルは開始の{0}時間前までです。", c.rules.cancelHours)}</li>
          <li>{tr("臨時のお休み：")}{c.hours.holidays.join(listSeparator("、")) || tr("なし")}</li>
          {!!c.hours.specialDays?.length && <li>{tr("特別営業日：")}{specialDaysText(c)}</li>}
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
type StaffWorkingConditions = Pick<ShopConfig["staff"][number], "start" | "end" | "weekdays" | "menuIds">;
function StaffAvailability({ staff, menus, onChange }: { staff: StaffWorkingConditions; menus: ShopConfig["menus"]; onChange: (value: Partial<StaffWorkingConditions>) => void }) {
  return <>
    <div className="form-grid">
      <Field label={tr("勤務開始")}><input type="time" value={staff.start} onChange={event => onChange({ start: event.target.value })}/></Field>
      <Field label={tr("勤務終了")}><input type="time" value={staff.end} onChange={event => onChange({ end: event.target.value })}/></Field>
    </div>
    <span className="small">{tr("勤務曜日")}</span>
    <div className="checkboxes">{weekdays().map((day,index) => <label key={day}><input type="checkbox" checked={staff.weekdays.includes(index)} onChange={event => onChange({ weekdays: event.target.checked ? [...staff.weekdays,index] : staff.weekdays.filter(value => value !== index) })}/>{day}</label>)}</div>
    <span className="small">{tr("対応メニュー")}</span>
    <div className="checkboxes">{menus.map(menu => <label key={menu.id}><input type="checkbox" checked={staff.menuIds.includes(menu.id)} onChange={event => onChange({ menuIds: event.target.checked ? [...staff.menuIds,menu.id] : staff.menuIds.filter(id => id !== menu.id) })}/>{menu.name}</label>)}</div>
  </>;
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
  const [showHiddenMenus, setShowHiddenMenus] = useState(false);
  const put = <K extends keyof ShopConfig>(k: K, v: ShopConfig[K]) =>
    set({ ...c, [k]: v });
  const owner = bookingStaff(c).find(staff => staff.id === ownerStaffId);
  const putOwner = (value: Partial<Omit<ShopConfig["staff"][number], "id">>) => {
    if (owner) set({ ...c, ownerBooking: true, staff: [...c.staff.filter(staff => staff.id !== ownerStaffId), { ...owner, ...value }] });
  };
  return (
    <div className="editor">
      {(!section || section === "profile" || section === "basic") && <>
      <div className="form-grid">
        <Field label={tr("店名")}>
          <input value={c.name} onChange={(e) => put("name", e.target.value)} />
        </Field>
        <Field label={tr("業種")}>
          <select
            value={c.industry}
            onChange={(e) =>
              put("industry", e.target.value as ShopConfig["industry"])
            }
          >
            <option value="nail">{tr("ネイルサロン")}</option>
            <option value="hair">{tr("美容室")}</option>
            <option value="other">{tr("その他")}</option>
          </select>
        </Field>
      </div>
      <Field label={tr("お店の紹介")}>
        <textarea
          value={c.description}
          onChange={(e) => put("description", e.target.value)}
        />
      </Field>
      <Field label={tr("住所・アクセス")}>
        <input
          value={c.address}
          onChange={(e) => put("address", e.target.value)}
        />
      </Field>
      <label className="check-field">
        <input type="checkbox" checked={!!c.map?.enabled} onChange={(e) => put("map", { enabled: e.target.checked, query: c.map?.query || "" })} />
        {tr("アクセスに Google マップを表示する")}
      </label>
      {c.map?.enabled && <Field label={tr("地図で示す場所（空欄なら住所）")}>
        <input value={c.map.query} maxLength={300} placeholder={c.address} onChange={(e) => put("map", { enabled: true, query: e.target.value })} />
      </Field>}
      <Field label={tr("通知メールの宛先")}>
        <input
          type="email"
          value={c.notificationEmail}
          onChange={(e) => put("notificationEmail", e.target.value)}
        />
      </Field>
      <Field label={tr("国（通貨）")}>
        <select
          aria-label={tr("国（通貨）")}
          value={regionOf(c).country}
          onChange={(e) => put("region", (e.target.value === "US" ? { country: "US", timeZone: "America/New_York" } : { country: "JP", timeZone: "Asia/Tokyo" }) as Region)}
        >
          <option value="JP">{tr("日本（円）")}</option>
          <option value="US">{tr("米国（ドル）")}</option>
        </select>
      </Field>
      {regionOf(c).country === "US" && <Field label={tr("タイムゾーン")}>
        <select aria-label={tr("タイムゾーン")} value={regionOf(c).timeZone} onChange={(e) => put("region", { country: "US", timeZone: e.target.value })}>
          {usTimeZones.map(zone => <option key={zone} value={zone}>{{ "America/New_York": tr("東部時間（ニューヨーク）"), "America/Chicago": tr("中部時間（シカゴ）"), "America/Denver": tr("山地時間（デンバー）"), "America/Phoenix": tr("山地時間・夏時間なし（フェニックス）"), "America/Los_Angeles": tr("太平洋時間（ロサンゼルス）"), "America/Anchorage": tr("アラスカ時間（アンカレッジ）"), "Pacific/Honolulu": tr("ハワイ時間（ホノルル）") }[zone]}</option>)}
        </select>
      </Field>}
      <p className="small muted">{tr("料金の通貨と、営業時間・予約枠の時刻はこの国とタイムゾーンで決まります。国を変えても料金は換算しないので、メニューの料金を見直してください。")}</p>
      </>}
      {(!section || section === "menus") && <>
      <h3>{tr("メニュー")}</h3>
      <label className="check-field"><input type="checkbox" checked={showHiddenMenus} onChange={event => setShowHiddenMenus(event.target.checked)} /><span>{tr("非表示も表示")}</span></label>
      {!c.menus.length ? <p className="small muted">{tr("メニューはまだ登録されていません。「＋ メニューを追加」から登録してください。")}</p> : !showHiddenMenus && !c.menus.some(menu => menu.active) && <p className="small muted">{tr("有効なメニューはありません。「非表示も表示」をONにすると、無効なメニューを確認・編集できます。")}</p>}
      {c.menus.map((m, i) => !showHiddenMenus && !m.active ? null : (
        <div className="menu-edit-block" key={m.id}><div className="edit-row">
          <Field label={tr("メニュー名")}>
          <input
            aria-label={tr("メニュー名")}
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
          </Field>
          <Field label={tr("所要時間（分）")}>
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
          <Field label={tr("料金（{0}）", currencyOf(regionOf(c)) === "USD" ? tr("ドル") : tr("円"))}>
            <input
              type="number"
              min="0"
              step={currencyOf(regionOf(c)) === "USD" ? "0.01" : "1"}
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
          <label className="check-field">
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
            <span>{tr("有効")}</span></label>
        </div>{!m.optionFor && <label className="check-field"><input type="checkbox" checked={m.transferable !== false} onChange={event => put("menus", c.menus.map((menu, index) => {
          if (index !== i) return menu;
          const { transferable: _transferable, ...rest } = menu;
          return event.target.checked ? rest : { ...rest, transferable: false };
        }))} /><span>{tr("キャンセル後に代わりの予約を受け付ける（指名・事前カウンセリング前提なら外す）")}</span></label>}<label className="check-field"><input type="checkbox" checked={m.optionFor !== undefined} onChange={event => put("menus", c.menus.map((menu,index) => {
          if (index !== i) return menu;
          if (event.target.checked) return { ...menu, optionFor: [] };
          const { optionFor: _for, optionForAll: _all, optionGroup: _group, ...standalone } = menu; return standalone;
        }))}/><span>{tr("ほかのメニューに追加して予約する（単独予約不可）")}</span></label>
        {m.optionFor && <fieldset className="menu-option-settings">
          <legend>{tr("追加できるメニュー")}</legend>
          <label className="check-field"><input type="checkbox" checked={!!m.optionForAll} onChange={event => put("menus", c.menus.map((menu,index) => {
            if (index !== i) return menu;
            const { optionForAll: _all, ...rest } = menu;
            return event.target.checked ? { ...menu, optionForAll: true } : rest;
          }))}/><span>{tr("単独で予約できるメニューなら、どれにでも追加できる")}</span></label>
          {!m.optionForAll && <div className="checkboxes">{c.menus.filter(base => base.id !== m.id && !base.optionFor).map(base => <label key={base.id}><input type="checkbox" checked={m.optionFor!.includes(base.id)} onChange={event => put("menus", c.menus.map((menu,index) => index === i ? {...menu,optionFor:event.target.checked?[...m.optionFor!,base.id]:m.optionFor!.filter(id=>id!==base.id)} : menu))}/>{base.name}</label>)}</div>}
          <Field label={tr("選択グループ（同じグループは1つまで・任意）")}><input value={m.optionGroup || ""} maxLength={80} onChange={event=>put("menus",c.menus.map((menu,index)=>index===i?{...menu,optionGroup:event.target.value||undefined}:menu))}/></Field><p className="small muted">{tr("例：当店オフと他店オフを同じグループにすると、予約時にどちらか1つを選べます。料金と所要時間は通常メニューに加算されます。")}</p>
        </fieldset>}
        {shopId && <MenuImageEditor shopId={shopId} imageId={m.imageId} name={m.name} uploading={onImageUploading} change={imageId => put("menus", c.menus.map((menu, index) => index === i ? { ...menu, imageId } : menu))} />}</div>
      ))}
      <button
        onClick={() => {
          if (section === "menus") setShowHiddenMenus(true);
          put("menus", [
            ...c.menus,
            {
              id: `menu-${Date.now()}`,
              name: tr("新しいコース"),
              duration: 60,
              price: 5000,
              active: section === "menus" ? false : true,
            },
          ]);
        }}
      >
        {tr("＋ メニューを追加")}</button>
      </>}
      {(!section || section === "profile") && <>
      <h3>{tr("ページの見た目")}</h3>
      <div className="form-grid">
        <Field label={tr("色")}><select value={c.appearance?.accent || "sage"} onChange={e => put("appearance", {...(c.appearance || {accent: "sage", layout: "standard", imageUrl: ""}), accent: e.target.value as "sage" | "rose" | "navy"})}><option value="sage">{tr("グリーン")}</option><option value="rose">{tr("ローズ")}</option><option value="navy">{tr("ネイビー")}</option></select></Field>
        <Field label={tr("配置")}><select value={c.appearance?.layout || "standard"} onChange={e => put("appearance", {...(c.appearance || {accent: "sage", layout: "standard", imageUrl: ""}), layout: e.target.value as "standard" | "compact"})}><option value="standard">{tr("ゆったり")}</option><option value="compact">{tr("コンパクト")}</option></select></Field>
        <Field label={tr("紹介画像の URL（HTTPS）")}><input type="url" value={c.appearance?.imageUrl || ""} onChange={e => put("appearance", {...(c.appearance || {accent: "sage", layout: "standard", imageUrl: ""}), imageUrl: e.target.value})}/></Field>
      </div>
      </>}
      {(!section || section === "staff") && <>
      <h3>{tr("スタッフと勤務")}</h3>
      <p>{tr("店主の情報と、追加スタッフの勤務を設定します。店主だけで営業する場合は、追加スタッフの登録は不要です。")}</p>
      {owner && <section className="owner-editor panel" aria-label={tr("店主の情報")}>
        <h3>{tr("店主の情報")}</h3>
        <Field label={tr("店主の名前")}><input value={owner.name} maxLength={100} onChange={event => putOwner({ name: event.target.value, imageId: owner.imageId })}/></Field>
        {shopId && <MenuImageEditor shopId={shopId} imageId={owner.imageId} name={owner.name} label={tr("店主の写真（任意）")} uploading={onImageUploading} change={imageId => putOwner({ name: owner.name, imageId })}/>}
        <StaffAvailability staff={owner} menus={c.menus} onChange={value => putOwner({ ...value, customAvailability: true })}/>
        <p className="small muted">{tr("営業日・営業時間の範囲内で、店主の勤務曜日・勤務時間・対応メニューを設定できます。カレンダーの追加設定は不要です。")}</p>
      </section>}
      {c.staff.map((p, i) => p.id === ownerStaffId ? null : (
        <div className="staff-editor" key={p.id}>
          {shopId && <MenuImageEditor shopId={shopId} imageId={p.imageId} name={p.name} label={tr("スタッフ写真（任意）")} uploading={onImageUploading} change={imageId => put("staff", c.staff.map((staff,j) => j===i ? {...staff,imageId} : staff))}/>}
          <Field label={tr("名前")}>
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
          <StaffAvailability staff={p} menus={c.menus} onChange={value => put("staff", c.staff.map((person,index) => index === i ? { ...person, ...value } : person))}/>
          <button
            onClick={() =>
              put(
                "staff",
                c.staff.filter((_, j) => i !== j),
              )
            }
          >
            {tr("このスタッフを削除")}</button>
        </div>
      ))}
      <button
        onClick={() =>
          put("staff", [
            ...c.staff,
            {
              id: `staff-${Date.now()}`,
              name: tr("新しいスタッフ"),
              start: c.hours.start,
              end: c.hours.end,
              weekdays: [1, 2, 3, 4, 5, 6],
              menuIds: c.menus.map((m) => m.id),
            },
          ])
        }
      >
        {tr("＋ スタッフを追加")}</button>
      </>}
      {(!section || section === "hours") && <>
      <h3>{tr("営業時間とお休み")}</h3>
      <div className="form-grid">
        {(["start", "end"] as const).map((k) => (
          <Field key={k} label={k === "start" ? tr("開店") : tr("閉店")}>
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
      <fieldset className="weekday-hours"><legend>{tr("曜日ごとの営業時間")}</legend><p className="small muted">{tr("通常と営業時間が異なる曜日だけ設定してください。定休日・臨時休業日の設定が優先されます。")}</p>
        {weekdays().map((day, index) => {
          const override = c.hours.weekdayHours?.find(hours => hours.day === index);
          const change = (value?: { day: number; start: string; end: string }) => {
            const items = (c.hours.weekdayHours || []).filter(hours => hours.day !== index);
            put("hours", { ...c.hours, weekdayHours: value ? [...items, value].sort((a, b) => a.day - b.day) : items });
          };
          return <div className="weekday-hours-row" key={day}><label><input type="checkbox" checked={!!override} onChange={event => change(event.target.checked ? { day: index, start: c.hours.start, end: c.hours.end } : undefined)}/>{tr("{0}曜の営業時間を変更", day)}</label>{override && <div className="form-grid"><Field label={tr("{0}曜の開店", day)}><input type="time" value={override.start} onChange={event => change({ ...override, start: event.target.value })}/></Field><Field label={tr("{0}曜の閉店", day)}><input type="time" value={override.end} onChange={event => change({ ...override, end: event.target.value })}/></Field></div>}</div>;
        })}
      </fieldset>
      <span className="small">{tr("定休日")}</span>
      <div className="checkboxes">
        {weekdays().map((d, i) => (
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
      <Field label={tr("臨時休業日（カンマ区切り・例：2026/12/31,2027/01/01）")}>
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
      <SpecialDays hours={c.hours} staff={bookingStaff(c)} onChange={specialDays => put("hours", { ...c.hours, specialDays })} />
      </>}
      {(!section || section === "rules") && <>
      <h3>{tr("予約のルール")}</h3>
      <p className="muted">{tr("お客様が予約時に、指名なしまたは希望するスタッフを選べます。")}</p>
      <div className="form-grid">
        {(
          [
            ["interval", tr("予約枠の間隔（分）")],
            ["advanceDays", tr("何日先まで予約できるか")],
            ["leadMinutes", tr("開始何分前まで予約できるか")],
            ...(!c.rules.payment?.enabled ? [["cancelHours", tr("開始何時間前までキャンセルできるか")] as const] : []),
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
      <label className="check-field">
        <input
          type="checkbox"
          checked={c.rules.sameDay}
          onChange={(e) =>
            put("rules", { ...c.rules, sameDay: e.target.checked })
          }
        />
        <span>{tr("当日の予約を受け付ける")}</span></label>
      <h3>{tr("予約時のお支払い・キャンセル時の返金")}</h3>
      <label className="check-field"><input type="checkbox" checked={!!c.rules.payment?.enabled} onChange={event => put("rules", { ...c.rules, payment: { enabled: event.target.checked, refundTiers: c.rules.payment?.refundTiers || structuredClone(defaultRefundTiers) } })} /><span>{tr("予約時にPayPalで全額お支払いいただく")}</span></label>
      {c.rules.payment?.enabled && <>
        <p className="small">{tr("開始までの残り時間で返金率を決めます。店都合は常に全額返金です。予約時の金額・条件を保存するため、変更はこれからの予約に適用されます。")}</p>
        {c.rules.payment.refundTiers.map((tier, i) => <div className="refund-tier" key={i}>
          <div className="form-grid refund-tier-fields">
          <Field label={tr("返金条件{0}・開始の何時間前まで", i + 1)}><input type="number" min="0" max="8760" value={tier.hoursBefore} onChange={e => put("rules", { ...c.rules, payment: { ...c.rules.payment!, refundTiers: c.rules.payment!.refundTiers.map((value, index) => index === i ? { ...value, hoursBefore: Number(e.target.value) } : value) } })} /></Field>
          <Field label={tr("返金条件{0}・返金率（%）", i + 1)}><input type="number" min="0" max="100" value={tier.percent} onChange={e => put("rules", { ...c.rules, payment: { ...c.rules.payment!, refundTiers: c.rules.payment!.refundTiers.map((value, index) => index === i ? { ...value, percent: Number(e.target.value) } : value) } })} /></Field>
          </div>
          {i < c.rules.payment!.refundTiers.length - 1 && <button className="refund-tier-remove" onClick={() => put("rules", { ...c.rules, payment: { ...c.rules.payment!, refundTiers: c.rules.payment!.refundTiers.filter((_, index) => index !== i) } })}>{tr("返金条件{0}を削除", i + 1)}</button>}
        </div>)}
        {c.rules.payment.refundTiers.length < 10 && <button onClick={() => put("rules", { ...c.rules, payment: { ...c.rules.payment!, refundTiers: [{ hoursBefore: c.rules.payment!.refundTiers[0].hoursBefore + 24, percent: 100 }, ...c.rules.payment!.refundTiers] } })}>{tr("返金条件を追加")}</button>}
        <p className="small">{tr("時間の大きい順に設定し、最後は0時間（それ以降の返金率）にします。最小単位（1円・1セント）未満は切り捨てます。自然な言葉での変更は「AIとお店をつくる」から依頼し、変更案を確認して反映できます。")}</p>
      </>}
      <p className="small muted">
        {section ? tr("この項目は保存すると反映されます。") : tr("設定はプラン確認・承認・公開のあとに反映されます。")}
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
  open,
}: {
  shop: Workspace;
  run: Run;
  reload: () => Promise<unknown>;
  open: (screen: string, recordId?: string) => void;
}) {
  const api = useApi();
  const { money: yen, when, shopToday, displayTimeZone, timeZoneLabel } = useShopDisplay();
  const [date, setDate] = useState(() => shopToday());
  const [staff, setStaff] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const selectedBooking = shop.bookings.find(booking => booking.id === selectedId);
  const visibleBookings = shop.bookings.filter(b => (!date || dateIn(b.start, displayTimeZone()) === date) && (!staff || b.staffId === staff));
  const bookingPages = usePagination(visibleBookings, JSON.stringify([shop.id, date, staff]));
  const checkoutPages = usePagination(shop.paymentCheckouts || [], shop.id);
  return (
    <div className="panel reservations-panel">
      <div className="section-top">
        <h2>
          {tr("予約一覧")}{" "}
          <span className="count">
            {visibleBookings.length}
          </span>
        </h2>
        <button
          onClick={() =>
            run(async () => {
              await reload();
            })
          }
        >
          {tr("更新")}</button>
      </div>
      {shop.published && <PhoneBooking key={shop.id} shopId={shop.id} config={shop.published} reload={reload} />}
      <div className="filters reservation-filters">
        <Field label={tr("日付（{0}）", timeZoneLabel)}>
          <DateInput aria-label={tr("日付（{0}）", timeZoneLabel)}
            value={date}
            onValueChange={value => setDate(value)} />
        </Field>
        <Field label={tr("スタッフ")}>
          <select value={staff} onChange={(e) => setStaff(e.target.value)}>
            <option value="">{tr("すべて")}</option>
            {(shop.published ? bookingStaff(shop.published) : []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="reservation-filter-actions">
        <button onClick={() => setDate(shopToday())}>{tr("今日")}</button>
        <button
          onClick={() => {
            setDate("");
            setStaff("");
          }}
        >
          {tr("絞り込みを解除")}</button>
        </div>
      </div>
      <div {...checkoutPages.listProps}>{checkoutPages.items.map(checkout => <div className="booking-card" key={checkout.id}>
        <div><h3>{tr("{0} 様・{1}", checkout.name, when(checkout.start))}</h3><p>{checkout.customer} ／ {yen(checkout.amount, checkout.currency || "JPY")}</p><p>{checkout.review ? tr("PayPalの決済結果を照合してください。予約枠を確保したまま、自動の課金再送は停止しています。") : tr("お支払い手続き中・予約未確定")}</p></div>
        <button onClick={() => run(async () => { await api(`/api/shops/${shop.id}/retry`, {}); await reload(); })}>{tr("決済状況を再確認")}</button>
      </div>)}</div>
      <Pagination pagination={checkoutPages} label={tr("お支払い手続き中")} />
      {!shop.bookings.length && !shop.paymentCheckouts?.length && (
        <Empty text={tr("最初の予約を、楽しみに待ちましょう。")} />
      )}
      {!!shop.bookings.length && !visibleBookings.length && <Empty text={tr("指定した条件の予約はありません。日付・スタッフを変更するか、絞り込みを解除してください。")} />}
      <div {...bookingPages.listProps} className="booking-list">
        {bookingPages.items.map((b) => (
            <div className="booking-card reservation-booking" key={b.id} onClick={event => {
              if (event.target instanceof Element && !event.target.closest("button, a, summary, details, input, textarea, select, form")) {
                event.currentTarget.querySelector<HTMLButtonElement>(".reservation-booking-open")?.focus({ preventScroll: true });
                setSelectedId(b.id);
              }
            }}>
              <div className="reservation-booking-body">
                <div className="reservation-booking-header">
                  <div className="reservation-booking-identity">
                    <h3><button type="button" className="reservation-booking-open" aria-haspopup="dialog" aria-label={tr("{0}の予約を開く", b.name)} onClick={() => setSelectedId(b.id)}>{b.name} {tr(" 様 ")}</button></h3>
                    <time dateTime={b.start}>{when(b.start)}</time>
                  </div>
                  <div className="reservation-booking-statuses">
                <span className={`status ${b.status}`}>
                  {shop.transferListings?.some(listing => listing.bookingId === b.id) ? tr("キャンセル受付済み") : b.status === "active"
                    ? tr("予約確定")
                    : b.status === "no_show"
                      ? tr("無断キャンセル")
                      : tr("キャンセル済み")}
                </span>
                {!!b.transfers?.length && <span className="status transfer">{tr("キャンセル枠からの予約")}</span>}
                  </div>
                </div>
                <dl className="reservation-booking-summary">
                  <div><dt>{tr("メニュー")}</dt><dd>{bookingMenuName(shop.published, b)}</dd></div>
                  <div><dt>{tr("スタッフ")}</dt><dd>{bookingStaffName(shop.published, b.staffId)}</dd></div>
                </dl>
                {!b.phone && <span className="small muted reservation-booking-email">{b.customer}</span>}
                {b.phone && <p><span className="status transfer">{tr("電話予約")}</span> <a href={`tel:${b.phone}`}>{b.phone}</a> · {tr("店頭で現金払い：{0}", yen(b.price))}</p>}
                {(() => {
                  const listing = shop.transferListings?.find(listing => listing.bookingId === b.id);
                  return listing && <p className="transfer-status" role="status"><span className="status transfer">{tr("お得な空き枠")}</span> {tr("{0}（{1}%引き）・{2}まで", paid(listing.price, listing.currency), listing.discountPercent, when(listing.deadline))}{listing.review ? tr("・PayPalの決済結果を照合してください") : listing.buying ? tr("・代わりの方が支払い手続き中") : ""}</p>;
                })()}
                {(() => {
                  const listing = shop.transferListings?.find(listing => listing.bookingId === b.id);
                  const today = dateIn(new Date(), displayTimeZone());
                  return listing && !listing.buying && !listing.review && dateIn(b.start, displayTimeZone()) === today && Date.parse(b.start) > Date.now() && <PhoneReplacement shopId={shop.id} listing={listing} reload={reload} />;
                })()}
                <PaymentDetails booking={b} operator />
                {b.coupon && <p>{b.coupon.title} · {tr("クーポン割引：{0}", yen(b.coupon.discountAmount,b.coupon.currency))}</p>}
                {b.message && <p className="pre-wrap reservation-booking-message"><b>{tr("予約時のメッセージ")}</b><br />{b.message}</p>}
              </div>
              {b.status === "active" && (
                <div className="actions">
                  {(["cancelled", "no_show"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() =>
                        run(async () => {
                          if (status === "cancelled" && !window.confirm(b.payment ? tr("店都合でキャンセルし、{0}を全額返金しますか？", paid(b.payment.amount, b.payment.currency)) : tr("この予約をキャンセルしますか？"))) return;
                          await api(
                            `/api/shops/${shop.id}/bookings/${b.id}/status`,
                            { status },
                          );
                          await reload();
                        })
                      }
                    >
                      {status === "cancelled"
                        ? b.payment ? tr("店都合でキャンセル・全額返金") : tr("予約をキャンセル")
                        : tr("無断キャンセルを記録")}
                    </button>
                  ))}
                </div>
              )}
              {(b.payment?.cancellation && ["pending", "retrying", "awaiting_funds"].includes(b.payment.cancellation.status) || b.transfers?.some(entry => ["pending", "retrying", "awaiting_funds"].includes(entry.refund.status))) && <button onClick={() => run(async () => { await api(`/api/shops/${shop.id}/retry`, {}); await reload(); })}>{tr("返金状況を再確認")}</button>}
            </div>
          ))}
      </div>
      <Pagination pagination={bookingPages} label={tr("予約一覧")} />
      {selectedBooking && <RecordDetailsDialog shop={shop} item={{ kind: "booking", value: selectedBooking }} close={() => setSelectedId("")} open={open} />}
    </div>
  );
}
function Settings({
  shop,
  run,
  reload,
  hasLegacyNotes = false,
}: {
  shop: Workspace;
  run: Run;
  reload: () => Promise<unknown>;
  hasLegacyNotes?: boolean;
}) {
  const api = useApi();
  const [domain, setDomain] = useState(shop.domain || "");
  const [exportTable, setExportTable] = useState("bookings");
  useEffect(() => { setDomain(shop.domain || ""); }, [shop.domain]);
  useEffect(() => {
    if (!shop.isOwner || !shop.domainVerified || shop.domainConnection?.status === "connected") return;
    let checking = false;
    const timer = window.setInterval(() => {
      if (checking) return;
      checking = true;
      void api<{ connection: Workspace["domainConnection"] | null }>(`/api/shops/${shop.id}/domain/status`).then(result => {
        if (result.connection?.status !== shop.domainConnection?.status ||
            result.connection?.authorization?.data !== shop.domainConnection?.authorization?.data ||
            result.connection?.dns?.authorization !== shop.domainConnection?.dns?.authorization ||
            result.connection?.dns?.address !== shop.domainConnection?.dns?.address) return reload();
      }).catch(() => {}).finally(() => { checking = false; });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [api, shop.id, shop.isOwner, shop.domainVerified, shop.domainConnection, reload]);
  const connection = shop.domainConnection;
  const needsCname = !!connection?.authorization && ["dns_required", "retrying"].includes(connection.status) && connection.dns?.authorization !== true;
  return (
    <div className="panel">
      {hasLegacyNotes && <section className="legacy-notes-settings"><h2>{tr("旧環境からの引き継ぎ")}</h2><p>{tr("ノートとAIチャットはkiokuflowへ移動しました")}</p><a className="button" href="/settings/migration">{tr("引き継ぎの案内を開く")}</a></section>}
      <h2>{tr("お店のアドレス")}</h2>
      {shop.published ? (
        <>
          <p className="muted">{tr("お客様に公開している本番のお店を別タブで開きます。")}</p>
          <a className="button" href={shop.publicUrl} target="_blank" rel="noreferrer">
            {tr("公開中のお店を開く ↗")}</a>
          <p className="small muted">{shop.publicUrl}</p>
        </>
      ) : (
        <p>{tr("お店のページを公開すると、アドレスができあがります。")}</p>
      )}
      {shop.isOwner && shop.published && <section className="publication-review-entry">
        <h3>{tr("画面の確認・本番公開")}</h3>
        <p>{tr("公開中の画面の確認や、デザイン全体の版履歴からの復元はこちらで行います。")}</p>
        <a className="button" data-publication-preview-link href={`/publication-preview/${shop.id}`}>{tr("画面の確認・本番公開")}</a>
      </section>}
      {shop.isOwner && <section className="shop-export" aria-label={tr("お店のデータを書き出す")}>
        <h3>{tr("お店のデータを書き出す")}</h3>
        <p>{tr("設定や記録をまとめて保存できます。CSVはスプレッドシートでも開けます。写真・添付ファイルの本体はGoogle Driveに保存されています。")}</p>
        <a className="button" download href={`/api/shops/${shop.id}/export?format=json`}>{tr("まとめて保存（JSON）")}</a>
        <label>{tr("CSVで保存するデータ")}<select aria-label={tr("CSVで保存するデータ")} value={exportTable} onChange={event => setExportTable(event.target.value)}>
          {[["bookings", tr("予約")], ["customers", tr("お客様")], ["inquiries", tr("お問い合わせ")], ["inquiryInteractions", tr("お問い合わせのやりとり")], ["customerNotes", tr("お客様メモ")], ["members", tr("家族・スタッフ")], ["posts", tr("ブログ・お知らせ")], ["menus", tr("メニュー・料金")], ["staff", tr("スタッフ・勤務")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <a className="button" download href={`/api/shops/${shop.id}/export?format=csv&table=${exportTable}`}>{tr("選んだデータを保存（CSV）")}</a>
      </section>}
      {shop.isOwner && <PhoneReception shop={shop} reload={reload} />}
      <h3>{tr("お店独自のドメイン")}</h3>
      <p className="muted">
        {tr("お持ちのドメインを使う場合に設定してください。DNS と HTTPS の接続設定が必要です。")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api(`/api/shops/${shop.id}/domain`, { domain });
            await reload();
          });
        }}
      >
        <Field label={tr("ドメイン名")}>
          <input
            value={domain}
            placeholder="reserve.example.com"
            onChange={(e) => setDomain(e.target.value)}
            disabled={!shop.isOwner}
          />
        </Field>
        <button disabled={!shop.isOwner}>{tr("ドメインを設定")}</button>
      </form>
      {shop.domainToken && (
        <div className="config-summary custom-domain-settings">
          {shop.domainVerified && <div className="custom-domain-status" data-state={connection?.status || "preparing"} role="status">
            <span className="custom-domain-status-indicator" aria-hidden="true" />
            <div className="custom-domain-status-content"><strong>{
            needsCname ? tr("CNAME レコードの追加が必要です") :
            connection?.status === "connected" ? tr("独自ドメインで接続済み") :
            connection?.status === "dns_required" ? tr("接続先の A レコードを確認してください") :
            connection?.status === "certificate_pending" ? tr("HTTPS 証明書を発行しています") :
            connection?.status === "connecting" ? tr("HTTPS でお店への接続を確認しています") :
            connection?.status === "retrying" ? tr("接続を再確認しています。DNS レコードを確認してください。") :
            tr("証明書の確認用 DNS レコードを準備しています")
          }</strong>
            {needsCname && <p>{tr("所有権の確認は完了しました。証明書を発行するため、下の CNAME レコードを DNS 管理画面に追加してください。追加済みの場合は反映をお待ちください。")}</p>}
            {!connection?.authorization && <p>{tr("準備ができると、追加する CNAME レコードがここに表示されます。")}</p>}
            </div></div>}
          <p>{tr("DNS 管理画面で次のレコードを追加してください。")}</p>
          <code>TXT _gemihub.{shop.domain}</code>
          <pre>{shop.domainToken}</pre>
          {shop.domainAddress && <><code>A {shop.domain}</code><pre>{shop.domainAddress}</pre></>}
          {connection?.authorization && <section className="custom-domain-cname" data-required={needsCname || undefined}>
            <h4>{needsCname ? tr("次に追加する CNAME レコード") : tr("証明書用の CNAME レコード")}</h4>
            <code>CNAME {connection.authorization.name}</code>
            <pre>{connection.authorization.data}</pre>
          </section>}
          <p className="small">{tr("表示された DNS レコードを追加してください。証明書の発行とお店への接続は自動で行います。")}</p>
          <p className="small">{tr("同じホスト名の古い A・AAAA レコードがある場合は置き換えてください。DNS のプロキシ機能は無効にし、確認用 TXT と CNAME は接続後も残してください。")}</p>
          {connection?.status !== "connected" && <p className="small">{tr("接続が完了するまでは、現在のお店のアドレスを引き続き使えます。反映には時間がかかる場合があります。")}</p>}
          <div className="custom-domain-footer">
            <p className="pill">
              {shop.domainVerified ? tr("所有権を確認済み") : tr("所有権の確認待ち")}
            </p>
            <div className="custom-domain-actions">
          <button
            disabled={!shop.isOwner}
            onClick={() =>
              run(async () => {
                if (!shop.domainVerified) await api(`/api/shops/${shop.id}/domain/verify`, {});
                await reload();
              })
            }
          >
            {shop.domainVerified ? tr("接続状況を更新") : tr("DNS の所有権を確認する")}</button>
          {shop.isOwner && <button type="button" onClick={() => run(async () => {
            await api(`/api/shops/${shop.id}/domain/remove`, {});
            await reload();
          })}>{tr("独自ドメインを解除")}</button>}
            </div>
          </div>
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
    googleAuthUrl?: string;
    publication?: "provisional" | "public";
    recentPosts?: PostSummary[];
    customerProfile?: MemberProfile | null;
    registrationRequired?: boolean;
    paymentSimulation?: boolean;
    isOperator?: boolean;
    demoCustomer?: { email: string; name: string };
  }>();
  const { money: yen, when, shopTime, displayTimeZone, timeZoneLabel } = useShopDisplay(regionOf(data?.config));
  const [menu, setMenu] = useState("");
  const [emailLoginOpen, setEmailLoginOpen] = useState(false);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [staff, setStaff] = useState("");
  const [date, setDate] = useState("");
  const [times, setTimes] = useState<
    { start: string; end: string; staffId: string }[]
  >([]);
  const [timesLoading, setTimesLoading] = useState(false);
  const [automaticDate, setAutomaticDate] = useState(true);
  const requestedDate = automaticDate ? "" : date;
  const [timesError, setTimesError] = useState("");
  const [timesRetry, setTimesRetry] = useState(0);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState(session.user?.name || "");
  useEffect(() => { setName(session.user?.name || ""); }, [session.user?.email, session.user?.name]);
  const [mine, setMine] = useState<Booking[]>([]);
  type PendingCheckout = { id: string; phase: string; expires: number; approvalUrl?: string; review?: boolean; start: string; amount: number; currency?: Currency };
  const [checkouts, setCheckouts] = useState<PendingCheckout[]>([]);
  const [listings, setListings] = useState<TransferListing[]>([]);
  const [myTransfers, setMyTransfers] = useState<MyTransfers>({ selling: [], buying: [] });
  const [wishes, setWishes] = useState<SlotWish[]>([]);
  const [coupons, setCoupons] = useState<CouponWalletItem[]>([]);
  const [couponId, setCouponId] = useState(() => new URLSearchParams(search).get("coupon") || "");
  const couponBookingHeading = useRef<HTMLHeadingElement>(null), focusCouponBooking = useRef(!!new URLSearchParams(search).get("coupon"));
  const [paymentConsent, setPaymentConsent] = useState(false);
  const processedReturn = useRef("");
  useEffect(() => { setPaymentConsent(false); }, [menu, optionIds, data?.config.rules.payment, selected, couponId, coupons]);

  const [message, setMessage] = useState("");
  const inquiryFiles = useInquiryFiles();
  const inquiryPending = useRef<{ serialized: string; requestId: string } | undefined>(undefined);
  const inquirySending = useRef(false);
  const [bookingMessage, setBookingMessage] = useState("");
  const [pane, setPane] = useState(initialPane || (session.user ? "mine" : "about"));
  const [completedBooking, setCompletedBooking] = useState<Booking>();
  const [requestId, setRequestId] = useState(() => createRequestId());
  // In demo mode the server lets every visitor book as a shared demo customer, with no sign-in.
  const shopper = session.user?.role === "customer" && session.user.shopId === data?.shopId ? session.user : data?.demoCustomer;
  const isCustomer = !!shopper;
  const confirmed = completedBooking && isCustomer && completedBooking.customer === shopper?.email && completedBooking.shopId === data?.shopId ? completedBooking : undefined;
  const lastActivity = useRef("");
  const lastPageView = useRef("");
  useEffect(() => {
    if (!data || data.paymentSimulation || confirmed || location.protocol === "file:") return;
    const page = category ? articleKey ? "article" : category : pageSlug ? "custom" : pane === "about" ? "home" : pane;
    if (!["home", "reserve", "mine", "contact", "blogs", "announcements", "article", "custom"].includes(page)) return;
    const payload = { page, ...(page === "article" ? { category, key: articleKey } : {}), ...(page === "custom" ? { slug: pageSlug } : {}) };
    const key = `${base}:${session.user?.email || ""}:${JSON.stringify(payload)}`;
    const report = () => {
      if (document.visibilityState !== "visible" || lastPageView.current === key) return;
      lastPageView.current = key;
      const visitorId = browserVisitorId(slug);
      void api(`${base}/page-views`, { ...payload, ...(visitorId ? { visitorId } : {}) }, { keepalive: true }).catch(() => {});
    };
    report(); document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [api, base, slug, data?.shopId, data?.paymentSimulation, pane, category, articleKey, pageSlug, confirmed, session.user?.email]);
  function reportBookingStep(event: BookingStep, staffId?: string) {
    if (!data || data.isOperator || data.paymentSimulation || location.protocol === "file:") return;
    const visitorId = browserVisitorId(slug);
    void api(`${base}/booking-events`, { event, ...(visitorId ? { visitorId } : {}), ...(staffId ? { staffId } : {}) }, { keepalive: true }).catch(() => {});
  }
  useEffect(() => {
    if (!isCustomer || !data || data.isOperator || data.paymentSimulation || category || pageSlug || confirmed || location.protocol === "file:") { lastActivity.current = ""; return; }
    const event = pane === "reserve" ? "reserve_view" : pane === "mine" ? "mypage_view" : "";
    const key = `${base}:${shopper?.email}:${event}`;
    if (!event) { lastActivity.current = ""; return; }
    if (lastActivity.current === key) return;
    lastActivity.current = key;
    void api(`${base}/activity`, { event }).catch(() => {});
  }, [api, base, isCustomer, data?.shopId, data?.paymentSimulation, data?.isOperator, pane, category, pageSlug, confirmed, shopper?.email]);
  const leavePaymentReturn = (nextPane: string, coupon?: string) => {
    const query = new URLSearchParams(search);
    if (onPaneChange) return false;
    if (!query.has("transfer") && !query.has("checkout")) return false;
    for (const key of ["checkout","transfer","paypal","token","PayerID","coupon"]) query.delete(key);
    if (coupon) query.set("coupon",coupon);
    query.set("pane",nextPane); navigate(`${basePath || "/"}?${query}`);
    return true;
  };
  useEffect(() => {
    if (pane === "reserve" && !confirmed && focusCouponBooking.current && couponBookingHeading.current) {
      focusCouponBooking.current = false;
      couponBookingHeading.current.focus();
      couponBookingHeading.current.scrollIntoView({block:"start"});
    }
  }, [pane, confirmed, data?.shopId]);
  const loadMine = async () => {
    if (isCustomer) {
      const [bookings, pending, transfers, waitlist, wallet] = await Promise.all([api<Booking[]>(`${base}/bookings`), api<PendingCheckout[]>(`${base}/checkouts`), api<MyTransfers>(`${base}/transfers/mine`), api<SlotWish[]>(`${base}/waitlist`), api<CouponWalletItem[]>(`${base}/coupons`)]);
      setMine(bookings); setCheckouts(pending); setMyTransfers(transfers); setWishes(waitlist);
      setCoupons(wallet);
      setCouponId(current => wallet.some(coupon => coupon.id === current && coupon.state === "available") ? current : "");
      setCompletedBooking(current => {
        const saved = current && bookings.find(booking => booking.id === current.id);
        return saved ? saved.status === "active" && !transfers.selling.some(listing => listing.bookingId === saved.id && listing.phase === "listed") ? saved : undefined : current;
      });
    }
  };
  const finishBooking = (booking: Booking | undefined) => {
    if (!booking || booking.status !== "active" || booking.customer !== shopper?.email || booking.shopId !== data?.shopId) return false;
    setCompletedBooking(booking);
    setMine(current => current.some(previous => previous.id === booking.id) ? current.map(previous => previous.id === booking.id ? booking : previous) : [...current,booking]);
    setCheckouts(current => current.filter(checkout => checkout.id !== booking.id));
    setPane("reserve");
    return true;
  };
  useEffect(() => { setCompletedBooking(undefined); }, [base, shopper?.email]);
  const confirmCheckout = async (id: string, abandon = false) => {
    const result = await api<{ ok: boolean; booking?: Booking; checkout: PendingCheckout }>(`${base}/checkouts/${id}/${abandon ? "abandon" : "capture"}`, {});
    if (result.ok && finishBooking(result.booking)) return;
    notify(result.ok ? tr("予約内容はマイページで確認してください。") : result.checkout.phase === "expired" ? tr("お支払い手続きは終了しました。空き枠から選び直してください。") : result.checkout.phase === "failed" ? tr("お支払いが完了しませんでした。空き枠から選び直してください。") : tr("支払いを確認中です。マイページで状況を再確認できます。"));
    await loadMine();
  };
  const confirmTransfer = async (id: string, abandon = false) => {
    const result = await api<{ ok: boolean; booking?: Booking; checkout: TransferCheckout }>(`${base}/transfers/${id}/${abandon ? "abandon" : "capture"}`, {});
    if (result.ok && finishBooking(result.booking)) return;
    notify(result.ok ? tr("予約内容はマイページで確認してください。") : result.checkout.phase === "expired" ? tr("お支払い手続きは終了しました。空き枠の一覧から選び直してください。") : result.checkout.phase === "failed" ? tr("お支払いが完了しませんでした。空き枠の一覧から選び直してください。") : tr("支払いを確認中です。マイページで状況を再確認できます。"));
    await loadMine();
  };
  const startTransfer = async (checkout: TransferCheckout) => {
    if (checkout.phase === "awaiting_approval" && checkout.approvalUrl) { window.location.assign(checkout.approvalUrl); return; }
    if (checkout.phase === "captured" || checkout.phase === "capturing") { await confirmTransfer(checkout.id); return; }
    setPane("mine"); await loadMine(); notify(tr("マイページでお支払いの状況を確認してください。"));
  };
  useEffect(() => {
    if (!isCustomer || !data) return;
    const params = new URLSearchParams(search || "");
    const id = params.get("transfer");
    const action = params.get("paypal");
    if (!id || !["return", "cancel"].includes(action || "") || processedReturn.current === `transfer:${id}:${action}`) return;
    processedReturn.current = `transfer:${id}:${action}`;
    setPane("mine");
    run(async () => { await confirmTransfer(id, action === "cancel"); });
  }, [isCustomer, data?.shopId, search]);
  useEffect(() => {
    if (!data || pane !== "reserve" || category || pageSlug || confirmed) return;
    let cancelled = false;
    api<TransferListing[]>(`${base}/transfers`).then(result => { if (!cancelled) setListings(result); }).catch(() => { if (!cancelled) setListings([]); });
    return () => { cancelled = true; };
  }, [base, data?.shopId, pane, category, pageSlug, confirmed, session.user?.email]);
  useEffect(() => {
    if (!isCustomer || !data) return;
    const params = new URLSearchParams(search || "");
    const id = params.get("checkout");
    const action = params.get("paypal");
    if (!id || !["return", "cancel"].includes(action || "") || processedReturn.current === `${id}:${action}`) return;
    processedReturn.current = `${id}:${action}`;
    setPane("mine");
    run(async () => { await confirmCheckout(id, action === "cancel"); });
  }, [isCustomer, data?.shopId, search]);
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
      setDate(""); setAutomaticDate(true);
      if (d.customerProfile) setName(d.customerProfile.name);
      setMenu(d.config.menus.find((m) => m.active && !m.optionFor)?.id || "");
      setOptionIds([]);
      setStaff("");
    });
  }, [base]);
  useEffect(() => {
    if (!data || !isCustomer || data.registrationRequired || category || pageSlug || pane !== "reserve" || confirmed) return;
    const selection = menuSelection(data.config, menu, optionIds);
    if (optionIds.length && !selection) { setOptionIds([]); return; }
    if (
      staff &&
      !bookingStaff(data.config).some((p) => p.id === staff && p.menuIds.includes(menu) && (selection?.options || []).every(option => p.menuIds.includes(option.id)))
    ) {
      setStaff("");
      return;
    }
    setSelected("");
    setRequestId(createRequestId());
    setTimes([]);
    setTimesError("");
    if ((!automaticDate && !requestedDate) || !selection) { setTimesLoading(false); return; }
    setTimesLoading(true);
    if (automaticDate) setDate("");
    let cancelled = false;
    const query = new URLSearchParams({
      date: requestedDate,
      menu,
      staff,

    });
    for (const id of optionIds) query.append("option", id);
    const request = automaticDate
      ? api<{date:string;slots:typeof times}>(`${base}/slots/next?${query}`)
      : api<typeof times>(`${base}/slots?${query}`).then(slots => ({date:requestedDate,slots}));
    request
      .then((t) => {
        if (!cancelled) { setTimes(t.slots); if (automaticDate) setDate(t.date); }
      })
      .catch((error) => {
        if (!cancelled) setTimesError(error instanceof Error ? error.message : tr("空き時間を取得できませんでした。再試行してください。"));
      })
      .finally(() => { if (!cancelled) setTimesLoading(false); });
    return () => {
      cancelled = true;
    };
  }, [requestedDate, automaticDate, menu, optionIds, staff, data, category, pageSlug, pane, confirmed, isCustomer, shopper?.email, timesRetry]);
  useEffect(() => {
    run(loadMine);
  }, [isCustomer]);
  if (!data)
    return <div className="loading">{tr("お店のページを準備しています…")}</div>;
  const c = data.config;
  const selection = menuSelection(c, menu, optionIds);
  const selectableCoupons = coupons.filter(coupon => coupon.state === "available" && coupon.currency === currencyOf(regionOf(c)) && couponDiscount(selection?.price || 0, coupon.discount, coupon.currency) > 0);
  const selectedCoupon = selectableCoupons.find(coupon => coupon.id === couponId);
  const discountAmount = selectedCoupon ? couponDiscount(selection?.price || 0, selectedCoupon.discount, selectedCoupon.currency) : 0;
  const totalPrice = Math.round(((selection?.price || 0) - discountAmount) * 100) / 100;
  const allowedOptions = c.menus.filter(option => option.active && menuAllowsOption(option, menu));
  // Built-in screens may be laid out in the owner's checked HTML; the working parts below are inserted
  // through slots, so booking, sign-in, payment and inquiries keep their behavior either way.
  const screen = (id: ScreenId, slots: Record<string, React.ReactNode>, fallback: React.ReactNode) => {
    const design = c.screens?.[id];
    return design ? <Presentation design={design} slots={slots} fallback={fallback} imageBase={`${base}/images`} /> : fallback;
  };
  const mineNews = () => (
            <RecentPosts
              config={c}
              posts={(data.recentPosts || []).filter(post=>articleKinds(c).includes(post.category))}
              archive={articleKinds(c)[0]}
              basePath={basePath}
              navigate={navigate}
            />
  );
  const loginRequired = () => <section className="panel booking-login-required" aria-label={tr("ご予約にはログインが必要です。") }>
    <h2>{tr("ご予約にはログインが必要です。")}</h2>
    <p>{tr("会員登録またはログイン後に、メニューと日時を選んでご予約ください。")}</p>
    {!hideHeader && <a className="button primary booking-login-button" href="#customer-signin">{tr("会員登録・ログインへ")}</a>}
  </section>;
  const mineMember = () => isCustomer ? <div className="member-information"><span>{data.customerProfile?.name || shopper!.name} {tr(" さん")}</span><button type="button" onClick={() => setData(current => current && { ...current, registrationRequired: true })}>{tr("会員情報を変更")}</button></div> : null;
  const minePanel = () => (
            <div className="panel">
              <h2>{storefrontText(c, "mineBookings")}</h2>
              {checkouts.map(checkout => <div className="booking-card" key={checkout.id}>
                <div><h3>{when(checkout.start)}</h3><p>{yen(checkout.amount, checkout.currency || "JPY")}・{checkout.review ? tr("お店での支払い確認が必要です。お問い合わせください。") : tr("支払い手続き中・予約はまだ確定していません")}</p></div>
                <div className="actions">
                  {checkout.phase === "awaiting_approval" && checkout.approvalUrl && checkout.expires > Date.now() && <button disabled={busy} onClick={() => window.location.assign(checkout.approvalUrl!)}>{tr("PayPalで支払いを続ける")}</button>}
                  {checkout.phase === "creating" && <button disabled={busy} onClick={() => run(async () => { await api(`${base}/checkouts/${checkout.id}/resume`, {}); await loadMine(); })}>{tr("支払い手続きを再開")}</button>}
                  {checkout.phase !== "creating" && <button disabled={busy} onClick={() => run(async () => confirmCheckout(checkout.id))}>{tr("支払い状況を確認・予約を確定")}</button>}
                  {["creating", "awaiting_approval"].includes(checkout.phase) && <button disabled={busy} onClick={() => run(async () => confirmCheckout(checkout.id, true))}>{tr("支払いを中止")}</button>}
                </div>
              </div>)}
              <TransferBuying base={base} buying={myTransfers.buying} busy={busy} run={run} confirm={confirmTransfer} reload={loadMine} />
              {!mine.length ? (
                <Empty text={tr("ご予約はまだありません。")} />
              ) : (
                mine.map((b) => (
                  <div className="booking-card" key={b.id}>
                    <div>
                      <span className={`status ${b.status}`}>
                        {myTransfers.selling.some(listing => listing.bookingId === b.id && listing.phase === "listed") ? tr("キャンセル受付済み") : b.status === "active"
                          ? tr("予約確定")
                          : b.status === "no_show"
                            ? tr("無断キャンセル")
                            : tr("キャンセル済み")}
                      </span>
                      <h3>{when(b.start)}</h3>
                      <p>
                        {bookingMenuName(c, b)}
                      </p>
                      {b.transferredIn && <p className="small muted">{tr("お得な空き枠からご予約いただきました。")}</p>}
                      {b.message && <p className="pre-wrap"><b>{tr("予約時のメッセージ")}</b><br />{b.message}</p>}
                      <PaymentDetails booking={b} />
                      {b.coupon && <p>{b.coupon.title} · {tr("クーポン割引：{0}", yen(b.coupon.discountAmount,b.coupon.currency))}</p>}
                      <BookingTransferControl base={base} listing={myTransfers.selling.find(listing => listing.bookingId === b.id && listing.phase === "listed")} busy={busy} run={run} reload={loadMine} notify={notify} />
                    </div>
                    {((b.status === "active" && !myTransfers.selling.some(listing => listing.bookingId === b.id && listing.phase === "listed")) || b.payment?.cancellation && ["retrying", "pending", "awaiting_funds"].includes(b.payment.cancellation.status)) && (
                      <button disabled={busy}
                        onClick={() =>
                          run(async () => {
                            let expectedRefund: number | undefined;
                            let expectedTransfer: CancellationQuote["transfer"];
                            if (b.payment && !b.payment.cancellation) {
                              const quote = await api<CancellationQuote>(`${base}/bookings/${b.id}/cancel-quote`);
                              const message = quote.transfer ? tr("予約をキャンセルしますか？\n返金予定額：{0}\n代わりに利用する方が見つかると、返金額が{1}に増えます。\n受付期限：{2}\n予約が入るか受付期限を過ぎると、返金額が確定します。ほかの方の支払い開始前なら、キャンセルを取り消せます。", paid(quote.amount, b.payment.currency), paid(quote.transfer.price, b.payment.currency), when(quote.transfer.deadline)) : tr("予約をキャンセルしますか？返金額は{0}（{1}%）です。", paid(quote.amount, b.payment.currency), quote.percent);
                              const couponNote = Date.parse(b.start) <= Date.now() ? tr("開始時刻を過ぎたキャンセルでは、クーポンは戻りません。") : quote.transfer ? tr("有効期限内のクーポンは、キャンセルが確定すると再利用できます。受付中は返却されません。") : tr("有効期限内のクーポンは再利用できます。");
                              if (!window.confirm(message + (b.coupon ? "\n" + couponNote : ""))) return;
                              expectedRefund = quote.amount;
                              expectedTransfer = quote.transfer;
                            }
                            const result = await api<{ cancellationPending?: boolean }>(`${base}/bookings/${b.id}/cancel`, { expectedRefund, expectedTransfer });
                            await loadMine();
                            notify(result.cancellationPending ? tr("キャンセルを受け付けました") : b.coupon && !b.payment ? `${tr("予約をキャンセルしました。")} ${tr("有効期限内のクーポンは再利用できます。")}` : tr("予約をキャンセルしました。"));
                          })
                        }
                      >
                        {b.payment?.cancellation ? tr("返金状況を再確認") : tr("キャンセルする")}
                      </button>
                    )}
                  </div>
                ))
              )}
              <TransferHistory selling={myTransfers.selling} />
              <WaitlistWishes base={base} config={c} wishes={wishes} busy={busy} run={run} reload={loadMine} />
              <CouponWallet items={coupons} config={c} onUse={id => {
                setCouponId(id); setPaymentConsent(false); setRequestId(createRequestId()); setCompletedBooking(undefined);
                if (leavePaymentReturn("reserve",id)) return;
                if (!onPaneChange) {
                  const query = new URLSearchParams(search); query.set("pane","reserve"); query.set("coupon",id);
                  navigate(`${basePath || "/"}?${query}`); return;
                }
                focusCouponBooking.current = true;
                setPane("reserve");
                if (onPaneChange) onPaneChange("reserve");
              }}/>
            </div>
  );
  const bookingSection = () => confirmed ? <BookingComplete booking={confirmed} config={c} simulation={data.paymentSimulation} onMine={() => {
    if (leavePaymentReturn("mine")) return;
    if (onPaneChange) { onPaneChange("mine"); return; }
    setPane("mine");
    void run(loadMine);
  }} onNew={() => { if (leavePaymentReturn("reserve")) return; setCompletedBooking(undefined); setSelected(""); setTimes([]); setBookingMessage(""); setPaymentConsent(false); setRequestId(createRequestId()); }}/> : !bookableMenus(c).length ? <section className="panel"><h2>{storefrontText(c, "bookingTitle")}</h2><p className="notice" role="status">{tr("予約メニューは準備中です。")}</p></section> : (
            <>
            <TransferOffers base={base} listings={listings} name={name} busy={busy} run={run} simulation={data.paymentSimulation} onStarted={startTransfer} />
            <div className="reservation-layout">
              <div className="panel">
                <span className="eyebrow">RESERVATION</span>
                <h2>{storefrontText(c, "bookingTitle")}</h2>
                <div className="booking-step">
                <h3 ref={couponBookingHeading} tabIndex={-1}>{storefrontText(c, "bookingMenu")}</h3>
                <div className="menu-options">
                  {c.menus
                    .filter((m) => m.active && !m.optionFor)
                    .map((m) => (
                      <button
                        className={menu === m.id ? "selected" : ""}
                        onClick={() => {
                          setMenu(m.id);
                          setOptionIds([]);
                          reportBookingStep("menu_selected");
                        }}
                        key={m.id}
                      >
                        <MenuImage imageId={m.imageId} imageBase={`${base}/menu-images`} name={m.name} />
                        <span>
                          <b>{m.name}</b>
                          <small>{m.duration}{tr("分")}</small>
                        </span>
                        <strong>
                          {yen(m.price)}{" "}
                          <span>{menu === m.id ? "●" : "○"}</span>
                        </strong>
                      </button>
                    ))}
                </div>
                {!!allowedOptions.length && <fieldset className="booking-options"><legend>{tr("追加メニュー（任意）")}</legend><p className="small muted">{tr("選んだ追加メニューの料金と所要時間を合算して空き時間を確認します。同じグループは1つまで選べます。")}</p>{allowedOptions.map(option => <label className="booking-option" key={option.id}><input type="checkbox" checked={optionIds.includes(option.id)} disabled={busy} onChange={event => setOptionIds(current => event.target.checked ? [...current.filter(id => !option.optionGroup || c.menus.find(menu => menu.id === id)?.optionGroup !== option.optionGroup), option.id] : current.filter(id => id !== option.id))}/><MenuImage imageId={option.imageId} imageBase={`${base}/images`} name={option.name} className="booking-option-image"/><span><b>{option.name}</b><small>{yen(option.price)} · {option.duration}{tr("分")}</small></span></label>)}</fieldset>}
                </div>
                <div className="booking-step">
                <h3>{storefrontText(c, c.staff.some(person => person.id !== ownerStaffId) ? "bookingStaffTime" : "bookingTime")}</h3>
                {c.staff.some(person => person.id !== ownerStaffId) && <Field label={tr("スタッフ")}>
                  <select
                    value={staff}
                    onChange={(e) => { setStaff(e.target.value); reportBookingStep("staff_selected", e.target.value || undefined); }}
                  >
                    <option value="">{tr("指名なし（空いているスタッフ）")}</option>
                    {bookingStaff(c)
                      .filter((p) => p.menuIds.includes(menu) && (selection?.options || []).every(option => p.menuIds.includes(option.id)))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>}
                {staff && <MenuImage imageId={c.staff.find(person=>person.id===staff)?.imageId} imageBase={`${base}/images`} name={c.staff.find(person=>person.id===staff)?.name || tr("スタッフ")} className="staff-photo"/>}
                <Field label={tr("ご希望の日付（{0}）", timeZoneLabel)}>
                  <DateInput aria-label={tr("ご希望の日付（{0}）", timeZoneLabel)}
                    min={bookingDates(c)[0]}
                    max={bookingDates(c).at(-1)}
                    value={date}
                    onValueChange={value => { setAutomaticDate(false); setDate(value); }} />
                </Field>
                {timesLoading && <p role="status">{automaticDate ? tr("予約できる最初の日を探しています…") : tr("空き時間を確認しています…")}</p>}
                {!timesLoading && !timesError && automaticDate && date && <p className="small muted">{tr("予約できる最初の日を表示しています。別の日付も選べます。")}</p>}
                {!timesLoading && !timesError && automaticDate && !date && !!selection && <p className="empty-slots">{tr("予約受付期間内にご案内できる時間がありません。お店にお問い合わせください。")}</p>}
                {timesError && <div className="alert" role="alert"><p>{timesError}</p><button type="button" onClick={() => setTimesRetry(value => value + 1)}>{tr("再試行")}</button></div>}
                <div className="time-grid" aria-busy={timesLoading}>
                  {times.map((t) => (
                    <button
                      className={selected === t.start ? "selected" : ""}
                      key={t.start}
                      onClick={() => {
                        setSelected(t.start);
                        reportBookingStep("slot_selected", staff || t.staffId);
                        setRequestId(createRequestId());
                      }}
                    >
                      {new Date(t.start).toLocaleTimeString(intlLocale(), {
                        timeZone: displayTimeZone(),
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </button>
                  ))}
                </div>
                {!timesLoading && !timesError && !!date && !!selection && !times.length && (
                  <p className="empty-slots">
                    {tr("この日にご案内できる時間はありません。別の日付をお選びください。")}{" "}<button type="button" onClick={()=>setAutomaticDate(true)}>{tr("予約できる最初の日を探す")}</button></p>
                )}
                {isCustomer && !!selection && <WaitlistRequest base={base} config={c} date={date} menuId={menu} optionIds={optionIds} staffId={staff} busy={busy} run={run} notify={notify} reload={loadMine} />}
                </div>
                <div className="booking-step">
                <h3>{storefrontText(c, "bookingConfirm")}</h3>
                {selection && <div className="booking-mobile-summary"><p>{selection.base.name}</p>{!!selection.options.length && <ul>{selection.options.map(option => <li key={option.id}>{option.name} · {yen(option.price)}</li>)}</ul>}<p><b className="price">{yen(totalPrice)}</b> · {tr("合計 {0}分", selection.duration)}</p><p>{selected ? when(selected) : tr("日時をお選びください")}</p></div>}
                <Field label={tr("お名前")}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={tr("お名前")}
                  />
                </Field>
                <Field label={tr("お店へのメッセージ（任意）")}>
                  <textarea maxLength={2000} rows={3} value={bookingMessage} onChange={event => { setBookingMessage(event.target.value); setRequestId(createRequestId()); }} placeholder={tr("ご希望や事前に伝えたいことがあればご記入ください")} />
                </Field>
                {!!selectableCoupons.length && <label className="field"><span>{tr("クーポンを選ぶ")}</span><select aria-label={tr("クーポンを選ぶ")} value={couponId} onChange={e => { setCouponId(e.target.value); setRequestId(createRequestId()); }}><option value="">{tr("利用しない")}</option>{selectableCoupons.map(coupon => <option key={coupon.id} value={coupon.id}>{coupon.title} · {couponDiscountLabel(coupon.discount,coupon.currency)} · {tr("有効期限：{0}", when(coupon.expiresAt))}</option>)}</select></label>}
                {selectedCoupon && <div><p>{tr("クーポン割引：{0}", yen(discountAmount))}</p><p className="small coupon-selection-expiry">{tr("有効期限：{0}", shopTime(selectedCoupon.expiresAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",timeZoneName:"short"}))}</p></div>}
                {c.rules.payment?.enabled && totalPrice > 0 ? <div className="payment-policy">
                  <h4>{tr("予約時のお支払いと返金条件")}</h4>
                  <p>{tr("PayPalで{0}をお支払い後、予約が確定します。「PayPalで支払いへ進む」を押してから10分以内に決済を完了しないと、ほかの方が予約できるようになります。", yen(totalPrice))}</p>
                  <p>{policyText(c.rules.payment.refundTiers)}</p>
                  <p className="small">{tr("返金額はキャンセル時点の残り時間で計算し、最小単位（1円・1セント）未満を切り捨てます。店都合は全額返金。予約後に条件が変更されても、この予約の条件は変わりません。")}</p>
                  {data.paymentSimulation && <p className="notice">{tr("プレビューの練習です。実際の支払い・返金は行いません。")}</p>}
                  <label><input type="checkbox" checked={paymentConsent} onChange={e => setPaymentConsent(e.target.checked)} /> {tr("支払額と返金条件を確認しました")}</label>
                </div> : <p className="small muted">{tr("キャンセルは開始 ")}{c.rules.cancelHours} {tr("時間前までマイページで承ります。それ以降はお問い合わせください。")}</p>}
                <button
                  className="primary wide"
                  disabled={
                    busy ||
                    !selection ||
                    !selected ||
                    !name.trim() ||
                    (!isCustomer) ||
                    (!!c.rules.payment?.enabled && totalPrice > 0 && !paymentConsent)
                  }
                  onClick={() =>
                    run(async () => {
                      const result = await api<{ ok: boolean; booking?: Booking; checkout?: PendingCheckout }>(`${base}/bookings`, {
                        name,
                        message: bookingMessage,
                        menuId: menu,
                        ...(optionIds.length ? {optionIds} : {}),
                        expectedPrice: totalPrice,
                        ...(selectedCoupon ? { couponId: selectedCoupon.id } : {}),
                        expectedDuration: selection?.duration,
                        staffId: staff,
                        start: selected,
                        requestId,
                        paymentConsent: paymentConsent && c.rules.payment ? { amount: totalPrice, policy: c.rules.payment.refundTiers } : undefined,
                      });
                      if (result.ok && finishBooking(result.booking)) return;
                      if (result.checkout) {
                        if (result.checkout.phase === "awaiting_approval" && result.checkout.approvalUrl) { window.location.assign(result.checkout.approvalUrl); return; }
                        setPane("mine"); await loadMine(); notify(tr("マイページでお支払いの状況を確認してください。")); return;
                      }
                      setPane("mine"); await loadMine(); notify(tr("予約内容はマイページで確認してください。"));
                    })
                  }
                >
                  {c.rules.payment?.enabled && totalPrice > 0 ? data.paymentSimulation ? tr("支払い・予約を練習する") : tr("PayPalで支払いへ進む") : tr("この内容で予約する")}{" "}
                  →
                </button>
                </div>
              </div>
              <div className="panel booking-summary">
                <span className="line-flower">✳</span>
                <h3>{storefrontText(c, "bookingSummary")}</h3>
                <p>{c.menus.find((m) => m.id === menu)?.name}</p>
                {!!selection?.options.length && <ul className="booking-option-summary">{selection.options.map(option => <li key={option.id}>{option.name} · {yen(option.price)} · {option.duration}{tr("分")}</li>)}</ul>}
                <p className="price">
                  {yen(totalPrice)}
                </p>
                {selection && <p>{tr("合計 {0}分", selection.duration)}</p>}
                <hr />
                <p>{selected ? when(selected) : tr("日時をお選びください")}</p>
                <p className="small muted">
                  {!c.staff.some(person => person.id !== ownerStaffId) ? bookingStaffName(c, ownerStaffId) : !staff
                    ? tr("スタッフの指名なし")
                    : bookingStaffName(c, staff)}
                </p>
                <p className="small muted">{c.address}</p>
              </div>
            </div>
            </>
  );
  const contactForm = () => (
            <form
              className="panel contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy || inquirySending.current) return;
                inquirySending.current = true;
                run(async () => {
                  try {
                    const fields = { name, message, ...await inquiryFiles.read() };
                    const serialized = JSON.stringify(fields);
                    const requestId = inquiryPending.current?.serialized === serialized ? inquiryPending.current.requestId : createRequestId();
                    inquiryPending.current = { serialized, requestId };
                    await api(`${base}/inquiries`, { ...fields, requestId });
                    setMessage(""); inquiryFiles.clear(); inquiryPending.current = undefined;
                    notify(
                      tr("お問い合わせを受け付けました。返信はメールでお送りします。"),
                    );
                  } finally { inquirySending.current = false; }
                });
              }}
            >
              <h2>{storefrontText(c, "contactTitle")}</h2>
              <Field label={tr("お名前")}>
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={tr("メールアドレス")}>
                <input aria-label={tr("メールアドレス")} type="email" autoComplete="email" required readOnly value={shopper?.email || session.user?.email || ""} />
                <small className="muted">{shopper || session.user ? tr("認証済みのメールアドレスです。返信はこちらに届きます。") : tr("ログインすると、お名前とメールアドレスが自動入力されます。")}</small>
              </Field>
              <Field label={tr("ご相談内容")}>
                <textarea
                  required
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
              <InquiryFilePicker selection={inquiryFiles} disabled={busy} />
              <button
                className="primary"
                disabled={busy || (!isCustomer)}
              >
                {tr("お問い合わせを送る →")}</button>
            </form>
  );
  return (
    <ShopRegionContext.Provider value={regionOf(c)}>
    <div className={`public-shop accent-${c.appearance?.accent || "sage"} layout-${c.appearance?.layout || "standard"}${hasThemeFrame(c.appearance?.theme) ? " custom-theme" : ""}`}>
      {data.publication === "provisional" && <div className="preview-banner">{tr("仮公開中 · このページを用意したGoogleアカウントでログインした本人だけが表示できます。")}</div>}
      {!hideHeader && <SiteHeader config={c} imageBase={`${base}/images`}>
      <nav className="public-nav">
        {primaryNavigationItems(c).map(({ pane: id, label }) => (
          <button
            className={!category && !pageSlug && pane === id ? "active" : ""}
            onClick={() =>
              onPaneChange ? onPaneChange(id) : navigate(`${basePath || "/"}?pane=${id}`)
            }
            key={id}
          >
            {label}
          </button>
        ))}
        {
          articleKinds(c).map((cat) => (
            <button
              key={cat}
              className={category === cat ? "active" : ""}
              onClick={() => navigate(`${basePath}/${cat}`)}
            >
              {storefrontText(c, cat === "blogs" ? "navBlogs" : "navAnnouncements")}
            </button>
          ))}
        {c.pages.map(page => <button key={page.id} className={pageSlug === page.slug ? "active" : ""} onClick={() => navigate(`${basePath}/pages/${page.slug}`)}>{page.navigationLabel}</button>)}
      </nav>
      </SiteHeader>}
      <ThemeBody config={c} imageBase={`${base}/images`}>
      {!hideHeader&&!isCustomer&&<section id="customer-signin" tabIndex={-1} className="public-auth" aria-label={tr("会員登録・ログイン")}>
        <div className="public-auth-intro"><strong>{tr("ご予約をご利用の方へ")}</strong><p>{data.googleAuthUrl ? tr("メールアドレスまたはGoogleアカウントでご利用いただけます。") : tr("メールアドレスでご利用いただけます。")}</p></div>
        <div className="public-auth-actions"><div><span>{tr("初めての方")}</span><button className="primary" onClick={() => setEmailLoginOpen(true)}>{tr("会員登録")}</button></div><div><span>{tr("登録済みの方")}</span><button onClick={() => setEmailLoginOpen(true)}>{tr("ログイン")}</button></div></div>
      </section>}
      <CustomerEmailLogin base={base} shopName={c.name} googleAuthUrl={data.googleAuthUrl} open={emailLoginOpen} onClose={() => setEmailLoginOpen(false)}/>
      {isCustomer && data.registrationRequired ? <CustomerRegistration base={base} email={shopper!.email} name={shopper!.name} profile={data.customerProfile} onSaved={profile => { setData(current => current && { ...current, customerProfile: profile, registrationRequired: false }); setName(profile.name); setPane("reserve"); }} /> : pageSlug ? (
        c.pages.find(page => page.slug === pageSlug) ? <CustomPage page={c.pages.find(page => page.slug === pageSlug)!} imageBase={`${base}/images`} /> : <p className="alert">{tr("ページがありません。")}</p>
      ) : category && articleKinds(c).includes(category) ? (
        <PublicBlog
          config={c}
          baseApi={base}
          basePath={basePath}
          category={category}
          articleKey={articleKey}
          navigate={navigate}
        />
      ) : (
        <>
          {pane === "mine" && screen("mine", { news: mineNews(), mypage: <>{mineMember()}{minePanel()}</> }, <>{mineNews()}{mineMember()}{minePanel()}</>)}
          {pane === "reserve" && (isCustomer ? (() => { const booking = bookingSection(); return screen("reserve", { booking }, booking); })() : loginRequired())}
          {pane === "about" && <ShopAbout config={c} imageBase={`${base}/images`} menuImageBase={`${base}/menu-images`} />}
          {pane === "contact" && (() => { const form = contactForm(); return screen("contact", { form }, form); })()}
        </>
      )}
      </ThemeBody>
      {!hideFooter && <SiteFooter config={c} imageBase={`${base}/images`} />}
    </div>
    </ShopRegionContext.Provider>
  );
}

/** Dates with their own hours: open on a holiday that falls on a closed weekday, or open late on one date. */
function SpecialDays({ hours, staff, onChange }: { hours: ShopConfig["hours"]; staff: ShopConfig["staff"]; onChange: (value: NonNullable<ShopConfig["hours"]["specialDays"]>) => void }) {
  const days = hours.specialDays || [];
  const change = (index: number, value: Partial<(typeof days)[number]>) => onChange(days.map((day, i) => i === index ? { ...day, ...value } : day));
  // Everyone works unless the owner narrows the date down; choosing everyone again goes back to "everyone".
  const toggleStaff = (index: number, id: string, on: boolean) => {
    const { staffIds, ...day } = days[index];
    const chosen = new Set(staffIds || staff.map(person => person.id));
    if (on) chosen.add(id); else chosen.delete(id);
    const next = staff.every(person => chosen.has(person.id)) ? day : { ...day, staffIds: staff.map(person => person.id).filter(personId => chosen.has(personId)) };
    onChange(days.map((item, i) => i === index ? next : item));
  };
  return <fieldset className="weekday-hours special-days"><legend>{tr("特別営業日")}</legend>
    <p className="small muted">{tr("祝日だけ定休日でも営業する、特定の日だけ夜遅くまで開ける、など日付ごとの営業時間です。定休日でもこの日は営業し、出勤するスタッフがこの時間で予約を受けます。かわりに休む日は臨時休業日に入れてください。")}</p>
    {days.map((day, index) => <div className="special-day" key={index}><div className="form-grid special-day-row">
      <Field label={tr("日付")}><DateInput aria-label={tr("日付")} required value={day.date} onValueChange={date => change(index, { date })} /></Field>
      <Field label={tr("開店")}><input type="time" required value={day.start} onChange={event => change(index, { start: event.target.value })} /></Field>
      <Field label={tr("閉店")}><input type="time" required value={day.end} onChange={event => change(index, { end: event.target.value })} /></Field>
      <button type="button" className="text-button" aria-label={tr("{0} の特別営業日を削除", day.date || tr("日付未入力"))} onClick={() => onChange(days.filter((_, i) => i !== index))}>{tr("削除")}</button>
    </div>
      {staff.length > 1 && <fieldset className="special-day-staff"><legend>{tr("出勤するスタッフ")}</legend>
        <div className="checkboxes">{staff.map(person => <label key={person.id}><input type="checkbox" checked={!day.staffIds || day.staffIds.includes(person.id)} onChange={event => toggleStaff(index, person.id, event.target.checked)} />{person.name}</label>)}</div>
        <p className="small muted">{day.staffIds ? day.staffIds.length ? tr("選んだスタッフだけが、ふだんの勤務にかかわらずこの時間で予約を受けます。") : tr("出勤するスタッフを1人以上選んでください。") : tr("全員が出勤します。ふだんの勤務にかかわらず、この時間で予約を受けます。")}</p>
      </fieldset>}
    </div>)}
    <button type="button" disabled={days.length >= 100} onClick={() => onChange([...days, { date: nextFreeDate(days.map(day => day.date)), start: hours.start, end: hours.end }])}>{tr("特別営業日を追加")}</button>
  </fieldset>;
}
const nextFreeDate = (taken: string[]) => {
  for (let day = 1; ; day++) {
    const date = new Date(Date.now() + day * 86400000).toISOString().slice(0, 10);
    if (!taken.includes(date)) return date;
  }
};
