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
  readDriveNote,
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
  attachLive,
  interview,
  saveInterview,
  interviewText,
  normalizeTurn,
  type LiveConnector,
} from "./interview.ts";
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
  publicPosts,
  summarizePost,
  type Post,
} from "./post-domain.ts";
import {
  renderArticle,
  renderArchive,
  renderHomeWithPosts,
} from "./post-renderer.tsx";
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
  createdAt: number;
  checklist: string[];
  source?: ShopConfig | null;
};
type Inquiry = {
  id: string;
  shopId: string;
  email: string;
  name: string;
  message: string;
  reply: string;
  status: string;
  at: string;
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
    normalizeTurn?: typeof normalizeTurn;
  } = { propose, proposeArticle, identifyVisual, explainSystem, normalizeTurn },
  liveConnector?: LiveConnector,
  calendar: CalendarGateway = calendarGateway,
) {
  const ownerToken = async (shop: Shop) =>
    (await store.get<User>("user", shop.owner))?.refreshToken;
  const operator = async (user: User | undefined, shop: Shop) =>
    !!user &&
    (user.email === shop.owner ||
      (
        await store.get<{
          accepted: boolean;
        }>("member", `${shop.id}:${user.email}`)
      )?.accepted === true);
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
  ) {
    if (!shop.google) return;
    const id = randomUUID();
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
        if (job.type === "posts")
          await syncPostFiles(
            shop,
            await postsFor(shop),
            token,
            async () => await store.saveShop(shop),
          );
        else await sendMail(token, job.to!, job.subject!, job.body!);
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
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
      if (path === "/auth/google" && method === "GET" && !publicHost) {
        if (!process.env.GOOGLE_CLIENT_ID)
          fail(
            503,
            "Google ログインはサーバーで設定してください。ローカル確認にはデモモードを利用できます。",
          );
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
          calendarShopId?: string;
          email?: string;
          staffId?: string;
        }>("oauth", key);
        if (!pending || pending.expires < Date.now())
          fail(400, "ログインの有効期限が切れました");
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
            m.email === user.email && !m.accepted && m.status !== "revoked",
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
          if (!m || m.status === "revoked")
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
        return await store.locked(shop.id, async () => {
          const fresh = (await store.shop(shop.id))!;
          await assertOperator(user, fresh);
          if (action === "calendar" && method === "GET") {
            const connection = await store.get<CalendarConnection>("calendar", `${fresh.id}:${user!.email}`);
            return json(res, { connected: !!connection, staffId: connection?.staffId, email: user!.email, configured: !!process.env.GOOGLE_CLIENT_ID });
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
            if ((await connections(store, fresh)).some(c => c.staffId === staffId && c.email !== user!.email)) fail(409, "この担当者は別のメンバーが連携済みです");
            const state = randomBytes(32).toString("base64url");
            const verifier = randomBytes(48).toString("base64url");
            await store.put("oauth", digest(state), { verifier, calendarShopId: fresh.id, email: user!.email, staffId, expires: Date.now() + 600000 });
            res.setHeader("Set-Cookie", `omai_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`);
            return json(res, { authUrl: oauth().generateAuthUrl({ access_type: "offline", prompt: "consent", login_hint: user!.email, scope: ["openid", "email", calendarScope], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" as never }) });
          }
          if (action === "interview" && method === "GET") {
            assertOwner(user, fresh);
            return json(res, await interview(store, fresh));
          }
          if (action === "interview" && method === "POST") {
            assertOwner(user, fresh);
            const input = z
              .object({ fields: z.unknown(), version: z.number().int() })
              .parse(await body(req));
            return json(
              res,
              await saveInterview(store, fresh, input.fields, input.version),
            );
          }
          if (action === "interview/plan" && method === "POST") {
            assertOwner(user, fresh);
            const input = z
              .object({ fields: z.unknown(), version: z.number().int() })
              .parse(await body(req));
            const state = await saveInterview(
              store,
              fresh,
              input.fields,
              input.version,
            );
            return json(res, {
              state,
              text: interviewText(state, !!fresh.published),
            });
          }
          if (action === "interview/turn" && method === "POST") {
            assertOwner(user, fresh);
            const input = z
              .object({ text: z.string().trim().min(1).max(10000) })
              .parse(await body(req));
            const current = await interview(store, fresh);
            const result = await (intelligence.normalizeTurn || normalizeTurn)(
              input.text,
              current,
              !!fresh.published,
            );
            const state = await saveInterview(store, fresh, result.fields);
            let text: string | undefined;
            if (result.ready) text = interviewText(state, !!fresh.published);
            return json(res, { state, question: result.question, text });
          }
          if (action === "system" && method === "GET") {
            if (!fresh.published) fail(409, "公開後に仕組み図を表示します");
            return json(res, {
              diagram: shopSystem(fresh.published),
              svg: systemSvg(fresh.published),
              overview: systemSvg(fresh.published, false),
              revision: fresh.revision,
            });
          }
          if (action === "system/question" && method === "POST") {
            if (!fresh.published) fail(409, "公開後に質問できます");
            const input = z
              .object({
                question: z.string().trim().min(1).max(4000),
                revision: z.number().int(),
              })
              .parse(await body(req));
            if (input.revision !== fresh.revision)
              fail(409, "公開内容が変わりました。仕組み図を更新してください");
            return json(
              res,
              await intelligence.explainSystem(
                input.question,
                fresh.published,
                demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT,
              ),
            );
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
              })
              .parse(await body(req, 12000000));
            if (
              input.media.mimeType !== "image/png" ||
              input.media.data.length > 5600000
            )
              fail(400, "4MB以下の PNG を指定してください");
            const source = fresh.published ? await effective(fresh) : null;
            let config = source;
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
            const targets = visualTargets(config);
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
          if (action === "posts/source" && method === "POST") {
            assertOwner(user, fresh);
            const { url } = z
              .object({ url: z.string().max(2048) })
              .parse(await body(req));
            return json(
              res,
              await readDriveNote(
                (await ownerToken(fresh)) ||
                  fail(
                    503,
                    "Google に接続してから読み込むか、メモを本文に貼り付けてください",
                  ),
                url,
              ),
            );
          }
          if (action === "posts/propose" && method === "POST") {
            assertOwner(user, fresh);
            const input = z
              .object({
                instruction: z.string().min(1).max(10000),
                source: z.string().max(20000).default(""),
                title: z.string().max(160).default(""),
              })
              .parse(await body(req));
            return json(
              res,
              await intelligence.proposeArticle(
                input.instruction,
                input.source,
                input.title,
                demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT,
              ),
            );
          }
          if (action === "posts" && method === "POST") {
            assertOwner(user, fresh);
            const { content } = z
              .object({ content: postContentSchema })
              .parse(await body(req));
            const at = new Date().toISOString();
            const post: Post = {
              id: randomUUID(),
              shopId: fresh.id,
              draft: content,
              published: null,
              version: 1,
              createdAt: at,
              updatedAt: at,
              updatedBy: user!.email,
            };
            validatePostAddress(post, content, await postsFor(fresh));
            await store.transaction(async () => {
              await store.put("post", post.id, post);
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
                "別の画面で記事が更新されました。一覧を更新してからやり直してください",
              );
            const at = new Date().toISOString();
            if (postAction[2] === "save") {
              const { content } = z
                .object({ content: postContentSchema })
                .parse(raw);
              validatePostAddress(post, content, await postsFor(fresh));
              post.draft = content;
            } else if (postAction[2] === "publish") {
              z.object({ approved: z.literal(true) }).parse(raw);
              if (!fresh.published)
                fail(409, "先にお店の予約ページを公開してください");
              if (fresh.publishingPlanId)
                fail(409, "お店の公開処理を完了してから記事を公開してください");
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
                config: shopSchema.optional(),
                visual: z
                  .object({ id: z.string(), target: z.string() })
                  .optional(),
              })
              .parse(await body(req));
            const current = fresh.published ? await effective(fresh) : null;
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
            const proposed = input.config
              ? {
                  config: input.config,
                  summary: planSummary(current, input.config),
                }
              : await intelligence.propose(
                  visual
                    ? `ペンで選んだ対象 ${input.visual!.target} のみ変更する。予約ルール・料金・所要時間など他の箇所は一切変えない。依頼：${input.text}`
                    : input.text,
                  visual?.config || current,
                  user!.email,
                  demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT,
                );
            if (visual) {
              proposed.config = validateVisualChange(
                visual.config,
                proposed.config,
                input.visual!.target,
              );
              proposed.summary = planSummary(current, proposed.config);
            }
            const plan: Plan = {
              id: randomUUID(),
              shopId: fresh.id,
              base: fresh.revision,
              ...proposed,
              approved: false,
              createdAt: Date.now(),
              checklist,
              source: current,
            };
            if (!plan.summary.length) fail(400, "変更点がありません");
            artifacts(plan.config, '<title></title><div id="root"></div>');
            await store.put("plan", plan.id, plan);
            return json(res, plan);
          }
          const p = action.match(/^plans\/([^/]+)\/(approve|publish)$/);
          if (p && method === "POST") {
            assertOwner(user, fresh);
            const plan = await store.get<Plan>("plan", p[1]);
            if (!plan || plan.shopId !== fresh.id)
              fail(404, "プランがありません");
            if (plan.base !== fresh.revision)
              fail(409, "公開内容が変わりました。プランを作り直してください");
            if (p[2] === "approve") {
              plan.approved = true;
              await store.put("plan", plan.id, plan);
              fresh.draft = plan.config;
              await store.saveShop(fresh);
              return json(res, { ok: true });
            }
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
                );
              } catch (error) {
                fresh.publishingError =
                  error instanceof Error ? error.message : "Google 連携エラー";
                await store.saveShop(fresh);
                console.error(error);
                fail(
                  503,
                  "Google への公開を完了できませんでした。承認済みプランの「公開」を再試行してください。更新中は予約受付を停止しています。",
                );
              }
              delete fresh.publishingPlanId;
              delete fresh.publishingError;
            }
            fresh.published = plan.config;
            fresh.draft = null;
            fresh.history = history;
            fresh.revision++;
            await store.saveShop(fresh);
            await enqueue(fresh, "posts");
            await flush(fresh);
            return json(res, { ok: true, url: `/s/${fresh.slug}` });
          }
          if (action === "operations" && method === "GET") {
            return json(res, {
              bookings: await store.bookings(fresh.id),
              inquiries: await inquiries(fresh),
            });
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
          const reply = action.match(/^inquiries\/([^/]+)\/reply$/);
          if (reply && method === "POST") {
            const { text } = z
              .object({ text: z.string().min(1).max(5000) })
              .parse(await body(req));
            const q = (await inquiries(fresh)).find((q) => q.id === reply[1]);
            if (!q || q.shopId !== fresh.id)
              fail(404, "お問い合わせがありません");
            q.reply = text;
            q.status = "replied";
            await store.put("inquiry", q.id, q);
            await enqueue(fresh, "mail", {
              to: q.email,
              subject: `${fresh.published!.name} からの返信`,
              body: text,
            });
            await flush(fresh);
            return json(res, { ok: true });
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
                fresh.published || fresh.draft || sample,
                fresh.history,
              ),
            );
          fail(404, "見つかりません");
        });
      }
      const preview = path.match(/^\/api\/preview\/([^/]+)(?:\/(.*))?$/);
      if (preview && !publicHost) {
        const shop =
          (await store.shop(preview[1])) || fail(404, "お店がありません");
        await assertOperator(user, shop);
        const plan = await store.get<Plan>(
          "plan",
          url.searchParams.get("plan") || "",
        );
        if (!plan || plan.shopId !== shop.id || !plan.approved)
          fail(404, "承認済みのプランがありません");
        if (method === "GET" && (!preview[2] || preview[2] === "slots")) {
          if (preview[2] === "slots")
            return json(
              res,
              slots(
                plan.config,
                [],
                url.searchParams.get("date") || "",
                url.searchParams.get("menu") || "",
                url.searchParams.get("staff") || undefined,
              ),
            );
          return json(res, {
            config: plan.config,
            shopId: shop.id,
            canEdit: user?.email === shop.owner,
            preview: true,
          });
        }
        if (preview[2] === "bookings" && method === "POST") {
          const b = z
            .object({
              name: z.string().min(1).max(100),
              menuId: z.string(),
              staffId: z.string().optional(),
              start: z.iso.datetime(),
            })
            .parse(await body(req));
          const slot = slots(
            plan.config,
            [],
            new Date(Date.parse(String(b.start)) + 9 * 3600000)
              .toISOString()
              .slice(0, 10),
            b.menuId,
            b.staffId,
          ).find((t) => t.start === b.start);
          if (!slot) fail(409, "予約枠を選び直してください");
          return json(res, {
            ok: true,
            preview: true,
            message:
              "プレビューの予約を確認しました。実データには保存されません。",
          });
        }
        fail(404, "見つかりません");
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
          const customer = () => {
            if (!user || user.role !== "customer" || user.shopId !== shop.id)
              fail(401, "このお店のお客様としてログインしてください");
            return user!;
          };
          if (!action && method === "GET")
            return json(res, {
              config:
                user?.email === shop.owner && !publicHost
                  ? config
                  : { ...config, notificationEmail: undefined },
              shopId: shop.id,
              canEdit: user?.email === shop.owner && !publicHost,
              preview: false,
              recentPosts: livePosts.slice(0, 5).map(summarizePost),
              authUrl: `${origin()}/auth/google?shop=${shop.slug}${hosted ? `&host=${host}` : ""}`,
            });
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
            const input = z
              .object({
                name: z.string().min(1).max(100),
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
              menuId: input.menuId,
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
                `${b.name} 様\n${config.menus.find((m) => m.id === b.menuId)!.name}\n${new Date(b.start).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n予約番号: ${b.id}`,
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
              status: "open",
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
          path.startsWith("/preview") ||
          path.startsWith("/s/"))
      )
        fail(404, "見つかりません");
      if (method !== "GET" && method !== "HEAD")
        fail(405, "利用できない操作です");
      const root = resolve("dist");
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(`${root}/`)) {
        if (path !== "/") fail(404, "見つかりません");
      }
      const manualAsset = /^\/manual\/[a-z0-9-]+\.jpg$/.test(path);
      const asset =
        path.startsWith("/assets/") || path === "/live-audio.js" || manualAsset;
      if (
        !asset &&
        path !== "/" &&
        (publicHost
          ? !/^\/(blogs|announcements)(?:\/[a-z0-9-]+)?$/.test(path)
          : path !== "/manual" &&
            !/^\/(s|preview)\/[^/]+(?:\/(blogs|announcements)(?:\/[a-z0-9-]+)?)?$/.test(
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
          /^\/s\/([^/]+)(?:\/(blogs|announcements)(?:\/([a-z0-9-]+))?)?$/,
        );
        const custom = publicHost
          ? path.match(/^\/(blogs|announcements)(?:\/([a-z0-9-]+))?$/)
          : null;
        const shop =
          hosted || allShops.find((s) => s.slug === local?.[1] && s.published);
        const category = local?.[2] || custom?.[1];
        const key = local?.[3] || custom?.[2];
        if (shop?.published) {
          const posts = publicPosts(await postsFor(shop));
          const base = publicHost ? "" : `/s/${shop.slug}`;
          const shell = data.toString("utf8");
          if (category) {
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
            : "no-cache",
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
  attachLive(server, store, liveConnector);
  return server;
}
