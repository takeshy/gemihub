import { articleFiles, articleToolContext } from "./article-files.ts";
import { postImageIds, publishedPostImageIds, wikiPaths } from "./post-images.ts";
import { articleInputSchema, articleMetadataSchema, generateArticleMetadata } from "./post-metadata.ts";
import { staffAccounts, staffAccountKey, type StaffAccount, type StaffMember } from "./staff-accounts.ts";
import { inquiryStatus, inquiryStatusSchema } from "./inquiries.ts";
import { conversations, createConversation, readConversation, searchConversationHistory, conversationContext, appendChatMessage, attachChatPlan, conversationInputSchema, chatReferenceSchema, type ChatReference } from "./shop-chat.ts";
import { answeredFinalDetails, finalDetailsQuestion, requestIntentSchema, requestIntentInstruction } from "./request-intent.ts";
import { customerProfileSchema, memberProfile } from "./customer-profile.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { z } from "zod";
import { Store, type Shop, type User } from "./store.ts";
import { aggregateCustomers, customerSummaries, customerFilterSchema, customerSince, customerImages, customerAttachmentSchema, normalizeEmail, type CustomerNote, type Inquiry } from "./customers.ts";
import { googleCustomerFiles, memoryCustomerFiles, type CustomerFiles } from "./customer-files.ts";
import { listDataSheets, readDataTable, writeDataRow } from "./data-management.ts";
import { uploadMenuImage, readMenuImage, validateMenuImages, menuImageSnapshot, type ImageUpload } from "./menu-images.ts";
import { listImages, updateImage, archiveImage, generateLibraryImage } from "./image-library.ts";
import { generateImage } from "./image-generation.ts";
import { managedImageIds } from "./image-references.ts";
import { generateImageSchema, requestImageIdsSchema } from "./image-library-domain.ts";
import { readRequestImages, validateProposedImages, validatePageImage } from "./request-images.ts";
import { addCustomerNote, touchCustomer } from "./customer-notes.ts";
import {
  shopSchema,
  slots,
  sample,
  documents,
  planSummary,
  type ShopConfig,
  type Booking,
} from "./domain.ts";
import {
  oauth,
  encrypt,
  provision,
  syncConfig,
  readConfig,
  sendMail,
  syncPostFiles,
} from "./google.ts";
import {
  session,
  login,
  cookie,
  digest,
  equal,
  checkOrigin,
  origin,
  demoEnabled,
} from "./auth.ts";

