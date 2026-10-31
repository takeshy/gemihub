import { updateLiveValue, type LiveSection } from "../../server/live-settings";
import { fingerprint } from "../editor-sync";
import { scopedSource, scopedConfig, type ReleaseScope } from "../../server/pages";
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
  | "editor-unfetched"
  | "editor-remote"
  | "editor-conflict"
  | "page-builder"
  | "local-editor-pages"
  | "custom-page"
  | "manage-basic"
  | "manage-menus"
  | "manage-staff"
  | "manage-hours"
  | "manage-rules"
  | "local-editor"
  | "local-editor-new"
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
  | "calendar-disconnected"
  | "calendar-connected"
  | "calendar-member"
  | "calendar-missing-staff"
  | "data"
  | "settings"
  | "sync-error"
  | "publication-error"
  | "reservation"
  | "any-reservation"
  | "customer-choice"
  | "mypage"
  | "contact"
  | "preview"
  | "anonymous";
const publicScenarios = new Set<Scenario>([
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
  "preview",
  "visual-preview",
  "visual-live",
  "anonymous",
]);
export function scenarioProps(scenario: Scenario) {
  return {
    path:
      scenario === "custom-page" ? "/s/salon-nagi/pages/faq" : scenario === "blog-archive" || scenario === "empty-blog"
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
    initialTab: scenario === "editor-unfetched" ? undefined :
      (
        {
          manual: "manual",
          system: "build",
          "local-editor": "try",
          "local-editor-pages": "try",
          "editor-unfetched": "try", "editor-remote": "try", "editor-conflict": "try", "page-builder": "create-page",
          "manage-basic": "basic", "manage-menus": "menus", "manage-staff": "staff", "manage-hours": "hours", "manage-rules": "rules",
          "local-editor-new": "try",
          "blog-editor": "blog",
          bookings: "bookings",
          inquiries: "inquiries",
          team: "team",
          "calendar-disconnected": "team",
          "calendar-connected": "team",
          "calendar-member": "team",
          "calendar-missing-staff": "team",
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
  if (["local-editor-pages", "custom-page", "editor-unfetched", "editor-remote", "editor-conflict"].includes(scenario)) config.pages = [
    { id: "faq", slug: "faq", title: "よくある質問", navigationLabel: "よくある質問", body: "## 初めてでも予約できますか？\n\n初めてのお客様も歓迎しています。\n\n## 当日の持ち物は？\n\n特にありません。お気軽にお越しください。", layout: "standard", imageUrl: "" },
    { id: "about-us", slug: "about-us", title: "私たちのお店", navigationLabel: "店舗紹介", body: "## 大切にしていること\n\n一人ひとりに合った時間をご用意します。", layout: "compact", imageUrl: "" },
  ];
  if (["editor-remote", "editor-conflict"].includes(scenario)) config.pages[0].body = "## リモートの変更\n\nリモートで追加された案内です。";
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
  const unpublished = ["local-editor-new", "onboarding", "plan", "approved", "preview", "visual-preview"].includes(
    scenario,
  );
  const shop: Workspace = {
    id: scenario === "local-editor-new" ? "story-new-shop" : "story-shop",
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
  if (scenario === "calendar-member") {
    shop.isOwner = false;
    session.user = { email: "haru@example.com", name: "はる", role: "customer", shopId: shop.id };
  }
  const calendarConnection = {
    connected: ["calendar-connected", "calendar-member", "calendar-missing-staff"].includes(scenario),
    email: session.user?.email || shop.owner,
    staffId: scenario === "calendar-missing-staff" ? "removed-staff" : scenario === "calendar-member" ? "haru" : "aoi",
    configured: scenario.startsWith("calendar-"),
  };
  let visualConfig = structuredClone(config);
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
    else if (action.startsWith(`/api/shops/${shop.id}/live-settings/`)) {
      const section = action.split("/").at(-1) as LiveSection;
      if (data === undefined) result = { config: shop.published || config };
      else { shop.published = updateLiveValue(shop.published || config, section, input.value); shop.revision++; result = { ok: true }; }
    }
    else if (action === `/api/shops/${shop.id}/pages/create-with-ai`) {
      const messages = input.messages as { role: string; text: string }[];
      const ready = input.mode === "write" || messages.filter(m => m.role === "user").length >= 2;
      result = { reply: ready ? "FAQ のページ案ができました。内容を確認してツリーに追加してください。" : "どんな質問や案内を載せたいですか？", page: ready ? { slug: "new-faq", title: "新しいFAQ", navigationLabel: "よくある質問", body: "## 初めてのお客様へ\n\nご予約方法をご案内します。", layout: "standard", imageUrl: "" } : null };
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
      result = { value: scope.kind === "page" ? { ...(remote || local), body: `## AIの結合案\n\n${String(local?.body || "")}\n\n${String(remote?.body || "")}` } : { ...remote, ...local }, explanation: "ローカルとリモートの案内を両方残した結合案です。" };
    }
    else if (action === `/api/shops/${shop.id}/local-editor`) result = { base: shop.revision, source: shop.published, config: shop.published || config, lastPublishedPlanId: shop.lastPublishedPlanId };
    else if (action === `/api/shops/${shop.id}/visual/propose`) {
      const next = structuredClone(visualConfig) as typeof config;
      if (String(input.target).startsWith("page:")) {
        const [, id, field] = String(input.target).split(":");
        const page = next.pages.find(p => p.id === id)!;
        if (field === "body") page.body = "## ペンで変更した内容\n\nローカルのページ本文を更新しました。";
        else page.title = "ペンで変更したページ";
      } else if (input.target === "part:header") next.header.title = "季節を楽しむアトリエ";
      else if (input.target === "part:footer") next.footer.text = "お会いできる日を楽しみにしています。";
      else if (input.target === "name") next.name = "季節のアトリエ";
      else next.description = "季節を楽しむ、小さなネイルサロン。";
      result = { config: next, summary: ["選んだ対象をローカルで変更"] };
    }
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
        if (input.publish) { post.published = structuredClone(content); post.publishedAt = at; post.address = postAddress(content); }
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
        if (input.publish) { post.published = structuredClone(content); post.publishedAt = new Date().toISOString(); post.address = postAddress(content); }
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
    } else if (action === `/api/shops/${shop.id}/build-context`) {
      result = { config: shop.published || shop.draft, published: !!shop.published, history: shop.history, revision: shop.revision, hash: await fingerprint(shop.published || shop.draft) };
    } else if (action === `/api/shops/${shop.id}/system`) {
      result = {diagram: shopSystem(shop.published || config), svg: systemSvg(shop.published || config), overview: systemSvg(shop.published || config, false), revision: shop.revision};
    } else if (action === `/api/shops/${shop.id}/system/question`) {
      const changeRequest = /変更|したい|変え|追加/.test(String(input.question));
      result = {answer: changeRequest ? "水曜日も定休日にする変更ですね。変更プランを作り、内容を確認してから承認・公開してください。" : String(input.question).includes("履歴") ? "変更履歴には「お店の予約ページを公開」が記録されています。現在のメニューや勤務時間は左の仕様で確認できます。" : "お客様が指名・指名なしを選べます。指名時は指定先だけ、指名なしは対応スタッフ全員の勤務時間と既存の予約を確認して空き枠を表示します。", changeRequest};
    } else if (action === `/api/shops/${shop.id}/visual/identify`) {
      visualConfig = structuredClone((input.displayed || config) as typeof config);
      const part = (input.local as { part?: "header" | "footer" } | undefined)?.part;
      if (part) result = { id: "story-visual", explanation: "共通パーツの変更対象を確認してください。", candidates: [{ id: `part:${part}`, label: part === "header" ? "共通ヘッダー" : "共通フッター" }] };
      else if (visualConfig.pages.length && String(input.instruction).includes("ページ")) {
        const pageId = (input.local as { pageId?: string } | undefined)?.pageId;
        const page = visualConfig.pages.find(p => p.id === pageId) || visualConfig.pages.at(-1)!;
        result = { id: "story-visual", explanation: "ページの変更対象を確認してください。", candidates: [{ id: `page:${page.id}:title`, label: `ページ見出し：${page.title}` }, { id: `page:${page.id}:body`, label: `ページ本文：${page.title}` }] };
      } else result = {id: "story-visual", explanation: "Storybook のサンプルでは、店名か紹介文を候補として表示します。", candidates: [{id: "name", label: `店名：${config.name}`}, {id: "description", label: `紹介文：${config.description}`}]};
    } else if (action === `/api/shops/${shop.id}/plan`) {
      let next = input.config
        ? structuredClone(input.config as typeof config)
        : structuredClone(config);
      const local = input.local as { scope?: ReleaseScope } | undefined;
      if (local?.scope) next = scopedConfig(shop.published, next, local.scope);
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
        shop.lastPublishedPlanId = current.id;
        delete shop.publishingPlanId;
      } else throw new Error("未対応のモック操作");
      result = { ok: true };
    } else if (action === `/api/shops/${shop.id}/documents`)
      result = documents(shop.published || config, shop.history);
    else if (action === `/api/shops/${shop.id}/calendar`) {
      result = calendarConnection;
    }
    else if (action === `/api/shops/${shop.id}/calendar/disconnect`) {
      calendarConnection.connected = false;
      calendarConnection.staffId = "";
      result = { ok: true };
    }
    else if (action === `/api/shops/${shop.id}/calendar/connect`) {
      throw new Error("Storybook のサンプルです。実際の Google 認証は行いません。連携後の画面は「Calendar 連携中」で確認できます。");
    }
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
          input.staffId ? String(input.staffId) : undefined,
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
