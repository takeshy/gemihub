import { regionOf, zonedDate } from "../../shared/region";
import { tr } from "../../shared/i18n";
import { simulatePayment, simulateCancellation } from "../payment-mock";
import { defaultRefundTiers, refundQuote } from "../../server/payment-domain";
import {articlePlainText,articleImagePath,wikiPaths,postImageIds} from "../../server/post-images";
import { inquiryStatus } from "../../server/inquiries";
import { answeredFinalDetails, initialSetupDemoReply, openingQuestions } from "../../server/request-intent";
import { findRelevantHistory } from "../../server/chat-context";
import type { ShopChat, ShopChatMessage } from "../../server/shop-chat";
import { customerProfileSchema, type MemberProfile } from "../../server/customer-profile";
import { updateLiveValue, type LiveSection } from "../../server/live-settings";
import { fingerprint } from "../editor-sync";
import { imageUses } from "../../server/image-references";
import type { LibraryImage } from "../../server/image-library-domain";
import { scopedSource, scopedConfig, type ReleaseScope } from "../../server/pages";
import { shopSystem, systemSvg } from "../../server/shop-system";
import { storyPosts } from "./posts";
import {
  publicPosts,
  summarizePost,
  postKey,
  postContentSchema,
  validatePostAddress,
  uniquePostSlug,
  postAddress,
  type Post,
} from "../../server/post-domain";
import { createRequestId } from "../request-id";
import { aggregateCustomers, customerSummaries, customerFilterSchema, customerSince, customerImages, normalizeEmail, type CustomerNote, type Inquiry } from "../../server/customers";
import type { ApiClient } from "../api";
import type { Plan, Session, Workspace } from "../App";
import {
  sample,
  slots,
  documents,
  planSummary,
  dateJST,
  type Booking,
} from "../../server/domain";
export type Scenario =
  | "us-settings"
  | "us-menus"
  | "us-booking"
  | "payment-reservation"
  | "paid-mypage"
  | "partial-refund"
  | "zero-refund"
  | "full-refund"
  | "pending-refund"
  | "failed-refund"
  | "owner-paid"
  | "manage-payment"
  | "insufficient-refund"

  | "registration"
  | "image-library"
  | "image-library-empty"
  | "image-library-generation"
  | "image-library-retry"
  | "image-library-uploading"
  | "image-page"
  | "crm-list"
  | "crm-detail"
  | "crm-inquiry"
  | "crm-images"
  | "crm-images-empty"
  | "crm-empty"
  | "editor-unfetched"
  | "editor-remote"
  | "editor-conflict"
  | "page-builder"
  | "proposal-failure"
  | "question-failure"
  | "local-editor-pages"
  | "custom-page"
  | "manage-basic"
  | "manage-menus"
  | "menu-images"
  | "menu-images-public"
  | "manage-staff"
  | "manage-hours"
  | "manage-rules"
  | "local-editor"
  | "local-editor-new"
  | "system"
  | "blog-editor"
  | "blog-archive"
  | "blog-article"
  | "announcement-archive"
  | "empty-blog"
  | "manual"
  | "landing"
  | "onboarding"
  | "plan"
  | "provisional"
  | "production-preview"
  | "provisional-unconfigured"
  | "provisional-page"
  | "changes"
  | "bookings"
  | "inquiries"
  | "staff-login"
  | "calendar-disconnected"
  | "calendar-connected"
  | "calendar-member"
  | "calendar-missing-staff"
  | "data"
  | "data-empty"
  | "settings"
  | "sync-error"
  | "publication-error"
  | "reservation"
  | "any-reservation"
  | "customer-choice"
  | "mypage"
  | "contact"
  | "anonymous";
