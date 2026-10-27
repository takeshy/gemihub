import { shopSystem, systemSvg } from "../../server/shop-system";
import { storyPosts } from "./posts";
import {
  publicPosts,
  summarizePost,
  postKey,
  postContentSchema,
  validatePostAddress,
  postAddress,
  type Post,
} from "../../server/post-domain";
import { createRequestId } from "../request-id";
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
  | "system"
  | "visual-preview"
  | "visual-live"
  | "blog-editor"
  | "blog-archive"
  | "blog-article"
  | "announcement-archive"
  | "empty-blog"
  | "manual"
  | "landing"
  | "onboarding"
  | "plan"
  | "approved"
  | "changes"
  | "bookings"
  | "inquiries"
  | "team"
  | "data"
  | "settings"
  | "sync-error"
  | "publication-error"
  | "reservation"
  | "any-reservation"
  | "mypage"
  | "contact"
  | "preview"
  | "anonymous";
const publicScenarios = new Set<Scenario>([
  "blog-archive",
  "blog-article",
  "announcement-archive",
  "empty-blog",
  "reservation",
  "any-reservation",
  "mypage",
  "contact",
  "preview",
  "visual-preview",
  "visual-live",
  "anonymous",
]);
export function scenarioProps(scenario: Scenario) {
  return {
    path:
      scenario === "blog-archive" || scenario === "empty-blog"
        ? "/s/salon-nagi/blogs"
        : scenario === "announcement-archive"
          ? "/s/salon-nagi/announcements"
          : scenario === "blog-article"
            ? `/s/salon-nagi/blogs/${dateJST()}-autumn-design`
            : (scenario === "preview" || scenario === "visual-preview")
              ? "/preview/story-shop"
              : publicScenarios.has(scenario)
                ? "/s/salon-nagi"
                : "/",
    search: (scenario === "preview" || scenario === "visual-preview") ? "?plan=story-plan" : "",
    initialTab:
      (
        {
          manual: "manual",
          system: "system",
          "blog-editor": "blog",
          bookings: "bookings",
          inquiries: "inquiries",
          team: "team",
          data: "data",
          settings: "settings",
          "sync-error": "bookings",
        } as Partial<Record<Scenario, string>>
      )[scenario] || "build",
    initialPane:
      scenario === "mypage"
        ? "mine"
        : scenario === "contact"
          ? "contact"
          : "reserve",
  };
}
export function createMockClient(scenario: Scenario): ApiClient {
  const posts = scenario === "empty-blog" ? [] : storyPosts();
  const config = structuredClone(sample);
  config.hours.closedWeekdays = [];
  config.notificationEmail = "owner@example.com";
  if (scenario === "any-reservation") config.rules.mode = "any";
  const tomorrow = dateJST(new Date(Date.now() + 86400000));
  const bookings: Booking[] = [
    {
      id: "story-reservation",
      shopId: "story-shop",
      customer: "guest@example.com",
      name: "山田 花子",
      menuId: "simple",
      staffId: "aoi",
      start: new Date(`${tomorrow}T10:00:00+09:00`).toISOString(),
      end: new Date(`${tomorrow}T11:00:00+09:00`).toISOString(),
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: "story-cancelled",
      shopId: "story-shop",
      customer: "other@example.com",
      name: "鈴木 さくら",
      menuId: "design",
      staffId: "haru",
      start: new Date(`${tomorrow}T13:00:00+09:00`).toISOString(),
      end: new Date(`${tomorrow}T14:30:00+09:00`).toISOString(),
      status: "cancelled",
      createdAt: new Date().toISOString(),
    },
  ];
  const plan: Plan = {
    id: "story-plan",
    config: structuredClone(config),
    summary: planSummary(null, config),
    base: 0,
    approved: ["approved", "preview", "visual-preview", "publication-error"].includes(scenario),
  };
  const unpublished = ["onboarding", "plan", "approved", "preview", "visual-preview"].includes(
    scenario,
  );
  const shop: Workspace = {
    id: "story-shop",
    owner: "owner@example.com",
    slug: "salon-nagi",
    published: unpublished ? null : config,
    draft: plan.approved ? config : null,
    revision: 0,
    history: unpublished
      ? []
      : [{ at: new Date().toISOString(), summary: "お店の予約ページを公開" }],
    isOwner: true,
    plans: ["plan", "approved", "preview", "visual-preview", "publication-error"].includes(
      scenario,
    )
      ? [plan]
      : [],
    bookings: ["onboarding", "plan", "approved", "preview", "visual-preview"].includes(scenario)
      ? []
      : bookings,
    inquiries: [
      {
        id: "story-inquiry",
        name: "佐藤 みどり",
        email: "midori@example.com",
        message:
          "初めて伺います。ネイルの色を相談してから決めることはできますか？",
        reply: "",
        status: "open",
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
                "スプレッドシートに接続できませんでした。再送をお試しください。",
            },
          ]
        : [],
    publicUrl: "/s/salon-nagi",
    domain: scenario === "settings" ? "reserve.example.com" : undefined,
    domainToken:
      scenario === "settings"
        ? "omaiweb-storybook-verification-token"
        : undefined,
  };
  if (scenario === "publication-error") shop.publishingPlanId = plan.id;
  const customer = publicScenarios.has(scenario) && !["preview", "visual-preview", "visual-live"].includes(scenario);
  const session: Session = {
    demo: false,
    user: [
      "landing",
      "anonymous",
      "blog-archive",
      "blog-article",
      "announcement-archive",
      "empty-blog",
    ].includes(scenario)
      ? null
      : {
          email: customer ? "guest@example.com" : "owner@example.com",
          name: customer ? "山田 花子" : "凪の店主",
          role: customer ? "customer" : "owner",
          shopId: shop.id,
        },
  };
  const interview={fields:{} as Record<string,string>,version:0};
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
    else if (action === `/api/shops/${shop.id}/posts/propose`)
      result = {
        title: String(input.title || "お店からのお便り"),
        excerpt: "メモから作成した下書きです。",
        body: String(input.source || input.instruction),
      };
    else if (action === `/api/shops/${shop.id}/posts/source`)
      result = {
        name: "秋のメモ.md",
        text: "秋色のネイルデザインを紹介します。モカとグレージュを中心に、気軽に相談できます。",
      };
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
        validatePostAddress(post, content, posts);
        posts.unshift(post);
        result = post;
      }
    } else if (action.match(/\/posts\/[^/]+\/(save|publish|unpublish)$/)) {
      const post = posts.find((p) => p.id === action.split("/").at(-2));
      if (!post) throw new Error("記事がありません");
      if (post.version !== input.version)
        throw new Error("記事が更新されています。一覧を更新してください");
      if (action.endsWith("/save")) {
        const content = postContentSchema.parse(input.content);
        validatePostAddress(post, content, posts);
        post.draft = content;
      } else if (action.endsWith("/publish")) {
        if (input.approved !== true) throw new Error("内容を承認してください");
        post.published = structuredClone(post.draft);
        post.publishedAt = new Date().toISOString();
        post.address = postAddress(post.draft);
      } else post.published = null;
      post.version++;
      post.updatedAt = new Date().toISOString();
      result = post;
    } else if (action === `/api/shops/${shop.id}/interview`) {
      if(data!==undefined){if(input.version!==interview.version)throw new Error("会話内容が更新されました");Object.assign(interview.fields,input.fields);interview.version++;}
      result=interview;
    } else if (action === `/api/shops/${shop.id}/interview/plan`) {
      if(input.version!==interview.version)throw new Error("会話内容が更新されました");
      Object.assign(interview.fields,input.fields);interview.version++;
      result={state:interview,text:Object.values(interview.fields).join("\n")};
    } else if (action === `/api/shops/${shop.id}/interview/turn`) {
      interview.fields.changes=String(input.text);interview.version++;
      result={state:interview,question:"（Storybook のサンプル）内容を確認しました。他に変えたいところはありますか？"};
    } else if (action === `/api/shops/${shop.id}/system`) {
      result = {diagram: shopSystem(shop.published || config), svg: systemSvg(shop.published || config), overview: systemSvg(shop.published || config, false), revision: shop.revision};
    } else if (action === `/api/shops/${shop.id}/system/question`) {
      result = {answer: "このお店は指名型です。指定したスタッフの勤務時間と既存の予約を確認して空き枠を表示します。変更する場合は、差分プランを確認・承認して公開してください。", changeRequest: true};
    } else if (action === `/api/shops/${shop.id}/visual/identify`) {
      result = {id: "story-visual", explanation: "Storybook のサンプルでは、店名か紹介文を候補として表示します。", candidates: [{id: "name", label: `店名：${config.name}`}, {id: "description", label: `紹介文：${config.description}`}]};
    } else if (action === `/api/shops/${shop.id}/plan`) {
      const next = input.config
        ? structuredClone(input.config as typeof config)
        : structuredClone(config);
      if (input.visual) {
        const target = (input.visual as {target: string}).target;
        if (target === "name") next.name = "季節のアトリエ";
        else next.description = "季節を楽しむ、小さなネイルサロン。";
      } else if (!input.config && shop.published) {
        next.hours.closedWeekdays = [3];
        next.menus.push({
          id: "special",
          name: "ご褒美ケアコース",
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
      };
      shop.plans.push(generated);
      result = generated;
    } else if (action.startsWith(`/api/shops/${shop.id}/plans/`)) {
      const id = action.split("/").at(-2);
      const current = shop.plans.find((p) => p.id === id);
      if (!current) throw new Error("プランが見つかりません");
      if (action.endsWith("/approve")) {
        current.approved = true;
        shop.draft = current.config;
      } else if (action.endsWith("/publish")) {
        if (!current.approved) throw new Error("先にプランを承認してください");
        shop.published = current.config;
        shop.draft = null;
        shop.history.push({
          at: new Date().toISOString(),
          summary: current.summary.join("、"),
        });
        shop.revision++;
        delete shop.publishingPlanId;
      } else throw new Error("未対応のモック操作");
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/documents`)
      result = documents(shop.published || config, shop.history);
    else if (action === `/api/shops/${shop.id}/invite`) {
      shop.members.push({ email: String(input.email), accepted: false });
      result = { ok: true };
    } else if (action.endsWith("/reply")) {
      const q = shop.inquiries.find((q) => q.id === action.split("/").at(-2));
      if (!q) throw new Error("お問い合わせがありません");
      q.reply = String(input.text);
      q.status = "replied";
      result = { ok: true };
    } else if (action.endsWith("/status")) {
      const b = shop.bookings.find((b) => b.id === action.split("/").at(-2));
      if (!b) throw new Error("予約がありません");
      b.status = input.status as Booking["status"];
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/retry`) {
      shop.jobs = [];
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/domain`) {
      shop.domain = String(input.domain);
      shop.domainToken = "omaiweb-storybook-verification-token";
      shop.domainVerified = false;
      result = { ok: true };
    } else if (action.endsWith("/domain/verify")) {
      shop.domainVerified = true;
      result = { ok: true };
    } else if (
      action.startsWith("/api/public/") ||
      action.startsWith("/api/preview/")
    ) {
      const preview = action.startsWith("/api/preview/");
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
        if (!result) throw new Error("記事がありません");
      } else if (action.endsWith("/slots"))
        result = slots(
          current,
          preview ? [] : shop.bookings,
          url.searchParams.get("date") || "",
          url.searchParams.get("menu") || "",
          url.searchParams.get("staff") || undefined,
        );
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
          String(input.staffId),
        ).find((s) => s.start === start);
        if (!slot)
          throw new Error("この枠は予約できません。別の時間を選んでください。");
        if (!preview)
          shop.bookings.push({
            id: createRequestId(),
            shopId: shop.id,
            customer: "guest@example.com",
            name: String(input.name),
            menuId: String(input.menuId),
            ...slot,
            status: "active",
            createdAt: new Date().toISOString(),
          });
        result = { ok: true };
      } else if (action.endsWith("/cancel")) {
        const b = shop.bookings.find(
          (b) =>
            b.id === action.split("/").at(-2) &&
            b.customer === "guest@example.com",
        );
        if (!b) throw new Error("予約がありません");
        b.status = "cancelled";
        result = { ok: true };
      } else if (action.endsWith("/inquiries")) result = { ok: true };
      else
        result = {
          config: current,
          shopId: shop.id,
          canEdit: ["visual-preview", "visual-live"].includes(scenario),
          preview,
          authUrl: "/auth/google",
          recentPosts: preview
            ? []
            : publicPosts(posts).slice(0, 5).map(summarizePost),
        };
    } else throw new Error(`Storybook に未定義の操作です: ${action}`);
    // Match JSON transport semantics: callers cannot mutate the fixture through returned objects.
    return structuredClone(result) as T;
  };
  return client;
}