import {
  propose,
  proposeArticle,
  identifyVisual,
  explainSystem,
} from "./ai.ts";
import { shopSystem, systemSvg } from "./shop-system.ts";
import {
  mediaSchema,
  visualTargets,
  validateVisualChange,
  type VisualRequest,
} from "./visual.ts";
import { artifacts, checklist, renderShop } from "./artifacts.ts";
import {
  postContentSchema,
  postCategorySchema,
  postLabel,
  postAddress,
  postKey,
  validatePostAddress,
  uniquePostSlug,
  publicPosts,
  summarizePost,
  type Post,
} from "./post-domain.ts";
import {
  renderArticle,
  renderArchive,
  renderHomeWithPosts,
} from "./post-renderer.tsx";
import { liveValue, updateLiveValue, type LiveSection } from "./live-settings.ts";
import { editorIndex, contentHash } from "./editor-sync.ts";
import { createPageWithAI, mergePageWithAI, messageSchema, profileSchema } from "./page-ai.ts";
import { pageSchema, headerSchema, footerSchema } from "./pages.ts";
import { renderCustomPage } from "./page-renderer.tsx";
import { releaseScopeSchema, scopedSource, scopedConfig, same, type ReleaseScope } from "./pages.ts";
import { calendarGateway, calendarScope, connections, availableSlots, type CalendarConnection, type CalendarGateway } from "./calendar.ts";
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
const emailSchema = z.email().transform((s) => s.toLowerCase());
type Plan = {
  id: string;
  shopId: string;
  base: number;
  config: ShopConfig;
  summary: string[];
  approved: boolean;
  requiresSetup?: boolean;
  chat?: ChatReference;
  local?: boolean;
  scope?: ReleaseScope;
  createdAt: number;
  checklist: string[];
  source?: ShopConfig | null;
};
type Job = {
  id: string;
  shopId: string;
  type: "mail" | "posts";
  to?: string;
  subject?: string;
  body?: string;
  error?: string;
  attempts: number;
};
async function body(req: IncomingMessage, limit = 65536) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "入力が長すぎます");
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return fail(400, "入力形式が不正です");
  }
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function redirect(res: ServerResponse, to: string) {
  res.writeHead(302, { Location: to });
  res.end();
}
export function createApp(
  store = new Store(),
  intelligence: {
    propose: typeof propose;
    proposeArticle: typeof proposeArticle;
    identifyVisual: typeof identifyVisual;
    explainSystem: typeof explainSystem;
    createPage?: typeof createPageWithAI;
    mergePage?: typeof mergePageWithAI;
    generateImage?: typeof generateImage;
    articleMetadata?: typeof generateArticleMetadata;
  } = { propose, proposeArticle, identifyVisual, explainSystem },
  calendar: CalendarGateway = calendarGateway,
  customerFiles?: CustomerFiles,
) {
  const crmFiles = customerFiles || (store.memory ? memoryCustomerFiles(store) : googleCustomerFiles);
  const ownerToken = async (shop: Shop) =>
    (await store.get<User>("user", shop.owner))?.refreshToken;
  const operator = async (user: User | undefined, shop: Shop) => {
    if (!user) return false;
    if (user.email === shop.owner) return true;
    const member = await store.get<StaffMember>("member", `${shop.id}:${user.email}`);
    return member?.accepted === true && member.status !== "revoked";
  };
  const assertOperator = async (user: User | undefined, shop: Shop) => {
    if (!(await operator(user, shop)))
      fail(403, "運営メンバーのみ利用できます");
  };
  const assertOwner = (user: User | undefined, shop: Shop) => {
    if (user?.email !== shop.owner) fail(403, "店主のみ利用できます");
  };
  const inquiries = (shop: Shop) => store.records<Inquiry>("inquiry", shop);
  const postsFor = (shop: Shop) => store.records<Post>("post", shop);
  const effective = async (shop: Shop) => {
    if (shop.publishingPlanId)
      fail(503, "予約ページを更新中です。しばらくしてからお試しください。");
    return shop.google
      ? readConfig(
          shop,
          (await ownerToken(shop)) ||
            fail(503, "店主の Google 再接続が必要です"),
        )
      : shop.published!;
  };
  async function enqueue(
    shop: Shop,
    type: Job["type"],
    data: Partial<Job> = {},
    id: string = randomUUID(),
  ) {
    if (!shop.google) return;
    if(await store.get("job",id))return;
    await store.put("job", id, {
      id,
      shopId: shop.id,
      type,
      attempts: 0,
      ...data,
    });
  }
  async function flush(shop: Shop) {
    if (!shop.google) return;
    const token = await ownerToken(shop);
    if (!token) return;
    for (const job of (await store.list<Job>("job")).filter(
      (j) => j.shopId === shop.id,
    )) {
      try {
        if (job.type === "posts") {
          const posts=await postsFor(shop);
          await syncPostFiles(shop,posts,token,async()=>await store.saveShop(shop),config=>menuImageSnapshot(store,shop,config,crmFiles,token,publishedPostImageIds(posts)));
        } else await sendMail(token, job.to!, job.subject!, job.body!);
        await store.delete("job", job.id);
      } catch (err) {
        job.error = err instanceof Error ? err.message : "連携エラー";
        job.attempts++;
        await store.put("job", job.id, job);
      }
    }
  }
  async function notify(
    shop: Shop,
    config: ShopConfig,
    to: string,
    subject: string,
    text: string,
  ) {
    for (const address of new Set([to, config.notificationEmail]))
      await enqueue(shop, "mail", { to: address, subject, body: text });
  }
  async function publishConfiguration(fresh: Shop, plan: Plan, publication = fresh.publication || (fresh.published ? "public" : "provisional")) {
    if (fresh.lastPublishedPlanId === plan.id) return { ok: true, url: `/s/${fresh.slug}` };
    if (plan.base !== fresh.revision) fail(409, "本番の内容が変わりました。最新の内容を読み直してください");
    if (!plan.approved) fail(409, "先にプランを承認してください");
    if (
      fresh.google &&
      !fresh.publishingPlanId &&
      JSON.stringify(plan.source) !==
        JSON.stringify(await effective(fresh))
    )
      fail(
        409,
        "スプレッドシートの設定が更新されています。最新の内容でプランを作り直してください",
      );
    if (fresh.publishingPlanId && fresh.publishingPlanId !== plan.id)
      fail(409, "公開中のプランを先に完了してください");
    await validateMenuImages(store, fresh, plan.config);
    const history = [
      ...fresh.history,
      {
        at: new Date().toISOString(),
        summary: plan.summary.join("、"),
      },
    ];
    if (!demoEnabled() || (await ownerToken(fresh))) {
      const token =
        (await ownerToken(fresh)) ||
        fail(503, "店主の Google 再接続が必要です");
      fresh.publishingPlanId = plan.id;
      await store.saveShop(fresh);
      try {
        fresh.google = await provision(fresh, plan.config, token);
        await store.saveShop(fresh);
        await syncConfig(
          { ...fresh, history },
          plan.config,
          token,
          async () => await store.saveShop(fresh),
          plan.scope,
          await menuImageSnapshot(store, fresh, plan.config, crmFiles, token),
        );
      } catch (error) {
        fresh.publishingError =
          error instanceof Error ? error.message : "Google 連携エラー";
        await store.saveShop(fresh);
        console.error(error);
        fail(
          503,
          "保存・反映を完了できませんでした。同じ画面から再試行してください。処理中は予約受付を停止しています。",
        );
      }
      delete fresh.publishingPlanId;
      delete fresh.publishingError;
    }
    fresh.published = plan.config;
    fresh.publication = publication;
    fresh.draft = null;
    fresh.history = history;
    fresh.revision++;
    fresh.lastPublishedPlanId = plan.id;
    await store.saveShop(fresh);
    if (!plan.scope || plan.scope.kind === "shared") await enqueue(fresh, "posts");
    await flush(fresh);
    return { ok: true, url: `/s/${fresh.slug}` };
  }
  const rate = new Map<
    string,
    {
      n: number;
      until: number;
    }
  >();
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url || "/", origin());
      const path = url.pathname;
      const method = req.method || "GET";
      const host = (req.headers.host || "").split(":")[0].toLowerCase();
      const appHost = new URL(origin()).hostname;
      const allShops = await store.list<Shop>("shop");
      const hosted =
        host !== appHost
          ? allShops.find(
              (s) =>
                s.published &&
                ((s.domainVerified && s.domain === host) ||
                  (process.env.SITE_DOMAIN &&
                    host === `${s.slug}.${process.env.SITE_DOMAIN}`)),
            )
          : undefined;
      if (host !== appHost && !hosted) fail(404, "お店が見つかりません");
      const publicHost = !!hosted;
      const s = await session(store, req);
      const user = s?.user;
      const assertStorefrontAccess = (shop: Shop) => {
        if (shop.publication === "provisional" && user?.email !== shop.owner)
          fail(user ? 403 : 401, "仮公開中のため、このページを用意したユーザーのログインが必要です");
        if (shop.publication === "provisional") {
          res.setHeader("Vary", "Cookie");
          res.setHeader("X-Robots-Tag", "noindex, nofollow");
        }
      };
      if (method !== "GET" && method !== "HEAD") {
        if (req.headers.origin !== (publicHost ? `https://${host}` : origin()))
          checkOrigin(req);
        const key = `${req.socket.remoteAddress}:${path}`;
        const current = rate.get(key);
        const entry =
          current && current.until > Date.now()
            ? current
            : { n: 0, until: Date.now() + 60000 };
        if (++entry.n > 60) fail(429, "少し時間をおいてお試しください");
        rate.set(key, entry);
        if (rate.size > 10000)
          for (const [k, v] of rate) if (v.until < Date.now()) rate.delete(k);
      }
      if (path === "/api/session" && method === "GET")
        return json(res, {
          user: user
            ? {
                email: user.email,
                name: user.name,
                role: user.role,
                shopId: user.shopId,
              }
            : null,
          demo: demoEnabled(),
          hosted: hosted?.slug,
        });
      if (path === "/api/logout" && method === "POST") {
        const id = cookie(req, "omai_session");
        if (id) await store.delete("session", digest(id));
        res.setHeader(
          "Set-Cookie",
          "omai_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        );
        return json(res, { ok: true });
      }
      if (path === "/auth/complete" && method === "GET") {
        const key = digest(url.searchParams.get("ticket") || "");
        const ticket = await store.take<{
          user: User;
          host: string;
          expires: number;
          slug: string;
        }>("ticket", key);
        if (!ticket || ticket.host !== host || ticket.expires < Date.now())
          fail(400, "ログインの有効期限が切れました");
        await login(store, res, ticket.user);
        return redirect(res, publicHost ? "/" : `/s/${ticket.slug}`);
      }
      const staffLogin = path.match(/^\/api\/staff-login\/([^/]+)$/);
      if (staffLogin && method === "GET" && !publicHost) {
        const shop = allShops.find(s => s.id === staffLogin[1] && s.published) || fail(404, "お店がありません");
        return json(res, { name: shop.published!.name, configured: !!process.env.GOOGLE_CLIENT_ID });
      }
      if (path === "/auth/google" && method === "GET" && !publicHost) {
        if (!process.env.GOOGLE_CLIENT_ID)
          fail(
            503,
            "Google ログインはサーバーで設定してください。ローカル確認にはデモモードを利用できます。",
          );
        const staffShopId = url.searchParams.get("staffShop");
        if (staffShopId) {
          const shop = allShops.find(s => s.id === staffShopId && s.published) || fail(404, "お店がありません");
          const state = randomBytes(32).toString("base64url");
          const verifier = randomBytes(48).toString("base64url");
          await store.put("oauth", digest(state), { verifier, staffShopId: shop.id, expires: Date.now() + 600000 });
          res.setHeader("Set-Cookie", `omai_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`);
          return redirect(res, oauth().generateAuthUrl({ access_type: "offline", prompt: "consent select_account", scope: ["openid", "email", "profile", calendarScope], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" as never }));
        }
        const slug = url.searchParams.get("shop");
        const shop = slug
          ? allShops.find((s) => s.slug === slug && s.published)
          : undefined;
        if (slug && !shop) fail(404, "公開されたお店がありません");
        let returnHost = appHost;
        const target = url.searchParams.get("host");
        if (target) {
          if (
            !shop ||
            !(
              (shop.domainVerified && shop.domain === target) ||
              (process.env.SITE_DOMAIN &&
                target === `${shop.slug}.${process.env.SITE_DOMAIN}`)
            )
          )
            fail(400, "戻り先が不正です");
          returnHost = target;
        }
        const state = randomBytes(32).toString("base64url");
        const verifier = randomBytes(48).toString("base64url");
        await store.put("oauth", digest(state), {
          verifier,
          shopId: shop?.id,
          returnHost,
          expires: Date.now() + 600000,
        });
        res.setHeader(
          "Set-Cookie",
          `omai_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`,
        );
        return redirect(
          res,
          oauth().generateAuthUrl({
            access_type: "offline",
            prompt: shop ? "select_account" : "consent",
            scope: shop
              ? ["openid", "email", "profile"]
              : [
                  "openid",
                  "email",
                  "profile",
                  "https://www.googleapis.com/auth/drive.file",
                  "https://www.googleapis.com/auth/gmail.send",
                ],
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256" as never,
          }),
        );
      }
      if (path === "/auth/google/callback" && method === "GET" && !publicHost) {
        const state = url.searchParams.get("state") || "";
        if (!state || !equal(state, cookie(req, "omai_oauth") || ""))
          fail(400, "ログインを最初からやり直してください");
        const key = digest(state);
        const pending = await store.take<{
          verifier: string;
          shopId?: string;
          returnHost: string;
          expires: number;
          staffShopId?: string;
          calendarShopId?: string;
          email?: string;
          staffId?: string;
        }>("oauth", key);
        if (!pending || pending.expires < Date.now())
          fail(400, "ログインの有効期限が切れました");
        if (url.searchParams.has("error")) fail(400, "Google ログインとカレンダーの利用許可を完了してください。スタッフ用ログインからやり直せます。");
        if (pending.staffShopId) {
          const identity = await calendar.exchange(url.searchParams.get("code") || "", pending.verifier);
          return await store.locked(pending.staffShopId, async () => {
            const shop = await store.shop(pending.staffShopId!) || fail(404, "お店がありません");
            const key = staffAccountKey(shop.id, identity.email);
            const account = (await staffAccounts(store, shop)).find(account => account.email === identity.email) || fail(403, "このGoogleアカウントはスタッフに登録されていません。店主にメールアドレスの登録を依頼してください。");
            const config = await effective(shop);
            if (!config?.staff.some(staff => staff.id === account.staffId)) fail(403, "担当スタッフが削除されています。店主に確認してください。");
            if ((await connections(store, shop)).some(connection => connection.staffId === account.staffId && connection.email !== identity.email)) fail(409, "この担当スタッフは別のアカウントと連携されています。");
            await store.put("calendar", key, { shopId: shop.id, email: identity.email, staffId: account.staffId, refreshToken: identity.refreshToken });
            if (identity.email !== shop.owner) {
              const member = await store.get<StaffMember>("member", key) || fail(403, "スタッフの登録がありません");
              await store.put("member", key, { ...member, accepted: true, status: "accepted", acceptedAt: member.acceptedAt || new Date().toISOString() });
            }
            await login(store, res, { email: identity.email, name: identity.name || config.staff.find(staff => staff.id === account.staffId)!.name, role: identity.email === shop.owner ? "owner" : "customer", shopId: shop.id });
            return redirect(res, `/?shop=${encodeURIComponent(shop.id)}&tab=bookings&staffLogin=connected`);
          });
        }
        if (pending.calendarShopId) {
          if (!user || user.email !== pending.email) fail(403, "連携を開始したアカウントでログインしてください");
          return await store.locked(pending.calendarShopId, async () => {
            const shop = await store.shop(pending.calendarShopId!) || fail(404, "お店がありません");
            await assertOperator(user, shop);
            const config = await effective(shop);
            if (!config?.staff.some(s => s.id === pending.staffId)) fail(400, "担当者を選び直してください");
            const identity = await calendar.exchange(url.searchParams.get("code") || "", pending.verifier);
            if (identity.email !== pending.email) fail(403, "ログイン中と同じ Google アカウントを選択してください");
            if ((await connections(store, shop)).some(c => c.staffId === pending.staffId && c.email !== user.email)) fail(409, "この担当者は別のメンバーが連携済みです");
            await store.put("calendar", `${shop.id}:${user.email}`, { shopId: shop.id, email: user.email, staffId: pending.staffId, refreshToken: identity.refreshToken });
            return redirect(res, "/?calendar=connected");
          });
        }
        const auth = oauth();
        const { tokens } = await auth.getToken({
          code: url.searchParams.get("code") || "",
          codeVerifier: pending.verifier,
        });
        const identity = await auth.verifyIdToken({
          idToken: tokens.id_token!,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const profile = identity.getPayload();
        if (!profile?.email_verified || !profile.email)
          fail(403, "確認済みの Google アカウントが必要です");
        const email = profile.email.toLowerCase();
        const existing = await store.get<User>("user", email);
        const u: User = {
          email,
          name: profile.name || email,
          role: pending.shopId ? "customer" : "owner",
          shopId: pending.shopId,
        };
        if (!pending.shopId) {
          const own =
            allShops.find((s) => s.owner === email) ||
            (await store.createShop(email));
          u.shopId = own.id;
          u.refreshToken = tokens.refresh_token
            ? encrypt(tokens.refresh_token)
            : existing?.refreshToken;
          if (!u.refreshToken)
            fail(400, "Google のアクセス権を再承認してください");
          await store.put("user", email, u);
        }
        if (pending.returnHost !== appHost) {
          const ticket = randomBytes(32).toString("base64url");
          await store.put("ticket", digest(ticket), {
            user: u,
            host: pending.returnHost,
            slug: (await store.shop(pending.shopId!))!.slug,
            expires: Date.now() + 60000,
          });
          return redirect(
            res,
            `https://${pending.returnHost}/auth/complete?ticket=${ticket}`,
          );
        }
        await login(store, res, u);
        return redirect(
          res,
          pending.shopId
            ? `/s/${(await store.shop(pending.shopId))!.slug}`
            : "/",
        );
      }
      if (path === "/api/demo-login" && method === "POST" && !publicHost) {
        if (!demoEnabled()) fail(404, "見つかりません");
        const input = z
          .object({
            role: z.enum(["owner", "customer"]),
            shopId: z.string().optional(),
            email: emailSchema.optional(),
          })
          .parse(await body(req));
        const email = input.email || `${input.role}@example.com`;
        let shop = input.shopId ? await store.shop(input.shopId) : undefined;
        if (input.role === "owner") {
          shop =
            allShops.find((s) => s.owner === email) ||
            (await store.createShop(email));
        }
        if (!shop) fail(404, "お店がありません");
        const u: User = {
          email,
          name: input.role === "owner" ? "デモ店主" : "デモのお客様",
          role: input.role,
          shopId: shop.id,
        };
        if (input.role === "owner") await store.put("user", email, u);
        else if (!await store.get("customer", `${shop.id}:${email}`)) await store.put("customer", `${shop.id}:${email}`, {
          shopId: shop.id, email, name: u.name, birthDate: "1990-01-01", gender: "not_specified", updatedBy: email, updatedAt: new Date().toISOString(),
        });
        await login(store, res, u);
        return json(res, { ok: true });
      }
      if (path === "/api/workspace" && method === "GET" && !publicHost) {
        if (!user) fail(401, "Google アカウントでログインしてください");
        const shops = [];
        for (const shop of allShops)
          if (await operator(user, shop)) shops.push(shop);
        return json(res, {
          shops: await Promise.all(
            shops.map(async (shop) => ({
              ...shop,
              isOwner: user.email === shop.owner,
              bookings: await store.bookings(shop.id),
              inquiries: await inquiries(shop),
              plans: (await store.list<Plan>("plan"))
                .filter((p) => p.shopId === shop.id)
                .sort((a, b) => a.createdAt - b.createdAt),
              members: await store.records<{
                shopId: string;
                email: string;
                accepted: boolean;
              }>("member", shop),
              jobs: (await store.list<Job>("job"))
                .filter((j) => j.shopId === shop.id)
                .map((j) => ({
                  type: j.type,
                  error: j.error,
                  attempts: j.attempts,
                })),
              publicUrl: shop.domainVerified
                ? `https://${shop.domain}`
                : process.env.SITE_DOMAIN
                  ? `https://${shop.slug}.${process.env.SITE_DOMAIN}`
                  : `/s/${shop.slug}`,
            })),
          ),
        });
      }
      if (path === "/api/invitations" && method === "GET" && !publicHost) {
        if (!user) fail(401, "ログインしてください");
        const invites = (
          await store.list<{
            shopId: string;
            email: string;
            accepted: boolean;
            status?: string;
          }>("member")
        ).filter(
          (m) =>
            m.email === user.email && !m.accepted && m.status !== "revoked" && m.status !== "registered",
        );
        return json(
          res,
          await Promise.all(
            invites.map(async (m) => ({
              shopId: m.shopId,
              name: (await store.shop(m.shopId))?.published?.name,
            })),
          ),
        );
      }
      const accept = path.match(/^\/api\/invitations\/([^/]+)\/accept$/);
      if (accept && method === "POST" && !publicHost) {
        if (!user) fail(401, "ログインしてください");
        return await store.locked(accept[1], async () => {
          const m = await store.get<{
            shopId: string;
            email: string;
            accepted: boolean;
            status?: string;
            acceptedAt?: string;
          }>("member", `${accept[1]}:${user.email}`);
          if (!m || m.status === "revoked" || m.status === "registered")
            fail(403, "このアカウントへの招待はありません");
          m.accepted = true;
          m.status = "accepted";
          m.acceptedAt = new Date().toISOString();
          await store.put("member", `${m.shopId}:${m.email}`, m);
          return json(res, { ok: true });
        });
      }
      const ownerRoute = path.match(/^\/api\/shops\/([^/]+)(?:\/(.*))?$/);
      if (ownerRoute && !publicHost) {
        const shop =
          (await store.shop(ownerRoute[1])) || fail(404, "お店がありません");
        await assertOperator(user, shop);
        const action = ownerRoute[2] || "";
        if (action === "images/generate" && method === "POST") {
          assertOwner(user, shop);
          const input = generateImageSchema.parse(await body(req, 20000));
          // Image generation can take minutes; do not hold the booking/configuration lock.
          return await store.locked(`image-generation:${shop.id}:${input.requestId}`, async () => {
            const fresh = await store.locked(shop.id, async () => {
              const current = (await store.shop(shop.id))!; assertOwner(user, current);
              if (!store.memory && !current.google) { const token = await ownerToken(current) || fail(503, "店主の Google 再接続が必要です"); current.google = await provision(current, current.draft || sample, token); await store.saveShop(current); }
              return current;
            });
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
            return json(res, await generateLibraryImage(store, fresh, input, crmFiles, token, intelligence.generateImage || generateImage));
          });
        }
        if (action === "posts/files" && method === "GET") {
          assertOwner(user,shop);
          return json(res,(await articleFiles(store,shop,await effective(shop))).files);
        }
        if (action === "posts/propose" && method === "POST") {
          assertOwner(user,shop);
          const input=z.object({instruction:z.string().trim().min(1).max(10000),source:z.string().max(20000).default(""),title:z.string().max(160).default(""),requestId:z.uuid().default(()=>randomUUID()),conversationId:z.string().regex(/^[a-f0-9]{64}$/).optional()}).parse(await body(req));
          const id=digest(`${shop.id}:${user!.email}:article:${input.requestId}`);
          return await store.locked(`article:${id}`,async()=>{
            const hash=digest(JSON.stringify(input));
            const previousRequest=await store.get<{hash:string}>("articleRequest",id);
            if(previousRequest&&previousRequest.hash!==hash)fail(409,"記事の依頼が変わっています。新しい依頼として送信してください");
            if(!previousRequest)await store.put("articleRequest",id,{hash});
            const prepared=await store.locked(shop.id,async()=>{
              const fresh=(await store.shop(shop.id))!;assertOwner(user,fresh);
              const config=await effective(fresh);
              const chat=input.conversationId?await readConversation(store,fresh,user!.email,input.conversationId):await createConversation(store,fresh,user!.email,"consult",input.requestId);
              await appendChatMessage(store,fresh,chat,{role:"user",text:input.instruction,requestId:input.requestId});
              const previous=chat.messages.find(message=>message.role==="assistant"&&message.requestId===input.requestId)?.detail.article;
              return {fresh,config,chat,previous};
            });
            if(prepared.previous)return json(res,{...prepared.previous,conversationId:prepared.chat.id});
            const context=await articleToolContext(store,prepared.fresh,prepared.config,wikiPaths(input.instruction),crmFiles,store.memory?"":await ownerToken(prepared.fresh)||fail(503,"店主のGoogle再接続が必要です"));
            const result=await intelligence.proposeArticle(input.instruction,input.source,input.title,demoEnabled()&&!process.env.GOOGLE_CLOUD_PROJECT,{...context,messages:conversationContext(prepared.chat)});
            const parsed=z.object({title:z.string().min(1).max(160),excerpt:z.string().max(300),body:z.string().min(1).max(20000)}).parse(result);
            for(const imageId of postImageIds(parsed.body))if(!context.files.some(file=>file.imageId===imageId))fail(400,"参照できない画像が記事に含まれています");
            await store.locked(shop.id,async()=>{
              const fresh=(await store.shop(shop.id))!;assertOwner(user,fresh);
              await appendChatMessage(store,fresh,prepared.chat,{role:"assistant",text:`${parsed.title}\n\n${parsed.body}`.slice(0,12000),requestId:input.requestId,detail:{article:parsed}});
            });
            return json(res,{...parsed,conversationId:prepared.chat.id});
          });
        }
        if (action === "posts/metadata" && method === "POST") {
          assertOwner(user,shop);
          const input = z.object({content:articleInputSchema,requestId:z.uuid(),postId:z.string().optional(),version:z.number().int().positive().optional()}).parse(await body(req));
          const id=digest(`${shop.id}:${user!.email}:post-metadata:${input.requestId}`);
          return await store.locked(`post-metadata:${id}`,async()=>{
            const existing=await store.locked(shop.id,async()=>{
              const fresh=(await store.shop(shop.id))!;assertOwner(user,fresh);
              if(!input.postId)return undefined;
              const post=(await postsFor(fresh)).find(post=>post.id===input.postId)||fail(404,"記事がありません");
              if(post.version!==input.version)fail(409,"記事が更新されています。一覧から記事を開き直してください");
              return post;
            });
            const hash=digest(JSON.stringify(input));
            const cached=await store.get<{hash:string;metadata:z.infer<typeof articleMetadataSchema>}>("postMetadata",id);
            if(cached){if(cached.hash!==hash)fail(409,"記事の内容が変わっています。もう一度保存してください");return json(res,cached.metadata);}
            const generated=articleMetadataSchema.parse(await (intelligence.articleMetadata||generateArticleMetadata)(input.content,demoEnabled()&&!process.env.GOOGLE_CLOUD_PROJECT));
            const metadata={...generated,slug:existing?.address?.slug||existing?.draft.slug||generated.slug};
            await store.put("postMetadata",id,{hash,metadata});return json(res,metadata);
          });
        }
        return await store.locked(shop.id, async () => {
          const fresh = (await store.shop(shop.id))!;
          await assertOperator(user, fresh);
          const libraryRoute = action.match(/^images(?:\/([a-f0-9]{64})(?:\/(rename|archive))?)?$/);
          if (libraryRoute && (method === "GET" || method === "POST")) {
            assertOwner(user, fresh);
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
            if (action === "images" && method === "GET") return json(res, await listImages(store, fresh, fresh.published ? await effective(fresh) : fresh.draft));
            if (method === "POST" && action === "images") {
              const input = await body(req, 8 * 1024 * 1024);
              if (!store.memory && !fresh.google) { fresh.google = await provision(fresh, fresh.draft || sample, token); await store.saveShop(fresh); }
              return json(res, await uploadMenuImage(store, fresh, input, crmFiles, token));
            }
            if (libraryRoute[1] && method === "GET" && !libraryRoute[2]) return json(res, await readMenuImage(store, fresh, libraryRoute[1], crmFiles, token));
            if (libraryRoute[1] && method === "POST" && libraryRoute[2]) {
              if (libraryRoute[2] === "rename") await updateImage(store, fresh, libraryRoute[1], await body(req, 2000), crmFiles, token);
              else await archiveImage(store, fresh, libraryRoute[1], fresh.published ? await effective(fresh) : fresh.draft);
              return json(res, { ok: true });
            }
          }
          const dataSheet = action.match(/^data\/sheets(?:\/(\d+)(?:\/rows\/(\d+))?)?$/);
          if (dataSheet && (method === "GET" || method === "POST")) {
            assertOwner(user, fresh);
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
            if (!dataSheet[1] && method === "GET") return json(res, await listDataSheets(store, fresh, token));
            if (dataSheet[1] && !dataSheet[2] && method === "GET") return json(res, await readDataTable(store, fresh, dataSheet[1], token));
            if (dataSheet[1] && dataSheet[2] && method === "POST") {
              await writeDataRow(store, fresh, dataSheet[1], Number(dataSheet[2]), await body(req, 16 * 1024 * 1024), token);
              return json(res, { ok: true });
            }
          }
          if (action === "menu-images" && method === "POST") {
            assertOwner(user, fresh);
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
            const input = await body(req, 8 * 1024 * 1024);
            if (!store.memory && !fresh.google) { fresh.google = await provision(fresh, fresh.draft || sample, token); await store.saveShop(fresh); }
            return json(res, await uploadMenuImage(store, fresh, input, crmFiles, token));
          }
          const menuImage = action.match(/^menu-images\/([a-f0-9]{64})$/);
          if (menuImage && method === "GET") {
            assertOwner(user, fresh);
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
            return json(res, await readMenuImage(store, fresh, menuImage[1], crmFiles, token));
          }
          const staffPhotoRoute = action.match(/^staff-photo(?:\/images(?:\/([a-f0-9]{64}))?)?$/);
          if (staffPhotoRoute && (method === "GET" || method === "POST")) {
            const assigned = (await staffAccounts(store, fresh)).find(account => account.email === user!.email) || fail(403, "担当スタッフの登録がありません");
            const current = await effective(fresh);
            const staff = current.staff.find(staff => staff.id === assigned.staffId) || fail(403, "担当スタッフが削除されています");
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
            const choices = (await listImages(store, fresh, current)).filter(image => image.id === staff.imageId);
            for (const image of await store.entries<ImageUpload>("menuImageUpload")) {
              if (image.value.shopId === fresh.id && image.value.uploadedBy === user!.email && image.value.complete && !image.value.archived && !choices.some(choice => choice.id === image.id)) {
                choices.push({id:image.id,name:image.value.name || "スタッフ写真",mimeType:image.value.mimeType,size:image.value.size,createdAt:image.value.createdAt || "",source:"upload",usedBy:[]});
              }
            }
            if (action === "staff-photo" && method === "GET") return json(res, { staffId: staff.id, name: staff.name, imageId: staff.imageId });
            if (action === "staff-photo/images" && method === "GET") return json(res, choices);
            if (staffPhotoRoute[1] && method === "GET") {
              if (!choices.some(image => image.id === staffPhotoRoute[1])) fail(404, "画像がありません");
              return json(res, await readMenuImage(store, fresh, staffPhotoRoute[1], crmFiles, token));
            }
            if (action === "staff-photo/images" && method === "POST") return json(res, await uploadMenuImage(store, fresh, await body(req, 8*1024*1024), crmFiles, token, user!.email));
            if (action === "staff-photo" && method === "POST") {
              const input = z.object({imageId:z.string().regex(/^[a-f0-9]{64}$/).optional(),previousImageId:z.string().default(""),requestId:z.uuid()}).parse(await body(req));
              if (input.imageId && !choices.some(image => image.id === input.imageId)) fail(403, "自分の写真を選択してください");
              const id = digest(`${fresh.id}:${user!.email}:staff-photo:${input.requestId}`);
              let plan = await store.get<Plan>("plan",id);
              if (plan) {
                if (plan.config.staff.find(person=>person.id===staff.id)?.imageId !== input.imageId) fail(409, "保存する写真が変わっています");
              } else {
                if ((staff.imageId || "") !== input.previousImageId) fail(409, "写真が更新されています。最新の状態を確認してください");
                if (staff.imageId === input.imageId) return json(res,{ok:true});
                const config = shopSchema.parse({...current,staff:current.staff.map(person=>person.id===staff.id?{...person,imageId:input.imageId}:person)});
                plan = {id,shopId:fresh.id,base:fresh.revision,source:current,config,approved:true,local:true,createdAt:Date.now(),summary:[`${staff.name}のスタッフ写真を更新`],checklist};
                await store.put("plan",id,plan);
              }
              return json(res, await publishConfiguration(fresh,plan));
            }
            fail(404, "見つかりません");
          }
          const liveSettings = action.match(/^live-settings\/(basic|menus|staff|hours|rules)$/);
          if (liveSettings && (method === "GET" || method === "POST")) {
            assertOwner(user, fresh);
            const section = liveSettings[1] as LiveSection;
            if (method === "GET") {
              if (!fresh.published) fail(409, "先にお店の共通設定を反映してください");
              return json(res, { config: await effective(fresh) });
            }
            const input = z.object({ value: z.unknown(), previous: z.unknown(), requestId: z.uuid() }).parse(await body(req));
            const id = digest(`${fresh.id}:${user!.email}:settings:${section}:${input.requestId}`);
            let plan = await store.get<Plan>("plan", id);
            if (plan) {
              if (!same(liveValue(plan.config, section), input.value)) fail(409, "保存する内容を確認し直してください");
            } else {
              if (!fresh.published) fail(409, "先にお店の共通設定を反映してください");
              const current = await effective(fresh);
              if (!same(liveValue(current, section), input.previous)) fail(409, "別の操作で更新されました。最新の内容を読み直してください。編集内容はこの画面に残っています");
              const config = updateLiveValue(current, section, input.value);
              plan = { id, shopId: fresh.id, base: fresh.revision, config, source: current, summary: planSummary(current, config), approved: true, local: true, createdAt: Date.now(), checklist };
              if (!plan.summary.length) return json(res, { ok: true });
              await store.put("plan", id, plan);
            }
            return json(res, await publishConfiguration(fresh, plan));
          }
          if (action === "pages/create-with-ai" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ messages: z.array(messageSchema).min(1).max(40), mode: z.enum(["chat", "write"]), imageIds: requestImageIdsSchema.default([]) }).parse(await body(req, 500000));
            const config = fresh.published ? await effective(fresh) : fresh.draft || sample;
            const { name, industry, description, address } = config;
            const images = await readRequestImages(store, fresh, input.imageIds, crmFiles, store.memory || !input.imageIds.length ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です"));
            const result = await (intelligence.createPage || createPageWithAI)(input.messages, { name, industry, description, address }, input.mode, images);
            validatePageImage(result.page, images);
            return json(res, z.object({ reply: z.string().min(1).max(4000), page: pageSchema.omit({ id: true }).nullable() }).parse(result));
          }
          if (action.startsWith("local-editor/") && method === "GET") {
            assertOwner(user, fresh);
            const current = fresh.published ? await effective(fresh) : null;
            if (action === "local-editor/index") return json(res, editorIndex(current, fresh.revision, fresh.lastPublishedPlanId));
            if (action === "local-editor/shared") {
              const config = { ...(current || fresh.draft || { ...structuredClone(sample), notificationEmail: user!.email }), pages: [] };
              return json(res, { base: fresh.revision, source: current ? { ...current, pages: [] } : null, config, lastPublishedPlanId: fresh.lastPublishedPlanId });
            }
            const page = action.match(/^local-editor\/pages\/([a-z0-9_-]+)$/);
            if (page) return json(res, { base: fresh.revision, page: current?.pages.find(p => p.id === page[1]) || null });
          }
          if (action === "local-editor/merge" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ scope: releaseScopeSchema, baseline: z.unknown(), localValue: z.unknown(), expectedRemote: z.unknown() }).parse(await body(req, 1500000));
            const outputSchema = input.scope.kind === "page" ? pageSchema.nullable() : input.scope.kind === "part" ? (input.scope.part === "header" ? headerSchema : footerSchema) : profileSchema;
            const valueSchema = outputSchema.nullable();
            const baseline = valueSchema.parse(input.baseline), localValue = valueSchema.parse(input.localValue), expectedRemote = valueSchema.parse(input.expectedRemote);
            const current = fresh.published ? await effective(fresh) : null;
            if (!same(expectedRemote, scopedSource(current, input.scope))) fail(409, "リモートが再更新されました。比較を開き直してください");
            const proposal = await (intelligence.mergePage || mergePageWithAI)({ baseline, local: localValue, remote: expectedRemote, kind: input.scope.kind === "part" ? input.scope.part : input.scope.kind });
            const value = outputSchema.parse(proposal.value);
            if (input.scope.kind === "page" && value && "id" in value && value.id !== input.scope.pageId) fail(400, "AI が対象外のページを変更しました");
            const latest = fresh.published ? await effective(fresh) : null;
            if (!same(expectedRemote, scopedSource(latest, input.scope))) fail(409, "リモートが再更新されました。比較を開き直してください");
            return json(res, { value, explanation: z.string().min(1).max(4000).parse(proposal.explanation) });
          }
          if (action === "local-editor" && method === "GET") {
            assertOwner(user, fresh);
            const source = fresh.published ? await effective(fresh) : null;
            return json(res, { base: fresh.revision, source, lastPublishedPlanId: fresh.lastPublishedPlanId, config: source || fresh.draft || { ...structuredClone(sample), notificationEmail: user!.email } });
          }
          if (action === "visual/propose" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ id: z.string(), target: z.string(), instruction: z.string().trim().min(1).max(4000), imageIds: requestImageIdsSchema.default([]) }).parse(await body(req));
            const visual = await store.get<VisualRequest>("visual", input.id);
            const source = fresh.published ? await effective(fresh) : null;
            if (!visual || visual.shopId !== fresh.id || visual.base !== fresh.revision || Date.now() - visual.createdAt > 1800000 || !visual.candidates.some(c => c.id === input.target) || JSON.stringify(source) !== JSON.stringify(visual.source))
              fail(409, "本番の内容が変わりました。最新の内容を取り込んで印を確認し直してください");
            const images = await readRequestImages(store, fresh, input.imageIds, crmFiles, store.memory || !input.imageIds.length ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です"));
            const proposed = await intelligence.propose(`ペンで選んだ対象 ${input.target} のみ変更する。他の箇所は変更しない。依頼：${input.instruction}`, visual.config, user!.email, demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT, images);
            validateProposedImages(proposed.config, visual.config, images);
            const config = validateVisualChange(visual.config, proposed.config, input.target);
            return json(res, { config, summary: planSummary(visual.config, config) });
          }
          if (action === "staff-accounts" && method === "GET") {
            assertOwner(user, fresh);
            const accounts = await staffAccounts(store, fresh);
            const config = await effective(fresh);
            const members = await store.records<StaffMember>("member", fresh);
            const linked = await connections(store, fresh);
            return json(res, { configured: !!process.env.GOOGLE_CLIENT_ID, loginUrl: `/staff-login/${fresh.id}`, staff: (config?.staff || []).map(staff => {
              const account = accounts.find(account => account.staffId === staff.id);
              return { staffId: staff.id, name: staff.name, email: account?.email || "", accepted: account?.email === fresh.owner || members.some(member => member.email === account?.email && member.accepted), connected: linked.some(connection => connection.staffId === staff.id && connection.email === account?.email) };
            }) });
          }
          if (action === "staff-accounts" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ staffId: z.string().min(1), email: z.union([z.string().trim().pipe(emailSchema), z.literal("")]), previousEmail: z.string().default("") }).parse(await body(req));
            const config = await effective(fresh);
            if (!config?.staff.some(staff => staff.id === input.staffId)) fail(400, "担当スタッフを選択してください");
            const accounts = await staffAccounts(store, fresh);
            const previous = accounts.find(account => account.staffId === input.staffId);
            if ((previous?.email || "") !== input.previousEmail) fail(409, "登録内容が更新されています。最新の内容を確認してください。");
            if (input.email && accounts.some(account => account.email === input.email && account.staffId !== input.staffId)) fail(409, "このアカウントは別のスタッフに登録されています。");
            if (input.email && (await connections(store, fresh)).some(connection => (connection.staffId === input.staffId && connection.email !== input.email) || (connection.email === input.email && connection.staffId !== input.staffId))) {
              if (!previous || previous.email === input.email) fail(409, "別のスタッフとしてカレンダー連携中です。本人が連携を解除してから登録してください。");
            }
            if (previous && previous.email !== input.email) {
              const key = staffAccountKey(fresh.id, previous.email);
              if (previous.email !== fresh.owner) {
                const member = await store.get<StaffMember>("member", key);
                if (member) await store.put("member", key, { ...member, accepted: false, status: "revoked", revokedAt: new Date().toISOString() });
              }
              await store.delete("calendar", key);
              await store.delete("staffAccount", key);
            }
            if (input.email) {
              const key = staffAccountKey(fresh.id, input.email);
              if (input.email !== fresh.owner) {
                const member = await store.get<StaffMember>("member", key);
                await store.put("member", key, { shopId: fresh.id, email: input.email, accepted: member?.status !== "revoked" && member?.accepted === true, status: member?.status !== "revoked" && member?.accepted ? "accepted" : "registered", invitedAt: member?.invitedAt || new Date().toISOString(), acceptedAt: member?.acceptedAt || "", revokedAt: "" });
              }
              await store.put("staffAccount", key, { shopId: fresh.id, staffId: input.staffId, email: input.email } satisfies StaffAccount);
            }
            return json(res, { ok: true });
          }
          if (action === "calendar" && method === "GET") {
            const connection = await store.get<CalendarConnection>("calendar", `${fresh.id}:${user!.email}`);
            const account = (await staffAccounts(store, fresh)).find(account => account.email === user!.email);
            return json(res, { connected: !!connection, staffId: connection?.staffId || account?.staffId, email: user!.email, configured: !!process.env.GOOGLE_CLIENT_ID, loginUrl: `/staff-login/${fresh.id}` });
          }
          if (action === "calendar/disconnect" && method === "POST") {
            await store.delete("calendar", `${fresh.id}:${user!.email}`);
            return json(res, { ok: true });
          }
          if (action === "calendar/connect" && method === "POST") {
            if (!process.env.GOOGLE_CLIENT_ID) fail(503, "Google ログインをサーバーで設定してください");
            const { staffId } = z.object({ staffId: z.string().min(1) }).parse(await body(req));
            const config = await effective(fresh);
            if (!config?.staff.some(s => s.id === staffId)) fail(400, "予約の担当者を選択してください");
            const assigned = (await staffAccounts(store, fresh)).find(account => account.email === user!.email);
            if (assigned && assigned.staffId !== staffId) fail(403, "登録されている担当スタッフで接続してください");
            if ((await connections(store, fresh)).some(c => c.staffId === staffId && c.email !== user!.email)) fail(409, "この担当者は別のメンバーが連携済みです");
            const state = randomBytes(32).toString("base64url");
            const verifier = randomBytes(48).toString("base64url");
            await store.put("oauth", digest(state), { verifier, calendarShopId: fresh.id, email: user!.email, staffId, expires: Date.now() + 600000 });
            res.setHeader("Set-Cookie", `omai_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`);
            return json(res, { authUrl: oauth().generateAuthUrl({ access_type: "offline", prompt: "consent", login_hint: user!.email, scope: ["openid", "email", calendarScope], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" as never }) });
          }
          if (action === "system" && method === "GET") {
            if (!fresh.published) fail(409, "公開後に仕組み図を表示します");
            const config = await effective(fresh);
            return json(res, {
              diagram: shopSystem(config),
              svg: systemSvg(config),
              overview: systemSvg(config, false),
              revision: fresh.revision,
            });
          }
          if (action === "build-context" && method === "GET") {
            const config = fresh.published ? await effective(fresh) : fresh.draft;
            return json(res, { config, revision: fresh.revision, hash: contentHash(config), history: fresh.history, published: !!fresh.published });
          }
          if (action === "conversations" && method === "GET") return json(res,{email:user!.email,conversations:await conversations(store,fresh,user!.email)});
          if (action === "conversations" && method === "POST") {
            const input = conversationInputSchema.parse(await body(req));
            if (input.intent !== "consult") assertOwner(user,fresh);
            return json(res,await createConversation(store,fresh,user!.email,input.intent,input.requestId,!!input.begin));
          }
          const conversationRoute = action.match(/^conversations\/([a-f0-9]{64})$/);
          if (conversationRoute && method === "GET") {
            const chat = await readConversation(store,fresh,user!.email,conversationRoute[1]);
            const linked = [...new Set(chat.messages.flatMap(message => message.detail.planId ? [message.detail.planId] : []))];
            const plans = (await Promise.all(linked.map(id => store.get<Plan>("plan",id)))).filter(plan => plan?.shopId === fresh.id);
            return json(res,{...chat,plans});
          }
          if (action === "system/question" && method === "POST") {
            const input = z
              .object({
                question: z.string().trim().min(1).max(4000),
                chat: chatReferenceSchema.optional(),
                intent: requestIntentSchema.optional(),
                revision: z.number().int(),
                hash: z.string().optional(),
                messages: z.array(messageSchema).max(30).default([]),
                imageIds: requestImageIdsSchema.default([]),
              })
              .parse(await body(req, 1500000));
            if(!fresh.published&&input.intent!=="create-shop")fail(409,"先にお店づくりを始めてください");
            if(input.intent==="create-shop"){assertOwner(user,fresh);if(fresh.published)fail(409,"お店ができました。相談・修正・新ページ作成から選んでください");}
            let savedChat = input.chat ? await readConversation(store,fresh,user!.email,input.chat.id) : undefined;
            if (savedChat && savedChat.intent !== input.intent) fail(409,"依頼の種類が変わっています。もう一度お話しください");
            if (savedChat) {
              await appendChatMessage(store,fresh,savedChat,{role:"user",text:input.question,requestId:input.chat!.requestId,detail:{imageIds:input.imageIds}});
              savedChat = await readConversation(store,fresh,user!.email,savedChat.id);
              const previous = savedChat.messages.find(message => message.role === "assistant" && message.requestId === input.chat!.requestId);
              if (previous) return json(res,{answer:previous.text,...previous.detail,chat:savedChat});
            }
            if (input.revision !== fresh.revision)
              fail(409, "お店の仕様が変わりました。現在の仕様を更新してください");
            const config = fresh.published ? await effective(fresh) : fresh.draft || {...structuredClone(sample),notificationEmail:user!.email};
            if (input.hash && input.hash !== contentHash(config)) fail(409, "お店の仕様が変わりました。現在の仕様を更新してください");
            if (input.imageIds.length) assertOwner(user, fresh);
            const images = await readRequestImages(store, fresh, input.imageIds, crmFiles, store.memory || !input.imageIds.length ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です"));
            const excluded = new Set(savedChat?.messages.slice(-25).map(message=>message.id) || []);
            const relatedHistory = await searchConversationHistory(store,fresh,user!.email,input.question,excluded);
            const response = await intelligence.explainSystem(input.intent ? `${requestIntentInstruction[input.intent]}\n${input.question}` : input.question, config, demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT, { messages: savedChat ? conversationContext({...savedChat,messages:savedChat.messages.filter(message => message.requestId !== input.chat!.requestId)}) : input.messages, history: fresh.history, initialSetup:!fresh.published, relatedHistory, searchHistory:query=>searchConversationHistory(store,fresh,user!.email,query,excluded), ...(images.length ? { images } : {}) });
            if (fresh.published && !same(config, await effective(fresh))) fail(409, "回答中にお店の仕様が変わりました。現在の仕様を更新して質問し直してください");
            let answer: {answer:string;changeRequest:boolean;ready?:boolean} = input.intent === "consult" ? { ...response, changeRequest: false, ready: false } : response;
            if(input.intent==="create-shop"&&answer.ready&&!answeredFinalDetails(savedChat?.messages || [...input.messages,{role:"user",text:input.question}])) answer={answer:finalDetailsQuestion,changeRequest:true,ready:false};
            if (savedChat) await appendChatMessage(store,fresh,savedChat,{role:"assistant",text:answer.answer,requestId:input.chat!.requestId,detail:{changeRequest:answer.changeRequest,ready:answer.ready}});
            return json(res,{...answer,...(savedChat ? {chat:await readConversation(store,fresh,user!.email,savedChat.id)} : {})});
          }
          if (action === "visual/identify" && method === "POST") {
            assertOwner(user, fresh);
            if (fresh.publishingPlanId)
              fail(409, "公開処理が完了してからお試しください");
            const input = z
              .object({
                media: mediaSchema,
                instruction: z.string().trim().min(1).max(4000),
                planId: z.string().optional(),
                displayed: shopSchema,
                local: z.object({ base: z.number().int(), source: shopSchema.nullable(), pageId: z.string().optional(), part: z.enum(["header", "footer"]).optional() }).optional(),
              })
              .parse(await body(req, 12000000));
            if (
              input.media.mimeType !== "image/png" ||
              input.media.data.length > 5600000
            )
              fail(400, "4MB以下の PNG を指定してください");
            const source = fresh.published ? await effective(fresh) : null;
            let config = source;
            if (input.local) {
              const scope = input.local.part ? { kind: "part" as const, part: input.local.part } : input.local.pageId ? { kind: "page" as const, pageId: input.local.pageId } : { kind: "shared" as const };
              if (input.planId || !same(scopedSource(input.local.source, scope), scopedSource(source, scope)))
                fail(409, "本番の内容が変わりました。最新の内容を取り込んでください");
              config = input.displayed;
            }
            if (input.planId) {
              const plan = await store.get<Plan>("plan", input.planId);
              if (
                !plan ||
                plan.shopId !== fresh.id ||
                !plan.approved ||
                plan.base !== fresh.revision
              )
                fail(409, "最新の承認済みプレビューを開き直してください");
              config = plan.config;
            }
            if (
              !config ||
              JSON.stringify(shopSchema.parse(config)) !==
                JSON.stringify(input.displayed)
            )
              fail(
                409,
                "画面の設定が古くなっています。開き直して印をつけてください",
              );
            if (input.local?.pageId && !config.pages.some(p => p.id === input.local!.pageId)) fail(400, "対象ページがありません");
            const targets = visualTargets(config).filter(t => !input.local || (input.local.part ? t.id === `part:${input.local.part}` : input.local.pageId
              ? t.id.startsWith(`page:${input.local.pageId}:`)
              : !t.id.startsWith("menu:") && !t.id.startsWith("staff:") && !t.id.startsWith("page:") && !t.id.startsWith("part:")));
            const result = await intelligence.identifyVisual(
              input.media,
              targets,
              input.instruction,
            );
            const candidates = targets.filter((t) => result.ids.includes(t.id));
            if (!candidates.length)
              fail(
                400,
                result.explanation +
                  " 変更したい文言・画像・配置を囲んでください。",
              );
            const visual: VisualRequest = {
              id: randomUUID(),
              shopId: fresh.id,
              base: fresh.revision,
              source,
              config,
              candidates,
              createdAt: Date.now(),
            };
            await store.put("visual", visual.id, visual);
            return json(res, {
              id: visual.id,
              candidates,
              explanation: result.explanation,
            });
          }
          if (action === "posts" && method === "GET")
            return json(res, await postsFor(fresh));
          if (action === "posts" && method === "POST") {
            assertOwner(user, fresh);
            const { content, publish, requestId, autoMetadata } = z
              .object({ content: postContentSchema, publish: z.boolean().optional(), requestId:z.uuid().optional(), autoMetadata:z.boolean().optional() })
              .parse(await body(req));
            const creationId = requestId ? digest(`${fresh.id}:${user!.email}:post:${requestId}`) : randomUUID();
            const creationHash = digest(JSON.stringify({content,publish}));
            const receipt = requestId ? await store.get<{hash:string;postId:string}>("postCreation",creationId) : undefined;
            if(receipt){if(receipt.hash!==creationHash)fail(409,"保存する記事の内容が変わっています");return json(res,(await postsFor(fresh)).find(post=>post.id===receipt.postId)||fail(404,"記事がありません"));}
            if(autoMetadata)content.slug=uniquePostSlug(content,await postsFor(fresh),creationId);
            if (publish && (!fresh.published || fresh.publishingPlanId)) fail(409, "先にお店の反映処理を完了してください");
            const at = new Date().toISOString();
            const post: Post = {
              id: creationId,
              shopId: fresh.id,
              draft: content,
              published: null,
              version: 1,
              createdAt: at,
              updatedAt: at,
              updatedBy: user!.email,
            };
            for(const imageId of postImageIds(content.body))await readMenuImage(store,fresh,imageId,crmFiles,store.memory?"":await ownerToken(fresh)||fail(503,"店主のGoogle再接続が必要です"));
            validatePostAddress(post, content, await postsFor(fresh));
            if (publish) {
              post.published = structuredClone(content); post.publishedAt = at; post.address = postAddress(content);
              fresh.history.push({ at, summary: `${postLabel(content.category)}を保存・公開：${content.title}` });
            }
            await store.transaction(async () => {
              await store.put("post", post.id, post);
              if(requestId)await store.put("postCreation",creationId,{hash:creationHash,postId:post.id});
              if (publish) await store.saveShop(fresh);
              await enqueue(fresh, "posts");
            });
            await flush(fresh);
            return json(res, post);
          }
          const postAction = action.match(
            /^posts\/([^/]+)\/(save|publish|unpublish)$/,
          );
          if (postAction && method === "POST") {
            assertOwner(user, fresh);
            const post = (await postsFor(fresh)).find(
              (p) => p.id === postAction[1],
            );
            if (!post || post.shopId !== fresh.id)
              fail(404, "記事がありません");
            const raw = await body(req);
            const { version } = z
              .object({ version: z.number().int().positive() })
              .parse(raw);
            if (version !== post.version)
              fail(
                409,
                "別の画面で記事が更新されました。一覧から記事を開き直してください",
              );
            const at = new Date().toISOString();
            if (postAction[2] === "save") {
              const { content, publish } = z
                .object({ content: postContentSchema, publish: z.boolean().optional() })
                .parse(raw);
              if (publish && (!fresh.published || fresh.publishingPlanId)) fail(409, "先にお店の反映処理を完了してください");
              for(const imageId of postImageIds(content.body))await readMenuImage(store,fresh,imageId,crmFiles,store.memory?"":await ownerToken(fresh)||fail(503,"店主のGoogle再接続が必要です"));
            validatePostAddress(post, content, await postsFor(fresh));
              post.draft = content;
              if (publish) {
                post.published = structuredClone(content); post.publishedAt = at; post.address = postAddress(content);
                fresh.history.push({ at, summary: `${postLabel(content.category)}を保存・公開：${content.title}` });
              }
            } else if (postAction[2] === "publish") {
              z.object({ approved: z.literal(true) }).parse(raw);
              if (!fresh.published)
                fail(409, "先にお店の予約ページを公開してください");
              if (fresh.publishingPlanId)
                fail(409, "お店の公開処理を完了してから記事を公開してください");
              for(const imageId of postImageIds(post.draft.body))await readMenuImage(store,fresh,imageId,crmFiles,store.memory?"":await ownerToken(fresh)||fail(503,"店主のGoogle再接続が必要です"));
              validatePostAddress(post, post.draft, await postsFor(fresh));
              post.published = structuredClone(post.draft);
              post.publishedAt = at;
              post.address = postAddress(post.draft);
              fresh.history.push({
                at,
                summary: `${postLabel(post.draft.category)}を公開：${post.draft.title}`,
              });
            } else {
              if (!post.published) fail(409, "この記事はすでに非公開です");
              fresh.history.push({
                at,
                summary: `${postLabel(post.published.category)}を非公開：${post.published.title}`,
              });
              post.published = null;
            }
            post.version++;
            post.updatedAt = at;
            post.updatedBy = user!.email;
            await store.transaction(async () => {
              await store.put("post", post.id, post);
              await store.saveShop(fresh);
              await enqueue(fresh, "posts");
            });
            await flush(fresh);
            return json(res, post);
          }
          if (action === "plan" && method === "POST") {
            assertOwner(user, fresh);
            if (fresh.publishingPlanId)
              fail(
                409,
                "公開処理が未完了です。承認済みプランの公開を再試行してください",
              );
            const input = z
              .object({
                text: z.string().min(1).max(10000),
                chat: chatReferenceSchema.optional(),
                intent: requestIntentSchema.optional(),
                imageIds: requestImageIdsSchema.default([]),
                config: shopSchema.optional(),
                context: z.object({ revision: z.number().int(), hash: z.string() }).optional(),
                local: z.object({ base: z.number().int(), source: shopSchema.nullable(), requestId: z.uuid(), scope: releaseScopeSchema.optional() }).optional(),
                visual: z
                  .object({ id: z.string(), target: z.string() })
                  .optional(),
              })
              .parse(await body(req, 1500000));
            const savedChat = input.chat ? await readConversation(store,fresh,user!.email,input.chat.id) : undefined;
            if (savedChat && savedChat.intent !== input.intent) fail(409,"チャットの種類が変わっています");
            const chatPlanId = input.chat ? digest(`${fresh.id}:chat-plan:${input.chat.id}:${input.chat.requestId}`) : undefined;
            const existingChatPlan = chatPlanId ? await store.get<Plan>("plan",chatPlanId) : undefined;
            if (existingChatPlan?.shopId === fresh.id && input.chat) { await attachChatPlan(store,fresh,user!.email,input.chat,existingChatPlan.id); return json(res,existingChatPlan); }
            const previousReply = savedChat?.messages.find(message => message.role === "assistant" && message.requestId === input.chat!.requestId);
            if (input.chat && !previousReply) fail(409,"変更案の元になった会話が見つかりません");
            if(input.intent==="create-shop"&&savedChat&&(!previousReply?.detail.ready||!answeredFinalDetails(savedChat.messages.filter(message=>message.sequence<=previousReply.sequence))))fail(409,"確認画面へ進む前に、ほかに伝えたいことがあるかお答えください");
            if (previousReply?.detail.planId) {
              const previous = await store.get<Plan>("plan",previousReply.detail.planId);
              if (previous?.shopId === fresh.id) return json(res,previous);
            }
            const current = fresh.published ? await effective(fresh) : null;
            if(input.intent==="create-shop"&&current)fail(409,"お店は作成済みです。修正を選んでください");
            if (input.intent === "consult") fail(400, "相談では設定を変更しません。修正または新ページ作成を選んでください");
            if (input.intent === "new-page" && (!current || input.config || input.local || input.visual)) fail(400, "新ページ作成は仮公開したあとに依頼してください");
            if (input.context && (input.context.revision !== fresh.revision || input.context.hash !== contentHash(current))) fail(409, "お店の仕様が変わりました。現在の仕様を更新して変更を相談し直してください");
            let releaseConfig = input.config;
            if (input.local?.scope && input.config) releaseConfig = shopSchema.parse(scopedConfig(current, input.config, input.local.scope));
            const localPlanId = input.local ? digest(`${fresh.id}:${user!.email}:${input.local.requestId}`) : undefined;
            if (input.local) {
              if (!input.config || input.visual) fail(400, "反映するローカル設定を指定してください");
              const previous = await store.get<Plan>("plan", localPlanId!);
              if (previous) {
                if (previous.shopId !== fresh.id || JSON.stringify(previous.config) !== JSON.stringify(releaseConfig)) fail(409, "反映する内容を確認し直してください");
                return json(res, previous);
              }
              if (input.local.scope
                ? !same(scopedSource(input.local.source, input.local.scope), scopedSource(current, input.local.scope))
                : input.local.base !== fresh.revision || !same(input.local.source, current))
                fail(409, "本番の内容が変わりました。ローカル編集は保持しています。最新の内容を取り込んで変更を確認してください");
            }
            let visual: VisualRequest | undefined;
            if (input.visual) {
              if (input.config)
                fail(400, "ペンの依頼と項目入力は別々に行ってください");
              visual = await store.get<VisualRequest>(
                "visual",
                input.visual.id,
              );
              if (
                !visual ||
                visual.shopId !== fresh.id ||
                visual.base !== fresh.revision ||
                Date.now() - visual.createdAt > 1800000 ||
                !visual.candidates.some((t) => t.id === input.visual!.target)
              )
                fail(409, "印の対象を確認し直してください");
              if (JSON.stringify(current) !== JSON.stringify(visual.source))
                fail(409, "設定が変わりました。画面を開き直してください");
            }
            const images = await readRequestImages(store, fresh, input.imageIds, crmFiles, store.memory || !input.imageIds.length ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です"));
            const relatedHistory = input.intent ? await searchConversationHistory(store,fresh,user!.email,input.text,new Set(savedChat?.messages.slice(-24).map(message=>message.id) || [])) : [];
            const historicalContext = relatedHistory.length ? `参照用の過去の会話です。今回の変更依頼でも、反映済みという意味でもありません。現在の設定を優先してください。\n${JSON.stringify(relatedHistory)}\n今回の会話と依頼:\n` : "";
            const proposed = input.config
              ? {
                  config: releaseConfig!,
                  summary: planSummary(current, releaseConfig!),
                }
              : await intelligence.propose(
                  visual
                    ? `ペンで選んだ対象 ${input.visual!.target} のみ変更する。予約ルール・料金・所要時間など他の箇所は一切変えない。依頼：${input.text}`
                    : input.intent ? `${requestIntentInstruction[input.intent]}\n${historicalContext}${savedChat ? conversationContext(savedChat).map(message => `${message.role === "user" ? "店主" : "AI"}: ${message.text}`).join("\n") : input.text}` : input.text,
                  visual?.config || current,
                  user!.email,
                  demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT,
                  images,
                );
            if (input.intent === "new-page") {
              const added = proposed.config.pages.filter(page => !current!.pages.some(existing => existing.id === page.id));
              if (!added.length) fail(400, "新しいページが見つかりませんでした。追加したいページをもう一度教えてください");
              proposed.config = shopSchema.parse({ ...current!, pages: [...current!.pages, ...added] });
              proposed.summary = planSummary(current, proposed.config);
            }
            if (!input.config) validateProposedImages(proposed.config, visual?.config || current, images);
            if (visual) {
              proposed.config = validateVisualChange(
                visual.config,
                proposed.config,
                input.visual!.target,
              );
              proposed.summary = planSummary(current, proposed.config);
            }
            const plan: Plan = {
              id: localPlanId || chatPlanId || randomUUID(),
              local: !!input.local,
              scope: input.local?.scope,
              shopId: fresh.id,
              base: fresh.revision,
              ...proposed,
              approved: false,
              requiresSetup: !current && !input.config,
              createdAt: Date.now(),
              checklist,
              source: current,
              ...(input.chat ? {chat:input.chat} : {}),
            };
            if (!plan.summary.length) fail(400, "変更点がありません");
            artifacts(plan.config, '<title></title><div id="root"></div>');
            await store.put("plan", plan.id, plan);
            if (input.chat) await attachChatPlan(store,fresh,user!.email,input.chat,plan.id);
            return json(res, plan);
          }
          const p = action.match(/^plans\/([^/]+)\/(approve|publish)$/);
          if (p && method === "POST") {
            assertOwner(user, fresh);
            const plan = await store.get<Plan>("plan", p[1]);
            if (!plan || plan.shopId !== fresh.id)
              fail(404, "プランがありません");
            if (fresh.lastPublishedPlanId === plan.id)
              return json(res, { ok: true, url: `/s/${fresh.slug}` });
            if (plan.base !== fresh.revision)
              fail(409, "公開内容が変わりました。プランを作り直してください");
            if (p[2] === "approve") {
              plan.approved = true;
              await store.put("plan", plan.id, plan);
              fresh.draft = plan.config;
              await store.saveShop(fresh);
              return json(res, { ok: true });
            }
            const input = z.object({ publication: z.enum(["provisional", "public"]).optional() }).parse(await body(req));
            return json(res, await publishConfiguration(fresh, plan, input.publication));
          }
          if (action === "publication-preview" && method === "GET") {
            assertOwner(user, fresh);
            if (!fresh.published || fresh.publishingPlanId) fail(409, "先に仮公開を完了してください");
            const config = await effective(fresh);
            const posts = publicPosts(await postsFor(fresh));
            return json(res, { config, posts, revision: fresh.revision, hash: contentHash({ config, posts }) });
          }
          if (action === "publication" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ publication: z.literal("public"), revision: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await body(req));
            if (!fresh.published || fresh.publishingPlanId) fail(409, "先に仮公開を完了してください");
            if (fresh.revision !== input.revision) fail(409, "お店の内容が変わりました。最新の内容を確認してから全公開してください");
            const config = await effective(fresh);
            const posts = publicPosts(await postsFor(fresh));
            if (input.hash !== contentHash({ config, posts })) fail(409, "プレビュー後に内容が変わりました。最新の内容を読み直して確認してください");
            if (fresh.publication !== "public") {
              fresh.publication = "public";
              fresh.history.push({ at: new Date().toISOString(), summary: "本番公開に切り替えました" });
              await store.saveShop(fresh);
            }
            return json(res, { ok: true, url: `/s/${fresh.slug}` });
          }
          if (action === "operations" && method === "GET") {
            return json(res, {
              bookings: await store.bookings(fresh.id),
              inquiries: await inquiries(fresh),
            });
          }
          const customerRoute = action.match(/^customers(?:\/([^/]+)(?:\/(.*))?)?$/);
          if (customerRoute && (method === "GET" || method === "POST")) {
            const filter = customerFilterSchema.parse({ period: url.searchParams.get("period") ?? undefined, since: url.searchParams.get("since") ?? undefined });
            const now = new Date();
            const loadCustomers = async () => aggregateCustomers(await store.bookings(fresh.id), await inquiries(fresh), await store.records<CustomerNote>("customerNote", fresh), now, customerSince(filter, now), await store.records<import("./customers.ts").CustomerRecord>("customer", fresh));
            const customers = await loadCustomers();
            if (!customerRoute[1] && method === "GET") return json(res, customerSummaries(customers));
            const email = normalizeEmail(decodeURIComponent(customerRoute[1] || ""));
            const customer = customers.find(customer => customer.email === email) || fail(404, "お客様が見つかりません");
            const tail = customerRoute[2] || "";
            if (!tail && method === "GET") return json(res, customer);
            if (tail === "images" && method === "GET") return json(res, {
              name: customer.name,
              images: customerImages((await store.records<CustomerNote>("customerNote", fresh)).filter(note => normalizeEmail(note.email) === email)),
            });
            if (tail === "notes" && method === "POST") {
              const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
              await addCustomerNote(store, fresh, email, user!.email, await body(req, 15 * 1024 * 1024), crmFiles, token);
              return json(res, (await loadCustomers()).find(customer => customer.email === email));
            }
            const noteRoute = tail.match(/^notes\/([^/]+)(?:\/(delete|files)(?:\/([^/]+))?)?$/);
            if (noteRoute) {
              const note = (await store.records<CustomerNote>("customerNote", fresh)).find(note => note.id === noteRoute[1] && normalizeEmail(note.email) === email && note.status === "active") || fail(404, "メモがありません");
              if (noteRoute[2] === "files" && noteRoute[3] && method === "GET") {
                const attachment = note.attachments.find(file => file.id === noteRoute[3]) || fail(404, "添付ファイルがありません");
                const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
                const data = await crmFiles.read(fresh, token, attachment.id);
                if (data.length !== attachment.size) fail(409, "添付ファイルが変更されています");
                return json(res, { data: data.toString("base64") });
              }
              if (method === "POST" && (!noteRoute[2] || noteRoute[2] === "delete")) {
                const input = z.object({ text: z.string().max(10000).optional(), attachmentNames: z.array(customerAttachmentSchema.pick({ id: true, name: true })).max(5).optional(), previousUpdatedAt: z.string() }).parse(await body(req));
                if (input.previousUpdatedAt !== note.updatedAt) fail(409, "メモが更新されています。詳細を開き直して確認してください。入力内容は画面に残っています");
                if (!noteRoute[2]) {
                  if (input.text === undefined && !input.attachmentNames?.length) fail(400, "変更内容を指定してください");
                  if (input.text !== undefined && !input.text.trim() && !note.attachments.length) fail(400, "メモを入力してください");
                  const names = input.attachmentNames || [];
                  if (new Set(names.map(file => file.id)).size !== names.length || names.some(file => !note.attachments.some(attachment => attachment.id === file.id))) fail(400, "添付ファイルを確認してください");
                  for (const file of names) {
                    const attachment = note.attachments.find(attachment => attachment.id === file.id)!;
                    if (attachment.name === file.name) continue;
                    const token = store.memory ? "" : await ownerToken(fresh) || fail(503, "店主の Google 再接続が必要です");
                    await crmFiles.rename(fresh, token, file.id, file.name);
                    attachment.name = file.name;
                  }
                  if (input.text !== undefined) note.text = input.text;
                } else note.status = "deleted";
                note.updatedAt = new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1)).toISOString();
                note.updatedBy = user!.email;
                await store.put("customerNote", note.id, note);
                await touchCustomer(store, fresh, email, note);
                return json(res, (await loadCustomers()).find(customer => customer.email === email));
              }
            }
          }
          const cancellation = action.match(/^bookings\/([^/]+)\/status$/);
          if (cancellation && method === "POST") {
            const input = z
              .object({ status: z.enum(["cancelled", "no_show"]) })
              .parse(await body(req));
            const b =
              (await store.bookings(fresh.id)).find(
                (b) => b.id === cancellation[1],
              ) || fail(404, "予約がありません");
            if (b.status !== "active") fail(409, "この予約は処理済みです");
            const config = await effective(fresh);
            b.status = input.status;
            b.updatedBy = user!.email;
            b.updatedAt = new Date().toISOString();
            await store.saveBooking(b);
            await notify(
              fresh,
              config,
              b.customer,
              "予約の状態が変更されました",
              `${b.name} 様\n予約: ${b.start}\n状態: ${b.status}`,
            );
            await flush(fresh);
            return json(res, { ok: true });
          }
          const inquiryAction=action.match(/^inquiries\/([^/]+)\/(reply|status)$/);
          if(inquiryAction&&method==="POST"){
            const q=(await inquiries(fresh)).find(q=>q.id===inquiryAction[1]&&q.shopId===fresh.id)||fail(404,"お問い合わせがありません");
            if(inquiryAction[2]==="status"){
              const input=z.object({status:inquiryStatusSchema,previousStatus:inquiryStatusSchema.optional()}).parse(await body(req));
              const current=inquiryStatus(q);
              if(input.previousStatus&&input.previousStatus!==current&&input.status!==current)fail(409,"対応状況が更新されています。最新の状態を確認してください");
              q.status=input.status;await store.put("inquiry",q.id,q);return json(res,{ok:true});
            }
            const input=z.object({text:z.string().trim().min(1).max(5000),requestId:z.uuid().optional(),previousReply:z.string().max(5000).optional(),status:inquiryStatusSchema.optional()}).parse(await body(req));
            const key=digest(`${fresh.id}:${q.id}:${input.requestId||randomUUID()}`);
            const hash=digest(JSON.stringify({text:input.text,previousReply:input.previousReply??null,status:input.status??null}));
            const operation=await store.get<{hash:string;done:boolean}>("inquiryReplyRequest",key);
            if(operation&&operation.hash!==hash)fail(409,"返信内容が変わっています。入力し直してください");
            if(operation?.done){await flush(fresh);return json(res,{ok:true});}
            if(input.previousReply!==undefined&&q.reply!==input.previousReply&&!(operation&&q.reply===input.text))fail(409,"他の担当者が返信しています。最新の状態を確認してください");
            await store.put("inquiryReplyRequest",key,{shopId:fresh.id,inquiryId:q.id,hash,done:false});
            q.reply=input.text;q.status=input.status||inquiryStatus(q);await store.put("inquiry",q.id,q);
            await enqueue(fresh,"mail",{to:q.email,subject:`${fresh.published!.name} からの返信`,body:input.text},digest(`${key}:mail`));
            await store.put("inquiryReplyRequest",key,{shopId:fresh.id,inquiryId:q.id,hash,done:true});
            await flush(fresh);return json(res,{ok:true});
          }
          if (action === "invite" && method === "POST") {
            assertOwner(user, fresh);
            const { email } = z
              .object({ email: emailSchema })
              .parse(await body(req));
            if (email === fresh.owner)
              fail(400, "店主はすでに運営メンバーです");
            const id = `${fresh.id}:${email}`;
            if (
              !(await store.get("member", id)) ||
              (await store.get<{ status?: string }>("member", id))?.status ===
                "revoked"
            )
              await store.put("member", id, {
                shopId: fresh.id,
                email,
                accepted: false,
                status: "invited",
                invitedAt: new Date().toISOString(),
              });
            await enqueue(fresh, "mail", {
              to: email,
              subject: "お店の運営に招待されました",
              body: `${fresh.published?.name || "お店"}の運営に招待されました。${origin()} にこのメールアドレスの Google アカウントでログインして招待を承諾してください。`,
            });
            await flush(fresh);
            return json(res, { ok: true });
          }
          if (action === "members/revoke" && method === "POST") {
            assertOwner(user, fresh);
            const { email } = z
              .object({ email: emailSchema })
              .parse(await body(req));
            const id = `${fresh.id}:${email}`;
            const member = await store.get<Record<string, unknown>>(
              "member",
              id,
            );
            if (!member) fail(404, "メンバーがありません");
            await store.put("member", id, {
              ...member,
              accepted: false,
              status: "revoked",
              revokedAt: new Date().toISOString(),
            });
            await store.delete("calendar", `${fresh.id}:${email}`);
            await store.delete("staffAccount", `${fresh.id}:${email}`);
            return json(res, { ok: true });
          }
          if (action === "domain" && method === "POST") {
            assertOwner(user, fresh);
            const { domain } = z
              .object({
                domain: z
                  .string()
                  .toLowerCase()
                  .regex(
                    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
                  ),
              })
              .parse(await body(req));
            return await store.locked(`domain:${domain}`, async () => {
              if (
                domain === appHost ||
                (await store.list<Shop>("shop")).some(
                  (s) => s.id !== fresh.id && s.domain === domain,
                )
              )
                fail(409, "このドメインは利用できません");
              fresh.domain = domain;
              fresh.domainVerified = false;
              fresh.domainToken = randomBytes(24).toString("hex");
              await store.saveShop(fresh);
              return json(res, { ok: true });
            });
          }
          if (action === "domain/verify" && method === "POST") {
            assertOwner(user, fresh);
            if (!fresh.domain || !fresh.domainToken)
              fail(400, "先にドメインを設定してください");
            const records = await resolveTxt(`_omaiweb.${fresh.domain}`).catch(
              () => [],
            );
            if (!records.some((r) => r.join("") === fresh.domainToken))
              fail(400, "確認用 TXT レコードが見つかりません");
            fresh.domainVerified = true;
            await store.saveShop(fresh);
            return json(res, { ok: true });
          }
          if (action === "retry" && method === "POST") {
            await flush(fresh);
            return json(res, { ok: true });
          }
          if (action === "documents" && method === "GET")
            return json(
              res,
              documents(
                fresh.published ? await effective(fresh) : fresh.draft || sample,
                fresh.history,
              ),
            );
          fail(404, "見つかりません");
        });
      }
      const publicRoute = path.match(/^\/api\/public\/([^/]+)(?:\/(.*))?$/);
      if (publicRoute) {
        const shopRef =
          allShops.find((s) => s.slug === publicRoute[1] && s.published) ||
          fail(404, "公開されたお店がありません");
        if (hosted && hosted.id !== shopRef.id) fail(404, "お店がありません");
        const action = publicRoute[2] || "";
        return await store.locked(shopRef.id, async () => {
          const shop = (await store.shop(shopRef.id))!;
          assertStorefrontAccess(shop);
          const livePosts = publicPosts(await postsFor(shop));
          if (action === "posts" && method === "GET") {
            const category = postCategorySchema
              .optional()
              .parse(url.searchParams.get("category") || undefined);
            const page = z.coerce
              .number()
              .int()
              .min(1)
              .max(100000)
              .parse(url.searchParams.get("page") || 1);
            const size = 12;
            const all = livePosts.filter(
              (p) => !category || p.category === category,
            );
            return json(res, {
              items: all
                .slice((page - 1) * size, page * size)
                .map(summarizePost),
              total: all.length,
              page,
              size,
            });
          }
          const postRoute = action.match(
            /^posts\/(blogs|announcements)\/([a-z0-9-]+)$/,
          );
          if (postRoute && method === "GET") {
            const post =
              livePosts.find(
                (p) =>
                  p.category === postRoute[1] && postKey(p) === postRoute[2],
              ) || fail(404, "記事がありません");
            return json(res, post);
          }
          const config = await effective(shop);
          const menuImage = action.match(/^(menu-images|images)\/([a-f0-9]{64})$/);
          if (menuImage && method === "GET") {
            const ids = menuImage[1] === "images" ? [...managedImageIds(config),...publishedPostImageIds(await postsFor(shop))] : config.menus.filter(menu => menu.active).map(menu => menu.imageId);
            if (!ids.includes(menuImage[2])) fail(404, "画像がありません");
            return json(res, await readMenuImage(store, shop, menuImage[2], crmFiles, store.memory ? "" : await ownerToken(shop) || fail(503, "店主の Google 再接続が必要です")));
          }
          const customer = () => {
            if (!user || user.role !== "customer" || user.shopId !== shop.id)
              fail(401, "このお店のお客様としてログインしてください");
            return user!;
          };
          const ownProfile = async () => memberProfile(await store.get("customer", `${shop.id}:${customer().email}`));
          if (action === "profile" && method === "GET") {
            const u = customer();
            return json(res, { email: u.email, profile: await ownProfile(), suggestedName: u.name });
          }
          if (action === "profile" && method === "POST") {
            const u = customer();
            const profile = customerProfileSchema.parse(await body(req));
            const key = `${shop.id}:${u.email}`;
            const previous = await store.get<Record<string, unknown>>("customer", key);
            await store.put("customer", key, { ...previous, ...profile, shopId: shop.id, email: u.email, updatedBy: u.email, updatedAt: new Date().toISOString() });
            return json(res, { profile });
          }
          if (!action && method === "GET") {
            const isCustomer = user?.role === "customer" && user.shopId === shop.id;
            const profile = isCustomer ? await ownProfile() : undefined;
            return json(res, {
              config:
                user?.email === shop.owner && !publicHost
                  ? config
                  : { ...config, notificationEmail: undefined },
              shopId: shop.id,
              canEdit: user?.email === shop.owner && !publicHost,
              customerProfile: profile,
              registrationRequired: isCustomer && !profile,
              preview: false,
              publication: shop.publication || "public",
              recentPosts: livePosts.slice(0, 5).map(summarizePost),
              authUrl: `${origin()}/auth/google?shop=${shop.slug}${hosted ? `&host=${host}` : ""}`,
            });
          }
          if (action === "slots" && method === "GET")
            return json(
              res,
              await availableSlots(store, shop, config,
                url.searchParams.get("date") || "",
                url.searchParams.get("menu") || "",
                url.searchParams.get("staff") || undefined, calendar),
            );
          if (action === "bookings" && method === "GET") {
            const u = customer();
            return json(
              res,
              (await store.bookings(shop.id)).filter(
                (b) => b.customer === u.email,
              ),
            );
          }
          if (action === "bookings" && method === "POST") {
            const u = customer();
            if (!await ownProfile()) fail(428, "先に会員情報を登録してください");
            const input = z
              .object({
                name: z.string().min(1).max(100),
                message: z.string().max(2000).default(""),
                menuId: z.string(),
                staffId: z.string().optional(),
                start: z.iso.datetime(),
                requestId: z.uuid().optional(),
              })
              .parse(await body(req));
            const requestKey = input.requestId
              ? `${shop.id}:${u.email}:${input.requestId}`
              : undefined;
            const previous = requestKey
              ? (await store.bookings(shop.id)).find(
                  (b) => b.requestKey === requestKey,
                )
              : undefined;
            if (previous) return json(res, { ok: true, booking: previous });
            const date = new Date(Date.parse(input.start) + 9 * 3600000)
              .toISOString()
              .slice(0, 10);
            const slot = (await availableSlots(store, shop, config, date, input.menuId, input.staffId, calendar)).find((s) => s.start === input.start);
            if (!slot)
              fail(409, "この時間は予約できません。空き状況を更新してください");
            const b: Booking = {
              id: requestKey ? digest(requestKey) : randomUUID(),
              requestKey,
              shopId: shop.id,
              customer: u.email,
              name: input.name,
              message: input.message,
              menuId: input.menuId,
              price: config.menus.find(menu => menu.id === input.menuId)!.price,
              ...slot,
              status: "active",
              createdAt: new Date().toISOString(),
            };
            await store.transaction(async () => {
              await store.saveBooking(b);
              if (requestKey)
                await store.put("request", requestKey, {
                  bookingId: b.id,
                  shopId: shop.id,
                });
              await notify(
                shop,
                config,
                u.email,
                `${config.name} ご予約を承りました`,
                `${b.name} 様\n${config.menus.find((m) => m.id === b.menuId)!.name}\n${new Date(b.start).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n予約番号: ${b.id}${b.message ? `\nメッセージ: ${b.message}` : ""}`,
              );
            });
            await flush(shop);
            return json(res, { ok: true, booking: b });
          }
          const cancel = action.match(/^bookings\/([^/]+)\/cancel$/);
          if (cancel && method === "POST") {
            const u = customer();
            const b =
              (await store.bookings(shop.id)).find(
                (b) => b.id === cancel[1] && b.customer === u.email,
              ) || fail(404, "予約がありません");
            if (b.status !== "active") fail(409, "この予約は処理済みです");
            if (
              Date.parse(b.start) - Date.now() <
              config.rules.cancelHours * 3600000
            )
              fail(
                409,
                "キャンセル期限を過ぎています。お店にお問い合わせください",
              );
            b.status = "cancelled";
            b.updatedBy = u.email;
            b.updatedAt = new Date().toISOString();
            await store.transaction(async () => {
              await store.saveBooking(b);
              await notify(
                shop,
                config,
                u.email,
                "予約をキャンセルしました",
                `予約番号: ${b.id}\n${b.start}`,
              );
            });
            await flush(shop);
            return json(res, { ok: true });
          }
          if (action === "inquiries" && method === "POST") {
            const u = customer();
            if (!await ownProfile()) fail(428, "先に会員情報を登録してください");
            const input = z
              .object({
                name: z.string().min(1).max(100),
                message: z.string().min(1).max(5000),
              })
              .parse(await body(req));
            const q: Inquiry = {
              id: randomUUID(),
              shopId: shop.id,
              email: u.email,
              ...input,
              reply: "",
              status: "in_progress",
              at: new Date().toISOString(),
            };
            await store.put("inquiry", q.id, q);
            await notify(
              shop,
              config,
              u.email,
              `${config.name} お問い合わせを受け付けました`,
              input.message,
            );
            await flush(shop);
            return json(res, { ok: true });
          }
          fail(404, "見つかりません");
        });
      }
      if (path.startsWith("/api/") || path.startsWith("/auth/"))
        fail(404, "見つかりません");
      if (
        publicHost &&
        (path.startsWith("/admin") ||
          path.startsWith("/publication-preview") ||
          path.startsWith("/s/"))
      )
        fail(404, "見つかりません");
      if (method !== "GET" && method !== "HEAD")
        fail(405, "利用できない操作です");
      const publicationPreviewPage = path.match(/^\/publication-preview\/([^/]+)$/);
      if (publicationPreviewPage) {
        const shop = await store.shop(publicationPreviewPage[1]) || fail(404, "お店がありません");
        assertOwner(user, shop);
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Vary", "Cookie");
      }
      const root = resolve("dist");
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(`${root}/`)) {
        if (path !== "/") fail(404, "見つかりません");
      }
      const manualAsset = /^\/manual\/[a-z0-9-]+\.jpg$/.test(path);
      const asset =
        path.startsWith("/assets/") || manualAsset;
      if (
        !asset &&
        path !== "/" &&
        (publicHost
          ? !/^\/(blogs|announcements|pages)(?:\/[a-z0-9-]+)?$/.test(path)
          : path !== "/manual" && !/^\/publication-preview\/[^/]+$/.test(path) &&
            !/^\/(s)\/[^/]+(?:\/(blogs|announcements|pages)(?:\/[a-z0-9-]+)?)?$/.test(
              path,
            ))
      )
        fail(404, "見つかりません");
      let data: Buffer;
      try {
        data = await readFile(asset ? file : resolve(root, "index.html"));
      } catch {
        fail(404, "画面を表示するには npm run build を実行してください");
      }
      if (!asset) {
        const local = path.match(
          /^\/s\/([^/]+)(?:\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?)?$/,
        );
        const custom = publicHost
          ? path.match(/^\/(blogs|announcements|pages)(?:\/([a-z0-9-]+))?$/)
          : null;
        const shopRef =
          hosted || allShops.find((s) => s.slug === local?.[1] && s.published);
        const category = local?.[2] || custom?.[1];
        const key = local?.[3] || custom?.[2];
        if (shopRef?.published) {
          await store.locked(shopRef.id, async () => {
          const shop = await store.shop(shopRef.id);
          if (!shop?.published) fail(404, "公開されたお店がありません");
          if (shop.publication === "provisional" && !user) {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Vary", "Cookie");
            res.setHeader("X-Robots-Tag", "noindex, nofollow");
            return redirect(res, `${origin()}/auth/google?shop=${encodeURIComponent(shop.slug)}${publicHost ? `&host=${encodeURIComponent(host)}` : ""}`);
          }
          assertStorefrontAccess(shop);
          const posts = publicPosts(await postsFor(shop));
          const base = publicHost ? "" : `/s/${shop.slug}`;
          const shell = data.toString("utf8");
          if (category === "pages") {
            const config = await effective(shop);
            const page = config.pages.find(p => p.slug === key) || fail(404, "ページがありません");
            data = Buffer.from(renderCustomPage(page, shell, base));
          } else if (category) {
            const parsed = postCategorySchema.parse(category);
            if (key && key !== "index") {
              const post =
                posts.find(
                  (p) => p.category === parsed && postKey(p) === key,
                ) || fail(404, "記事がありません");
              data = Buffer.from(renderArticle(post, shell, base));
            } else
              data = Buffer.from(renderArchive(parsed, posts, shell, base));
          } else
            data = Buffer.from(
              renderHomeWithPosts(
                shop.published,
                shell,
                posts.slice(0, 5).map(summarizePost),
                base,
              ),
            );
          });
          if (res.writableEnded) return;
        } else if (category || local) fail(404, "公開されたお店がありません");
      }
      res.setHeader(
        "Content-Type",
        asset
          ? {
              ".js": "application/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".jpg": "image/jpeg",
            }[extname(file)] || "application/octet-stream"
          : "text/html; charset=utf-8",
      );
      res.setHeader(
        "Cache-Control",
        manualAsset
          ? "no-cache"
          : asset
            ? "public, max-age=31536000, immutable"
            : res.hasHeader("X-Robots-Tag") ? "private, no-store" : "no-cache",
      );
      res.end(method === "HEAD" ? undefined : data);
    } catch (error) {
      const err = error as Error & {
        status?: number;
      };
      if (error instanceof z.ZodError)
        return json(
          res,
          {
            error: error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join(" / "),
          },
          400,
        );
      const status = err.status || 500;
      if (status === 500) console.error(err);
      json(
        res,
        {
          error:
            status === 500
              ? "処理を完了できませんでした。設定と連携状態をご確認ください。"
              : err.message,
        },
        status,
      );
    }
  });
  const timer = setInterval(() => {
    void (async () => {
      await store.cleanup();
      for (const shop of (await store.list<Shop>("shop")).filter(
        (s) => s.google && s.published,
      ))
        void store
          .locked(shop.id, async () => {
            const fresh = await store.shop(shop.id);
            if (fresh) await flush(fresh);
          })
          .catch(console.error);
    })().catch(console.error);
  }, 60000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}