const publicScenarios = new Set<Scenario>([
  "us-booking",
  "payment-reservation",
  "paid-mypage",
  "partial-refund",
  "zero-refund",
  "full-refund",
  "pending-refund",
  "failed-refund",

  "registration",
  "provisional-page",
  "image-page",
  "menu-images-public",
  "custom-page",
  "blog-archive",
  "blog-article",
  "announcement-archive",
  "empty-blog",
  "reservation",
  "any-reservation",
  "customer-choice",
  "mypage",
  "contact",
  "anonymous",
]);
export function scenarioProps(scenario: Scenario) {
  return {
    path:
      scenario === "staff-login" ? "/staff-login/story-shop" : scenario === "production-preview" ? "/publication-preview/story-shop" : scenario === "custom-page" || scenario === "image-page" ? "/s/salon-nagi/pages/faq" : scenario === "blog-archive" || scenario === "empty-blog"
        ? "/s/salon-nagi/blogs"
        : scenario === "announcement-archive"
          ? "/s/salon-nagi/announcements"
          : scenario === "blog-article"
            ? `/s/salon-nagi/blogs/${dateJST()}-autumn-design`
              : publicScenarios.has(scenario)
                ? "/s/salon-nagi"
                : "/",
    search: scenario === "page-builder" ? "?request=1" : scenario.startsWith("crm-images") ? "?customer=guest%40example.com&customerView=images" : scenario === "crm-inquiry" ? "?customer=guest%40example.com&inquiry=guest-inquiry" : scenario === "crm-detail" ? "?customer=guest%40example.com" : "",
    initialTab: ["editor-unfetched", "onboarding"].includes(scenario) ? undefined :
      (
        {
          "image-library": "build", "image-library-empty": "build", "image-library-generation": "build",
          "image-library-uploading": "images",
          manual: "manual",
          system: "build",
          "us-settings": "basic", "us-menus": "menus",
          "local-editor": "try",
          "local-editor-pages": "try",
          "editor-unfetched": "try", "editor-remote": "try", "editor-conflict": "try", "page-builder": "build",
          "manage-basic": "basic", "manage-menus": "menus", "menu-images": "menus", "manage-staff": "staff", "manage-hours": "hours", "manage-rules": "rules",
          "local-editor-new": "try",
          "blog-editor": "blog",
          bookings: "bookings", "owner-paid": "bookings", "manage-payment": "rules", "insufficient-refund": "bookings",
          "crm-list": "customers", "crm-detail": "customers", "crm-inquiry": "customers", "crm-empty": "customers", "crm-images": "customers", "crm-images-empty": "customers",
          inquiries: "inquiries",
          "staff-login": "staff",
          "calendar-disconnected": "staff",
          "calendar-connected": "staff",
          "calendar-member": "staff",
          "calendar-missing-staff": "staff",
          data: "data", "data-empty": "data",
          settings: "settings",
          "sync-error": "bookings",
        } as Partial<Record<Scenario, string>>
      )[scenario] || "build",
    initialPane:
      ["paid-mypage", "partial-refund", "zero-refund", "full-refund", "pending-refund", "failed-refund"].includes(scenario) ? "mine" : scenario === "mypage" || scenario === "anonymous"
        ? undefined
        : scenario === "contact"
          ? "contact"
          : "reserve",
  };
}
export function createMockClient(scenario: Scenario): ApiClient {
  let pendingChatFailure = scenario === "proposal-failure" || scenario === "question-failure";
  let customerProfile: MemberProfile | null = scenario === "registration" ? null : { name: tr("山田 花子"), birthDate: "1990-01-01", gender: "female" };
  const posts = scenario === "empty-blog" ? [] : storyPosts();
  const config = structuredClone(sample);
  if (scenario.startsWith("us-")) { config.region = {country:"US",timeZone:"America/Los_Angeles"}; config.menus = config.menus.map((menu,i)=>({...menu,price:i?78:55.25})); }
  config.hours.closedWeekdays = [];
  if (["payment-reservation", "paid-mypage", "partial-refund", "zero-refund", "full-refund", "pending-refund", "failed-refund", "owner-paid", "manage-payment", "insufficient-refund"].includes(scenario)) config.rules.payment = { enabled: true, refundTiers: structuredClone(defaultRefundTiers) };
  config.notificationEmail = "owner@example.com";
  if (["production-preview", "local-editor-pages", "custom-page", "editor-unfetched", "editor-remote", "editor-conflict", "image-library", "image-library-generation", "image-page"].includes(scenario)) config.pages = [
    { id: "faq", slug: "faq", title: tr("よくある質問"), navigationLabel: tr("よくある質問"), body: tr("## 初めてでも予約できますか？\n\n初めてのお客様も歓迎しています。\n\n## 当日の持ち物は？\n\n特にありません。お気軽にお越しください。"), layout: "standard", imageUrl: "" },
    { id: "about-us", slug: "about-us", title: tr("私たちのお店"), navigationLabel: tr("店舗紹介"), body: tr("## 大切にしていること\n\n一人ひとりに合った時間をご用意します。"), layout: "compact", imageUrl: "" },
  ];
  if (["editor-remote", "editor-conflict"].includes(scenario)) config.pages[0].body = tr("## リモートの変更\n\nリモートで追加された案内です。");
  const menuImages = new Map<string, { mimeType: string; data: string }>();
  const imageMetadata = new Map<string, LibraryImage>();
  const generatedImages = new Map<string, string>();
  const uploadedImages = new Map<string, string>();
  let failImageUpload = scenario === "image-library-retry";
  const ownPhotoImages = new Set<string>();
  if (["menu-images", "menu-images-public", "blog-editor", "manage-staff", "calendar-member", "calendar-connected", "image-library", "image-library-generation", "image-page"].includes(scenario)) {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
    const context = canvas.getContext("2d")!; context.fillStyle = "#d0ded3"; context.fillRect(0, 0, 640, 480);
    context.fillStyle = "#465b50"; context.font = "32px sans-serif"; context.textAlign = "center"; context.fillText("Menu image sample", 320, 240);
    const imageId = "a".repeat(64); if (["manage-staff","calendar-member","calendar-connected"].includes(scenario)) config.staff[scenario === "calendar-member" ? 1 : 0].imageId = imageId; else config.menus[0].imageId = imageId; if(scenario === "menu-images-public")config.staff[0].imageId=imageId;
    menuImages.set(imageId, { mimeType: "image/png", data: canvas.toDataURL("image/png").split(",")[1] });
    imageMetadata.set(imageId, { id: imageId, name: tr("お店の紹介.png"), mimeType: "image/png", size: 12000, source: "upload", createdAt: new Date().toISOString(), usedBy: [] });
    if (scenario.startsWith("image-") && scenario !== "image-library-empty") {
      const secondId = "b".repeat(64);
      menuImages.set(secondId, menuImages.get(imageId)!);
      imageMetadata.set(secondId, { id: secondId, name: tr("AIで生成した季節のイメージ.png"), mimeType: "image/png", size: 12000, source: "ai", model: "gemini-nano-banana-2.1", prompt: tr("明るい窓辺に季節の花を飾った、お店の紹介ページ向けの画像"), createdAt: new Date().toISOString(), usedBy: [] });
      if (scenario === "image-page") { config.header.imageId = imageId; config.pages[0].imageId = secondId; }
    }
  }
  const tomorrow = dateJST(new Date(Date.now() + 86400000));
  const bookings: Booking[] = [
    {
      id: "story-reservation",
      shopId: "story-shop",
      customer: "guest@example.com",
      name: tr("山田 花子"),
      menuId: "simple",
      price: config.menus[0].price,
      message: tr("前回と同じピンクで、短めにお願いします。"),
      staffId: "aoi",
      start: zonedDate(tomorrow,"10:00",regionOf(config).timeZone).toISOString(),
      end: zonedDate(tomorrow,"11:00",regionOf(config).timeZone).toISOString(),
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: "story-cancelled",
      shopId: "story-shop",
      customer: "other@example.com",
      name: tr("鈴木 さくら"),
      menuId: "design",
      price: config.menus[1].price,
      message: "",
      staffId: "haru",
      start: zonedDate(tomorrow,"13:00",regionOf(config).timeZone).toISOString(),
      end: zonedDate(tomorrow,"14:30",regionOf(config).timeZone).toISOString(),
      status: "cancelled",
      createdAt: new Date().toISOString(),
    },
  ];
  if (config.rules.payment?.enabled) {
    bookings.forEach(booking => { simulatePayment(booking, config); if (booking.status === "cancelled") simulateCancellation(booking, "customer"); });
    if (["partial-refund", "pending-refund", "failed-refund"].includes(scenario)) {
      bookings[0].start = new Date(Date.now() + 48 * 3600000).toISOString();
      bookings[0].end = new Date(Date.now() + 49 * 3600000).toISOString();
      simulateCancellation(bookings[0], "customer", scenario === "pending-refund" ? "pending" : scenario === "failed-refund" ? "manual_review" : "completed");
    } else if (scenario === "insufficient-refund") {
      simulateCancellation(bookings[0], "shop"); bookings[0].payment!.cancellation!.status = "awaiting_funds";
    } else if (scenario === "zero-refund") {
      bookings[0].start = new Date(Date.now() + 2 * 3600000).toISOString();
      simulateCancellation(bookings[0], "customer");
    } else if (scenario === "full-refund") simulateCancellation(bookings[0], "shop");
  }
  const plan: Plan = {
    id: "story-plan",
    config: structuredClone(config),
    summary: planSummary(null, config),
    base: 0,
    approved: scenario === "publication-error",
    requiresSetup: scenario === "plan",
  };
  const unpublished = ["onboarding", "plan"].includes(
    scenario,
  );
  const shop: Workspace = {
    id: scenario === "local-editor-new" ? "story-new-shop" : "story-shop",
    owner: "owner@example.com",
    publication: scenario.startsWith("provisional") || scenario === "production-preview" || scenario === "local-editor-new" ? "provisional" : undefined,
    slug: "salon-nagi",
    published: unpublished ? null : config,
    draft: plan.approved ? config : null,
    revision: 0,
    history: unpublished
      ? []
      : [{ at: new Date().toISOString(), summary: tr("お店の予約ページを公開") }],
    isOwner: true,
    plans: ["plan", "publication-error"].includes(
      scenario,
    )
      ? [plan]
      : [],
    bookings: ["onboarding", "plan"].includes(scenario)
      ? []
      : bookings,
    inquiries: [
      {
        id: "story-inquiry",
        name: tr("佐藤 みどり"),
        email: "midori@example.com",
        message:
          tr("初めて伺います。ネイルの色を相談してから決めることはできますか？"),
        reply: "",
        status: "open",
        at: new Date().toISOString(),
      },
    ],
    members: [
      { email: "haru@example.com", accepted: true },
      { email: "family@example.com", accepted: false },
    ],
    jobs:
      scenario === "sync-error"
        ? [
            {
              type: "sync",
              error:
                tr("スプレッドシートに接続できませんでした。再送をお試しください。"),
            },
          ]
        : [],
    publicUrl: "/s/salon-nagi",
    domain: scenario === "settings" ? "reserve.example.com" : undefined,
    domainToken:
      scenario === "settings"
        ? "gemihub-storybook-verification-token"
        : undefined,
  };
  if (scenario === "inquiries") {
    shop.inquiries.push(
      { id: "guest-inquiry", email: "guest@example.com", name: tr("山田 花子"), message: tr("予約をしました。アートの相談をしたいです。"), reply: tr("ご希望の写真があればお持ちください。"), status: "in_progress", at: new Date(Date.now() - 86400000).toISOString() },
      { id: "completed-inquiry", email: "guest@example.com", name: tr("山田 花子"), message: tr("駐車場の場所を教えてください。"), reply: tr("お店の裏にございます。"), status: "completed", at: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: "closed-unreplied", email: "midori@example.com", name: tr("佐藤 みどり"), message: tr("電話で教えていただいた件です。ありがとうございました。"), reply: "", status: "completed", at: new Date(Date.now() - 3 * 86400000).toISOString() },
    );
  }
  const inquiryRequests = new Map<string, { text: string; previousReply: unknown }>();
  const customerNotes: CustomerNote[] = [];
  const customerFileData = new Map<string, string>();
  if (scenario.startsWith("crm-")) {
    if (scenario === "crm-empty") { shop.bookings = []; shop.inquiries = []; }
    else {
      shop.bookings.push(...[28, 7].map((days, index) => ({
        ...bookings[0], id: `past-${index}`, price: index ? 6000 : 5500,
        start: new Date(Date.now() - days * 86400000).toISOString(),
        end: new Date(Date.now() - days * 86400000 + 3600000).toISOString(),
        createdAt: new Date(Date.now() - (days + 1) * 86400000).toISOString(),
      })));
      shop.inquiries.push({ id: "guest-inquiry", email: "guest@example.com", name: tr("山田 花子"), message: tr("前回と同じ色でお願いします。"), reply: tr("同じお色をご用意してお待ちしています。"), status: "replied", at: new Date(Date.now() - 2 * 86400000).toISOString() });
      customerNotes.push({ id: "story-note", shopId: shop.id, email: "guest@example.com", text: tr("落ち着いたピンクがお好み。次回は短めに整える。"), attachments: [], createdBy: shop.owner, createdAt: new Date(Date.now() - 86400000).toISOString(), updatedBy: shop.owner, updatedAt: new Date(Date.now() - 86400000).toISOString(), status: "active" });
    }
  }
  if (scenario === "crm-images" || scenario.startsWith("image-library")) {
    // Generated placeholders keep Storybook independent of real customer photos.
    for (let index = 0; index < 3; index++) {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d")!;
      context.fillStyle = ["#cfddd0", "#e4d3c5", "#cdd9e4"][index]; context.fillRect(0, 0, 640, 480);
      context.fillStyle = "#465b50"; context.font = "32px sans-serif"; context.textAlign = "center";
      context.fillText(`Sample image ${index + 1}`, 320, 240);
      const data = canvas.toDataURL("image/png").split(",")[1];
      const id = `sample-image-${index}`;
      const createdAt = new Date(Date.now() - (index + 1) * 30 * 86400000).toISOString();
      customerFileData.set(id, data);
      customerNotes.push({ id: `image-note-${index}`, shopId: shop.id, email: "guest@example.com", text: tr("共有画面には表示しない施術メモ"), attachments: [{ id, name: [tr("ショートボブ.png"), tr("肩までの長さ.png"), tr("カラーの記録.png")][index], mimeType: "image/png", size: atob(data).length }], createdAt, createdBy: shop.owner, updatedAt: createdAt, updatedBy: shop.owner, status: "active" });
    }
  }
  if (scenario === "publication-error") shop.publishingPlanId = plan.id;
  const customer = (scenario === "registration" || publicScenarios.has(scenario)) && scenario !== "provisional-page";
  const session: Session = {
    demo: false,
    user: [
      "landing",
      "anonymous",
      "blog-archive",
      "blog-article",
      "announcement-archive",
      "empty-blog",
    ].includes(scenario) || scenario === "staff-login"
      ? null
      : {
          email: customer ? "guest@example.com" : "owner@example.com",
          name: customer ? tr("山田 花子") : tr("凪の店主"),
          role: customer ? "customer" : "owner",
          shopId: shop.id,
        },
  };
  if (scenario === "calendar-member") {
    shop.isOwner = false;
    session.user = { email: "haru@example.com", name: tr("はる"), role: "customer", shopId: shop.id };
  }
  const calendarConnection = {
    connected: ["calendar-connected", "calendar-member", "calendar-missing-staff"].includes(scenario),
    email: session.user?.email || shop.owner,
    staffId: scenario === "calendar-missing-staff" ? "removed-staff" : scenario === "calendar-member" ? "haru" : "aoi",
    configured: scenario.startsWith("calendar-") || scenario === "manage-staff",
    loginUrl: `/staff-login/${shop.id}`,
  };
  const staffLogins = config.staff.map(staff => ({ staffId: staff.id, name: staff.name, email: staff.id === "aoi" ? shop.owner : "haru@example.com", accepted: staff.id === "aoi", connected: staff.id === "aoi" && calendarConnection.connected }));
  let visualConfig = structuredClone(config);
  const extraData = { id: "100", title: tr("店販の記録"), headers: [tr("商品"), tr("個数"), tr("金額"), tr("確認済み")], rows: [{ row: 2, values: [tr("ヘアオイル"), 1, 2800, true] as (string | number | boolean)[] }], nextRow: 3 };
  let chats: ShopChat[] = [];
  const chatCache = `gemihub:storybook-chats:${scenario}:${session.user?.email || "anonymous"}`;
  try {
    const saved = JSON.parse(localStorage.getItem(chatCache) || "null");
    if(saved){ chats=saved.chats || []; if(saved.plans&&scenario!=="onboarding")shop.plans=saved.plans; if(saved.published&&scenario!=="onboarding"){shop.published=saved.published;shop.revision=saved.revision;shop.history=saved.history;} }
  } catch {}
  function saveChats(){try{localStorage.setItem(chatCache,JSON.stringify({chats,plans:shop.plans,published:shop.published,revision:shop.revision,history:shop.history}));}catch{}}
  function chatData(id:string){const chat=chats.find(item=>item.id===id);if(!chat)throw new Error(tr("チャットがありません"));return {...chat,plans:shop.plans.filter(plan=>chat.messages.some(message=>message.detail.planId===plan.id))};}
  function addChatTurn(id:string,requestId:string,text:string,answer:string,detail:ShopChatMessage["detail"]={}) {
    const chat=chats.find(item=>item.id===id);if(!chat)throw new Error(tr("チャットがありません"));
    for(const [role,content] of [["user",text],["assistant",answer]] as const)if(content&&!chat.messages.some(message=>message.requestId===requestId&&message.role===role)){
      const at=new Date().toISOString();chat.messages.push({id:`${requestId}:${role}`,shopId:shop.id,conversationId:id,email:session.user!.email,role,text:content,requestId,sequence:chat.messages.length+1,createdAt:at,updatedAt:at,detail:role==="assistant"?detail:{}});chat.updatedAt=at;
    }
    if(text)chat.title=chat.messages.find(message=>message.role==="user")!.text.slice(0,60);
    saveChats();return chat;
  }
  const client: ApiClient = async <T>(
    path: string,
    data?: unknown,
  ): Promise<T> => {
    const url = new URL(path, "http://storybook.local");
    const action = url.pathname;
    const input = (data || {}) as Record<string, unknown>;
    let result: unknown;
    if (action === "/api/session") result = session;
    else if (action === "/api/workspace") result = { shops: [shop] };
    else if (action === "/api/invitations") result = [];
    else if(action===`/api/shops/${shop.id}/conversations`){
      if(data===undefined)result={email:session.user!.email,conversations:chats.map(({messages,...chat})=>chat).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};
      else {
        const id=await fingerprint({shopId:shop.id,email:session.user!.email,requestId:input.requestId});
        let chat=chats.find(item=>item.id===id);
        if(!chat){const now=new Date().toISOString();chat={id,shopId:shop.id,email:session.user!.email,intent:input.intent as ShopChat["intent"],title:tr("新しいチャット"),createdAt:now,updatedAt:now,messages:[]};chats.push(chat);saveChats();}
        if(input.begin&&!chat.messages.length)addChatTurn(id,"opening","",openingQuestions[chat.intent]);
        result=chatData(id);
      }
    }
    else if(action.startsWith(`/api/shops/${shop.id}/conversations/`))result=chatData(action.split("/").at(-1)!);
    else if (action === `/api/shops/${shop.id}/data/sheets`) result = scenario === "data" ? [{ id: extraData.id, title: extraData.title }] : [];
    else if (action === `/api/shops/${shop.id}/data/sheets/100`) result = extraData;
    else if (action.startsWith(`/api/shops/${shop.id}/data/sheets/100/rows/`)) {
      const row = Number(action.split("/").at(-1));
      const values = input.values as (string | number | boolean)[];
      const previous = input.previous as (string | number | boolean)[];
      const current = extraData.rows.find(item => item.row === row);
      if (current && JSON.stringify(current.values) !== JSON.stringify(previous) && JSON.stringify(current.values) !== JSON.stringify(values)) throw new Error(tr("この行が更新されています"));
      if (current) current.values = [...values]; else { extraData.rows.push({ row, values: [...values] }); extraData.nextRow++; }
      result = { ok: true };
    }
    else if (action.startsWith(`/api/shops/${shop.id}/staff-photo`)) {
      const staff = shop.published!.staff.find(person => person.id === "haru")!;
      const current = () => [...imageMetadata.values()].filter(image => image.id === staff.imageId || ownPhotoImages.has(image.id));
      if (action.endsWith("/images") && data === undefined) result = current();
      else if (action.endsWith("/images")) {
        const id = String(menuImages.size+1).padStart(64,"0");menuImages.set(id,{mimeType:String(input.mimeType),data:String(input.data)});ownPhotoImages.add(id);imageMetadata.set(id,{id,name:String(input.name),mimeType:String(input.mimeType),size:atob(String(input.data)).length,source:"upload",usedBy:[],createdAt:new Date().toISOString()});result={imageId:id};
      } else if (action.includes("/images/")) { const id=action.split("/").at(-1)!; if(!current().some(image=>image.id===id))throw new Error(tr("画像がありません"));result=menuImages.get(id); }
      else if (data === undefined) result={staffId:staff.id,name:staff.name,imageId:staff.imageId};
      else {if((staff.imageId||"")!==input.previousImageId)throw new Error(tr("写真が更新されています"));staff.imageId=input.imageId as string|undefined;shop.revision++;result={ok:true};}
    }
    else if (action === `/api/shops/${shop.id}/images` && data === undefined) {
      result = [...imageMetadata.values()].map(image => ({ ...image, usedBy: imageUses(shop.published, image.id) }));
    }
    else if (action === `/api/shops/${shop.id}/images/generate` && data !== undefined) {
      let imageId = generatedImages.get(String(input.requestId));
      if (!imageId) {
        imageId = String(menuImages.size + 1).padStart(64, "0"); generatedImages.set(String(input.requestId), imageId);
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
        const context = canvas.getContext("2d")!; context.fillStyle = "#dfcbd0"; context.fillRect(0, 0, 640, 480); context.fillStyle = "#73555d"; context.font = "32px sans-serif"; context.textAlign = "center"; context.fillText("AI image sample", 320, 240);
        menuImages.set(imageId, { mimeType: "image/png", data: canvas.toDataURL("image/png").split(",")[1] });
        imageMetadata.set(imageId, { id: imageId, name: String(input.name), mimeType: "image/png", size: 12000, source: "ai", model: "gemini-nano-banana-2.1", prompt: String(input.prompt), createdAt: new Date().toISOString(), usedBy: [] });
      }
      result = { imageId };
    }
    else if (/\/images\/[a-f0-9]{64}\/(rename|archive)$/.test(action) && data !== undefined) {
      const parts = action.split("/"); const id = parts.at(-2)!; const image = imageMetadata.get(id); if (!image) throw new Error(tr("画像がありません"));
      if (parts.at(-1) === "rename") image.name = String(input.name);
      else { if (imageUses(shop.published, id).length) throw new Error(tr("使用中の画像は削除できません。")); imageMetadata.delete(id); menuImages.delete(id); }
      result = { ok: true };
    }
    else if ([`/api/shops/${shop.id}/menu-images`, `/api/shops/${shop.id}/images`].includes(action) && data !== undefined) {
      if (scenario === "image-library-uploading") return new Promise<T>(() => {});
      const imageId = uploadedImages.get(String(input.requestId)) || String(menuImages.size + 1).padStart(64, "0");
      uploadedImages.set(String(input.requestId), imageId);
      menuImages.set(imageId, { mimeType: String(input.mimeType), data: String(input.data) }); result = { imageId };
      imageMetadata.set(imageId, { id: imageId, name: String(input.name), mimeType: String(input.mimeType), size: atob(String(input.data)).length, source: "upload", createdAt: new Date().toISOString(), usedBy: [] });
      if (failImageUpload) { failImageUpload = false; throw new Error(tr("操作できませんでした")); }
    }
    else if (/\/(menu-images|images)\/[a-f0-9]{64}$/.test(action)) {
      const image = menuImages.get(action.split("/").at(-1)!); if (!image) throw new Error(tr("メニュー画像がありません")); result = image;
    }
    else if (action.startsWith(`/api/shops/${shop.id}/customers`)) {
      const filter = customerFilterSchema.parse({ period: url.searchParams.get("period") ?? undefined, since: url.searchParams.get("since") ?? undefined });
      const now = new Date();
      const current = () => aggregateCustomers(shop.bookings, shop.inquiries.map(inquiry => ({ ...inquiry, shopId: shop.id, at: inquiry.at || now.toISOString() })) as Inquiry[], customerNotes, now, customerSince(filter, now), scenario === "crm-empty" ? [] : [{ shopId: shop.id, email: "guest@example.com", name: tr("山田 花子"), birthDate: "1992-06-15", gender: "female", updatedBy: shop.owner, updatedAt: now.toISOString() }]);
      const route = action.match(/\/customers(?:\/([^/]+)(?:\/(.*))?)?$/)!;
      if (!route[1]) result = customerSummaries(current());
      else {
        const email = normalizeEmail(decodeURIComponent(route[1]));
        const customer = current().find(customer => customer.email === email);
        if (!customer) throw new Error(tr("お客様が見つかりません"));
        const tail = route[2] || "";
        if (tail === "images") return structuredClone({ name: customer.name, images: customerImages(customerNotes.filter(note => note.email === email)) }) as T;
        if (tail === "notes") {
          const id = String(input.requestId);
          if (!customerNotes.some(note => note.id === id)) {
            const uploaded = (input.files || []) as { name: string; mimeType: string; data: string }[];
            const attachments = uploaded.map(file => { const fileId = createRequestId(); customerFileData.set(fileId, file.data); return { id: fileId, name: file.name, mimeType: file.mimeType, size: atob(file.data).length }; });
            customerNotes.push({ id, shopId: shop.id, email, text: String(input.text), attachments, createdAt: now.toISOString(), createdBy: shop.owner, updatedAt: now.toISOString(), updatedBy: shop.owner, status: "active" });
          }
        } else if (tail) {
          const parts = tail.split("/");
          const note = customerNotes.find(note => note.id === parts[1] && note.email === email && note.status === "active");
          if (!note) throw new Error(tr("メモがありません"));
          if (parts[2] === "files") {
            if (!note.attachments.some(file => file.id === parts[3])) throw new Error(tr("添付ファイルがありません"));
            return { data: customerFileData.get(parts[3]) || "" } as T;
          }
          if (input.previousUpdatedAt !== note.updatedAt) throw new Error(tr("メモが更新されています。詳細を開き直してください。"));
          if (parts[2] === "delete") note.status = "deleted";
          else {
            if (input.text !== undefined) note.text = String(input.text);
            for (const change of (input.attachmentNames || []) as {id: string; name: string}[]) {
              const file = note.attachments.find(file => file.id === change.id);
              if (!file) throw new Error(tr("添付ファイルがありません"));
              file.name = change.name.trim();
            }
          }
          note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1)).toISOString();
        }
        result = current().find(customer => customer.email === email);
      }
    }
    else if (action.startsWith(`/api/shops/${shop.id}/live-settings/`)) {
      const section = action.split("/").at(-1) as LiveSection;
      if (data === undefined) result = { config: shop.published || config };
      else { shop.published = updateLiveValue(shop.published || config, section, input.value); shop.revision++; result = { ok: true }; }
    }
    else if (action === `/api/shops/${shop.id}/pages/create-with-ai`) {
      const messages = input.messages as { role: string; text: string }[];
      const ready = input.mode === "write" || messages.filter(m => m.role === "user").length >= 2;
      result = { reply: ready ? tr("FAQ のページ案ができました。内容を確認してツリーに追加してください。") : tr("どんな質問や案内を載せたいですか？"), page: ready ? { slug: "new-faq", title: tr("新しいFAQ"), navigationLabel: tr("よくある質問"), body: tr("## 初めてのお客様へ\n\nご予約方法をご案内します。"), layout: "standard", imageUrl: "", imageId: (input.imageIds as string[] | undefined)?.[0] } : null };
    }
    else if (action === `/api/shops/${shop.id}/local-editor/index`) result = {
      base: shop.revision, published: !!shop.published, lastPublishedPlanId: shop.lastPublishedPlanId,
      sharedHash: await fingerprint(scopedSource(shop.published, { kind: "shared" })),
      parts: { header: await fingerprint(shop.published?.header || null), footer: await fingerprint(shop.published?.footer || null) },
      pages: await Promise.all((shop.published?.pages || []).map(async p => ({ id: p.id, title: p.title, slug: p.slug, hash: await fingerprint(p) }))),
    };
    else if (action === `/api/shops/${shop.id}/local-editor/shared`) result = { base: shop.revision, source: shop.published ? { ...shop.published, pages: [] } : null, config: { ...(shop.published || config), pages: [] }, lastPublishedPlanId: shop.lastPublishedPlanId };
    else if (action.startsWith(`/api/shops/${shop.id}/local-editor/pages/`)) result = { base: shop.revision, page: shop.published?.pages.find(p => p.id === action.split("/").at(-1)) || null };
    else if (action === `/api/shops/${shop.id}/local-editor/merge`) {
      const scope = input.scope as ReleaseScope;
      const remote = input.expectedRemote as Record<string, unknown> | null;
      const local = input.localValue as Record<string, unknown> | null;
      result = { value: scope.kind === "page" ? { ...(remote || local), body: tr("## AIの結合案\n\n{0}\n\n{1}", String(local?.body || ""), String(remote?.body || "")) } : { ...remote, ...local }, explanation: tr("ローカルとリモートの案内を両方残した結合案です。") };
    }
    else if (action === `/api/shops/${shop.id}/local-editor`) result = { base: shop.revision, source: shop.published, config: shop.published || config, lastPublishedPlanId: shop.lastPublishedPlanId };
    else if (action === `/api/shops/${shop.id}/visual/propose`) {
      const next = structuredClone(visualConfig) as typeof config;
      if (String(input.target).startsWith("page:")) {
        const [, id, field] = String(input.target).split(":");
        const page = next.pages.find(p => p.id === id)!;
        if (field === "body") page.body = tr("## ペンで変更した内容\n\nローカルのページ本文を更新しました。");
        else page.title = tr("ペンで変更したページ");
      } else if (input.target === "part:header") next.header.title = tr("季節を楽しむアトリエ");
      else if (input.target === "part:footer") next.footer.text = tr("お会いできる日を楽しみにしています。");
      else if (input.target === "name") next.name = tr("季節のアトリエ");
      else next.description = tr("季節を楽しむ、小さなネイルサロン。");
      result = { config: next, summary: [tr("選んだ対象をローカルで変更")] };
    }
    else if (action === `/api/shops/${shop.id}/posts/metadata`) {
      const article=input.content as {title:string;body:string};
      const current=posts.find(post=>post.id===input.postId);
      if(current&&current.version!==input.version)throw new Error(tr("記事が更新されています。一覧から記事を開き直してください"));
      result={slug:current?.address?.slug||current?.draft.slug||`article-${(await fingerprint(article.title)).slice(0,12)}`,excerpt:(articlePlainText(article.body)||article.title).slice(0,140)};
    }
    else if (action === `/api/shops/${shop.id}/posts/files`) result=[{path:"spec.md",name:tr("お店の設定（spec.md）"),kind:"text"},{path:"history.md",name:tr("変更履歴（history.md）"),kind:"text"},...[...imageMetadata.values()].map(image=>({path:articleImagePath(image.id,image.name),name:image.name,kind:"image",imageId:image.id}))];
    else if (action === `/api/shops/${shop.id}/posts/propose`) {
      const selected=wikiPaths(String(input.instruction)).map(path=>[...imageMetadata.values()].find(image=>articleImagePath(image.id,image.name)===path)).filter(Boolean);
      result={title:String(input.title||tr("季節のお店のお便り")),excerpt:"",body:[String(input.source||input.instruction),...selected.map(image=>`![${image!.name}](shop-image:${image!.id})`)].join("\n\n"),conversationId:"c".repeat(64)};
    }
    else if (action === `/api/shops/${shop.id}/posts`) {
      if (data === undefined) result = posts;
      else {
        const content = postContentSchema.parse(input.content);
        const at = new Date().toISOString();
        const post: Post = {
          id: createRequestId(),
          shopId: shop.id,
          draft: content,
          published: null,
          version: 1,
          createdAt: at,
          updatedAt: at,
          updatedBy: "owner@example.com",
        };
        if(input.autoMetadata)content.slug=uniquePostSlug(content,posts,post.id);
        validatePostAddress(post, content, posts);
        if (input.publish) { post.published = structuredClone(content); post.publishedAt = at; post.address = postAddress(content); }
        posts.unshift(post);
        result = post;
      }
    } else if (action.match(/\/posts\/[^/]+\/(save|publish|unpublish)$/)) {
      const post = posts.find((p) => p.id === action.split("/").at(-2));
      if (!post) throw new Error(tr("記事がありません"));
      if (post.version !== input.version)
        throw new Error(tr("記事が更新されています。一覧を更新してください"));
      if (action.endsWith("/save")) {
        const content = postContentSchema.parse(input.content);
        validatePostAddress(post, content, posts);
        post.draft = content;
        if (input.publish) { post.published = structuredClone(content); post.publishedAt = new Date().toISOString(); post.address = postAddress(content); }
      } else if (action.endsWith("/publish")) {
        if (input.approved !== true) throw new Error(tr("内容を承認してください"));
        post.published = structuredClone(post.draft);
        post.publishedAt = new Date().toISOString();
        post.address = postAddress(post.draft);
      } else post.published = null;
      post.version++;
      post.updatedAt = new Date().toISOString();
      result = post;
    } else if (action === `/api/shops/${shop.id}/build-context`) {
      result={config:shop.published||shop.draft,published:!!shop.published,revision:shop.revision,hash:await fingerprint(shop.published||shop.draft),history:shop.history};
    } else if (action === `/api/shops/${shop.id}/system`) {
      result = {diagram: shopSystem(shop.published || config), svg: systemSvg(shop.published || config), overview: systemSvg(shop.published || config, false), revision: shop.revision};
    } else if (action === `/api/shops/${shop.id}/system/question`) {
      if (scenario === "question-failure" && pendingChatFailure) { pendingChatFailure = false; throw new Error(tr("操作できませんでした")); }
      const chatReference=input.chat as {id:string;requestId:string}|undefined;
      const existing=chatReference?chats.find(chat=>chat.id===chatReference.id)?.messages.find(message=>message.requestId===chatReference.requestId&&message.role==="assistant"):undefined;
      if(existing)return structuredClone({answer:existing.text,...existing.detail,chat:chatData(chatReference!.id)}) as T;
      const hasImages = !!(input.imageIds as string[] | undefined)?.length;
      const newPage = input.intent === "new-page";
      const creation=input.intent==="create-shop";
      const changeRequest = input.intent !== "consult" && (newPage || /変更|したい|変え|追加|使って|change|add|use|want/i.test(String(input.question)));
      result = {answer: newPage && changeRequest ? tr("新しいページと、お客様向けのメニューに表示する名前を確認してください。") : hasImages && changeRequest ? tr("選んだ画像を使う変更ですね。変更案を確認してから承認・公開してください。") : changeRequest ? tr("水曜日も定休日にする変更ですね。変更プランを作り、内容を確認してから承認・公開してください。") : /履歴|history/i.test(String(input.question)) ? tr("変更履歴には「お店の予約ページを公開」が記録されています。現在のメニューや勤務時間は左の仕様で確認できます。") : tr("お客様が指名・指名なしを選べます。指名時は指定先だけ、指名なしは対応スタッフ全員の勤務時間と既存の予約を確認して空き枠を表示します。"), changeRequest};
      const currentMessages=chatReference?chats.find(chat=>chat.id===chatReference.id)?.messages || []:[];
      const related=findRelevantHistory(chats.flatMap(chat=>chat.messages),new Map(chats.map(chat=>[chat.id,chat.intent])),String(input.question),new Set(currentMessages.slice(-24).map(message=>message.id)));
      (window as unknown as {__omaiStoryLastHistory:unknown}).__omaiStoryLastHistory=related;
      if(/前|以前|previous|earlier|before/i.test(String(input.question))&&related.length){const previous=related.flatMap(item=>item.messages).find(message=>message.role==="user");result={answer:tr("以前は「{0}」とお話しされていました。現在の設定と照らし合わせてお手伝いします。", previous?.text),changeRequest:false};}
      const ready=!newPage || /FAQ|よくある質問|メニュー|予約方法|持ち物|menu|booking|bring/i.test(String(input.question));
      if(creation)result=initialSetupDemoReply(String(input.question),currentMessages);
      if(newPage&&!ready)result={answer:tr("どんな内容を載せて、メニューには何と表示したいですか？"),changeRequest:true,ready:false};
      else if(!creation) result={...(result as object),ready:changeRequest};
      if(chatReference){const reply=result as {answer:string;changeRequest:boolean;ready:boolean};const chat=addChatTurn(chatReference.id,chatReference.requestId,String(input.question),reply.answer,{changeRequest:reply.changeRequest,ready:reply.ready});result={...reply,chat};}
    } else if (action === `/api/shops/${shop.id}/visual/identify`) {
      visualConfig = structuredClone((input.displayed || config) as typeof config);
      const part = (input.local as { part?: "header" | "footer" } | undefined)?.part;
      if (part) result = { id: "story-visual", explanation: tr("共通パーツの変更対象を確認してください。"), candidates: [{ id: `part:${part}`, label: part === "header" ? tr("共通ヘッダー") : tr("共通フッター") }] };
      else if (visualConfig.pages.length && /ページ|page/i.test(String(input.instruction))) {
        const pageId = (input.local as { pageId?: string } | undefined)?.pageId;
        const page = visualConfig.pages.find(p => p.id === pageId) || visualConfig.pages.at(-1)!;
        result = { id: "story-visual", explanation: tr("ページの変更対象を確認してください。"), candidates: [{ id: `page:${page.id}:title`, label: tr("ページ見出し：{0}", page.title) }, { id: `page:${page.id}:body`, label: tr("ページ本文：{0}", page.title) }] };
      } else result = {id: "story-visual", explanation: tr("Storybook のサンプルでは、店名か紹介文を候補として表示します。"), candidates: [{id: "name", label: tr("店名：{0}", config.name)}, {id: "description", label: tr("紹介文：{0}", config.description)}]};
    } else if (action === `/api/shops/${shop.id}/plan`) {
      if (scenario === "proposal-failure" && pendingChatFailure) { pendingChatFailure = false; throw new Error(tr("操作できませんでした")); }
      const reference=input.chat as {id:string;requestId:string}|undefined;
      const previousReply=reference?chats.find(chat=>chat.id===reference.id)?.messages.find(message=>message.requestId===reference.requestId&&message.role==="assistant"):undefined;
      if(previousReply?.detail.planId){const previous=shop.plans.find(plan=>plan.id===previousReply.detail.planId);if(previous)return structuredClone(previous) as T;}
      if(input.intent==="create-shop"&&reference){const messages=chats.find(chat=>chat.id===reference.id)?.messages || [];if(!previousReply?.detail.ready||!answeredFinalDetails(messages.filter(message=>message.sequence<=previousReply.sequence)))throw new Error(tr("確認画面へ進む前に、ほかに伝えたいことがあるかお答えください"));}
      let next = input.config
        ? structuredClone(input.config as typeof config)
        : structuredClone(config);
      const local = input.local as { scope?: ReleaseScope } | undefined;
      if (local?.scope) next = scopedConfig(shop.published, next, local.scope);
      if (input.intent === "new-page") {
        const id = `faq-${shop.plans.length + 1}`;
        next = { ...structuredClone(shop.published || config), pages: [...(shop.published || config).pages, { id, slug: id, title: tr("よくある質問"), navigationLabel: tr("よくある質問"), body: tr("## 初めてのお客様へ\n\n予約方法・持ち物・キャンセルについてご案内します。"), layout: "standard", imageUrl: "", imageId: (input.imageIds as string[] | undefined)?.[0] }] };
      } else if (input.visual) {
        const target = (input.visual as {target: string}).target;
        if (target === "name") next.name = tr("季節のアトリエ");
        else next.description = tr("季節を楽しむ、小さなネイルサロン。");
      } else if (!input.config && (input.imageIds as string[] | undefined)?.length) {
        const imageId = (input.imageIds as string[])[0];
        if (/FAQ|よくある質問/.test(String(input.text)) && next.pages.length) { next.pages[0].imageId = imageId; next.pages[0].imageUrl = ""; }
        else { next.header.imageId = imageId; next.header.imageUrl = ""; }
      } else if (!input.config && shop.published) {
        next.hours.closedWeekdays = [3];
        next.menus.push({
          id: "special",
          name: tr("ご褒美ケアコース"),
          duration: 90,
          price: 8500,
          active: true,
        });
        next.staff[0].menuIds.push("special");
      }
      const generated: Plan = {
        id: `plan-${shop.plans.length + 1}`,
        config: next,
        summary: planSummary(shop.published, next),
        base: shop.revision,
        approved: false,
        requiresSetup: !shop.published && !input.config,
      };
      shop.plans.push(generated);
      if(previousReply){previousReply.detail.planId=generated.id;saveChats();}
      result = generated;
    } else if (action.startsWith(`/api/shops/${shop.id}/plans/`)) {
      const id = action.split("/").at(-2);
      const current = shop.plans.find((p) => p.id === id);
      if (!current) throw new Error(tr("プランが見つかりません"));
      if (action.endsWith("/approve")) {
        current.approved = true;
        shop.draft = current.config;
      } else if (action.endsWith("/publish")) {
        if (!current.approved) throw new Error(tr("先にプランを承認してください"));
        const publication = input.publication as "provisional" | "public" | undefined || shop.publication || (shop.published ? "public" : "provisional");
        shop.publication = publication;
        shop.published = current.config;
        shop.draft = null;
        shop.history.push({
          at: new Date().toISOString(),
          summary: current.summary.join("、"),
        });
        shop.revision++;
        shop.lastPublishedPlanId = current.id;
        if(chats.length)saveChats();
        delete shop.publishingPlanId;
      } else throw new Error(tr("未対応のモック操作"));
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/publication-preview`) {
      const current = shop.published || config;
      const live = publicPosts(posts);
      result = { config: current, posts: live, revision: shop.revision, hash: await fingerprint({ config: current, posts: live }) };
    } else if (action === `/api/shops/${shop.id}/publication`) {
      if (input.hash !== await fingerprint({ config: shop.published || config, posts: publicPosts(posts) })) throw new Error(tr("プレビュー後に内容が変わりました"));
      if (input.revision !== shop.revision) throw new Error(tr("お店の内容が変わりました"));
      shop.publication = "public";
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/documents`)
      result = documents(shop.published || config, shop.history);
    else if (action === `/api/staff-login/${shop.id}`) result = { name: config.name, configured: true };
    else if (action === `/api/shops/${shop.id}/staff-accounts` && data === undefined) result = { staff: staffLogins, configured: true, loginUrl: `/staff-login/${shop.id}` };
    else if (action === `/api/shops/${shop.id}/staff-accounts`) {
      const staff = staffLogins.find(staff => staff.staffId === input.staffId);
      if (!staff) throw new Error(tr("担当スタッフがありません"));
      if (staff.email !== input.previousEmail) throw new Error(tr("登録内容が更新されています"));
      if (input.email && staffLogins.some(other => other !== staff && other.email === input.email)) throw new Error(tr("このアカウントは別のスタッフに登録されています"));
      staff.email = String(input.email); staff.accepted = false; staff.connected = false; result = { ok: true };
    }
    else if (action === `/api/shops/${shop.id}/calendar`) {
      result = calendarConnection;
    }
    else if (action === `/api/shops/${shop.id}/calendar/disconnect`) {
      calendarConnection.connected = false;
      calendarConnection.staffId = "";
      result = { ok: true };
    }
    else if (action === `/api/shops/${shop.id}/calendar/connect`) {
      throw new Error(tr("Storybook のサンプルです。実際の Google 認証は行いません。連携後の画面は「Calendar 連携中」で確認できます。"));
    }
    else if (action === `/api/shops/${shop.id}/invite`) {
      shop.members.push({ email: String(input.email), accepted: false });
      result = { ok: true };
    } else if (action.endsWith("/reply")) {
      const q = shop.inquiries.find((q) => q.id === action.split("/").at(-2));
      if (!q) throw new Error(tr("お問い合わせがありません"));
      const previous = input.requestId ? inquiryRequests.get(String(input.requestId)) : undefined;
      if (previous && (previous.text !== input.text || previous.previousReply !== input.previousReply)) throw new Error(tr("返信内容が変わっています。入力し直してください"));
      if (!previous) {
        if (input.previousReply !== undefined && input.previousReply !== q.reply) throw new Error(tr("他の担当者が返信しています。最新の状態を確認してください"));
        if (!String(input.text).trim()) throw new Error(tr("返信内容を入力してください"));
        q.reply = String(input.text).trim();
        q.status = inquiryStatus(q);
        if (input.requestId) inquiryRequests.set(String(input.requestId), { text: String(input.text), previousReply: input.previousReply });
      }
      result = { ok: true };
    } else if (action.includes("/inquiries/") && action.endsWith("/status")) {
      const q = shop.inquiries.find(q => q.id === action.split("/").at(-2));
      if (!q) throw new Error(tr("お問い合わせがありません"));
      if (!["in_progress", "completed"].includes(String(input.status))) throw new Error(tr("対応状況を選択してください"));
      if (input.previousStatus && input.previousStatus !== inquiryStatus(q) && input.status !== inquiryStatus(q)) throw new Error(tr("対応状況が更新されています。最新の状態を確認してください"));
      q.status = String(input.status);
      result = { ok: true };
    } else if (action.endsWith("/status")) {
      const b = shop.bookings.find((b) => b.id === action.split("/").at(-2));
      if (!b) throw new Error(tr("予約がありません"));
      if (input.status === "cancelled") simulateCancellation(b, "shop");
      else b.status = input.status as Booking["status"];
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/retry`) {
      for (const booking of shop.bookings) if (booking.payment?.cancellation?.status === "awaiting_funds") booking.payment.cancellation.status = "completed";
      shop.jobs = [];
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/domain`) {
      shop.domain = String(input.domain);
      shop.domainToken = "gemihub-storybook-verification-token";
      shop.domainVerified = false;
      result = { ok: true };
    } else if (action.endsWith("/domain/verify")) {
      shop.domainVerified = true;
      result = { ok: true };
    } else if (
      action.startsWith("/api/public/")
    ) {
      const preview = false;
      const current = preview ? plan.config : shop.published || config;
      if (action.endsWith("/posts")) {
        const category = url.searchParams.get("category");
        const page = Number(url.searchParams.get("page") || 1);
        const all = publicPosts(posts).filter(
          (p) => !category || p.category === category,
        );
        result = {
          items: all.slice((page - 1) * 12, page * 12).map(summarizePost),
          total: all.length,
          page,
          size: 12,
        };
      } else if (/\/posts\/(blogs|announcements)\/[a-z0-9-]+$/.test(action)) {
        const parts = action.split("/");
        result = publicPosts(posts).find(
          (p) => p.category === parts.at(-2) && postKey(p) === parts.at(-1),
        );
        if (!result) throw new Error(tr("記事がありません"));
      } else if (action.endsWith("/slots"))
        result = slots(
          current,
          preview ? [] : shop.bookings,
          url.searchParams.get("date") || "",
          url.searchParams.get("menu") || "",
          url.searchParams.get("staff") || undefined,
        );
      else if (action.endsWith("/checkouts")) result = [];
      else if (action.endsWith("/cancel-quote")) {
        const b = shop.bookings.find(b => b.id === action.split("/").at(-2));
        if (!b?.payment) throw new Error(tr("支払い済みの予約がありません"));
        result = refundQuote(b.payment.amount, b.start, new Date().toISOString(), b.payment.policy, "customer");
      }
      else if (action.endsWith("/bookings") && data === undefined)
        result = preview
          ? []
          : shop.bookings.filter((b) => b.customer === session.user?.email);
      else if (action.endsWith("/bookings")) {
        const start = String(input.start);
        const date = dateJST(new Date(start));
        const slot = slots(
          current,
          preview ? [] : shop.bookings,
          date,
          String(input.menuId),
          input.staffId ? String(input.staffId) : undefined,
        ).find((s) => s.start === start);
        if (!slot)
          throw new Error(tr("この枠は予約できません。別の時間を選んでください。"));
        if (!preview)
          shop.bookings.push(simulatePayment({
            id: createRequestId(),
            shopId: shop.id,
            customer: "guest@example.com",
            name: String(input.name),
            message: String(input.message || ""),
            menuId: String(input.menuId),
            price: current.menus.find(menu => menu.id === input.menuId)!.price,
            ...slot,
            status: "active",
            createdAt: new Date().toISOString(),
          }, current));
        result = { ok: true };
      } else if (action.endsWith("/cancel")) {
        const b = shop.bookings.find(
          (b) =>
            b.id === action.split("/").at(-2) &&
            b.customer === "guest@example.com",
        );
        if (!b) throw new Error(tr("予約がありません"));
        simulateCancellation(b, "customer");
        result = { ok: true };
      } else if (action.endsWith("/profile")) {
        if (input && data !== undefined) customerProfile = customerProfileSchema.parse(input);
        result = { profile: customerProfile };
      } else if (action.endsWith("/inquiries")) result = { ok: true };
      else
        result = {
          config: current,
          paymentSimulation: true,
          shopId: shop.id,
          customerProfile: session.user?.role === "customer" ? customerProfile : undefined,
          registrationRequired: session.user?.role === "customer" && !customerProfile,
          preview,
          publication: shop.publication || "public",
          authUrl: "/auth/google",
          recentPosts: preview
            ? []
            : publicPosts(posts).slice(0, 5).map(summarizePost),
        };
    } else throw new Error(tr("Storybook に未定義の操作です: {0}", action));
    // Match JSON transport semantics: callers cannot mutate the fixture through returned objects.
    return structuredClone(result) as T;
  };
  return client;
}
