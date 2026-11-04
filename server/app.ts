import { googleCallbackPath } from "../shared/brand.ts";
import { shopExport, exportRows, exportCsv, exportColumns, type ExportTable } from "./data-export.ts";
import { proposeSettings, settingsChanges, type SettingsProposal } from "./settings-ai.ts";
import { renderLanding } from "./landing.ts";
import { renderLegal } from "./legal.ts";
import { hasLegacyNotes } from "./legacy-notes.ts";
import { localizeShell } from "../shared/html.ts";
import { tr, intlLocale, getLocale, listSeparator } from "../shared/i18n.ts";
import { localeForRequest, requestLocale, regionForRequest } from "./i18n.ts";
import { paypalGateway, type PaymentGateway } from "./paypal.ts";
import { paymentService, checkoutView, type Checkout } from "./payments.ts";
import { refundTiersSchema, policyText, refundQuote } from "./payment-domain.ts";
import { articleFiles, articleToolContext } from "./article-files.ts";
import { postImageIds, publishedPostImageIds, wikiPaths } from "./post-images.ts";
import { articleInputSchema, articleMetadataSchema, generateArticleMetadata } from "./post-metadata.ts";
import { staffAccounts, staffAccountKey, type StaffAccount, type StaffMember } from "./staff-accounts.ts";
import { inquiryStatus, inquiryStatusSchema } from "./inquiries.ts";
import { conversations, createConversation, readConversation, searchConversationHistory, conversationContext, appendChatMessage, attachChatPlan, conversationInputSchema, chatReferenceSchema, chatMessageId, type ShopConversation, type ShopChatMessage, type ChatReference, type ChatGeneration } from "./shop-chat.ts";
import { answeredFinalDetails, finalDetailsQuestion, initialInterviewFacts, requestIntentSchema, requestIntentInstruction } from "./request-intent.ts";
import { customerProfileSchema, memberProfile } from "./customer-profile.ts";
import { emailLogin, type LoginMailer } from "./email-login.ts";
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
import { Store, isArchivedShop, type Shop, type User } from "./store.ts";
import { resetShop } from "./shop-reset.ts";
import { driveDesignVersions, demoDesignVersions, preserveDesignVersion, retireDesignVersions, pruneDesignVersions, nextDesignPublication, currentDesignPublication, restoreDesign, sameDesign, parseTargetKey, targetKey, versionsFor, targetLabel, indexedDesignVersions } from "./design-versions.ts";
import { createInitialTheme, initialThemeConfig, initialIntroductionPages, initialThemePreview, type ThemeRun } from "./initial-theme.ts";
import { aggregateCustomers, customerSummaries, customerFilterSchema, customerSince, customerImages, customerAttachmentSchema, normalizeEmail, type CustomerNote, type Inquiry } from "./customers.ts";
import { googleCustomerFiles, memoryCustomerFiles, type CustomerFiles } from "./customer-files.ts";
import { uploadMenuImage, readMenuImage, menuImageResource, validateMenuImages, menuImageSnapshot, type ImageUpload } from "./menu-images.ts";
import { listImages, updateImage, archiveImage, generateLibraryImage } from "./image-library.ts";
import { generateImage } from "./image-generation.ts";
import { managedImageIds } from "./image-references.ts";
import { generateImageSchema, requestImageIdsSchema, requestImageCountLimit, requestImageTotalLimit } from "./image-library-domain.ts";
import { readRequestImages, validateProposedImages, validatePageImage } from "./request-images.ts";
import { addCustomerNote, touchCustomer } from "./customer-notes.ts";
import {
  shopSchema,
  slots,
  sample,
  documents,
  planSummary,
  bookingStaffName,
  menuSelection,
  bookingMenuName,
  ownerStaffId,
  type ShopConfig,
  type Booking,
} from "./domain.ts";
import {
  oauth,
  clients,
  encrypt,
  provision,
  syncConfig,
  sendMail,
  syncPostFiles,
  readDriveText,
  createFolder,
  trashFile,
} from "./google.ts";
import { regionOf, currencyOf, dateIn, formatMinor } from "../shared/region.ts";
import { themeImageIds } from "../shared/presentation.ts";
import { judgeActive, judgeInvite, judgeUntil, judgeAiLimit, judgeEmailDomain, isJudgeEmail, isJudgeCustomerEmail, isAdmin, accessPasswordEnabled, accessPasswordMatches, secretMatches, demoGoogleUnavailable, type DemoGoogle, type JudgeMail, type JudgeUsage } from "./judge.ts";
import { converse, draftText, type ShopData } from "./assistant.ts";
import { attachAssistantLive, liveConfigured, type LiveConnector } from "./assistant-live.ts";
import { aiUsage, setProviderResolver, providerReady, testProvider, openAiStatus, vertexStatus, type AiProvider } from "./llm.ts";
import {
  session,
  login,
  cookie,
  digest,
  equal,
  checkOrigin,
  origin,
  demoEnabled,
  appendCookie,
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
  proposeVisualAppearance,
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
import { liveValue, updateLiveValue, type LiveSection } from "./live-settings.ts";
import { editorIndex, contentHash } from "./editor-sync.ts";
import { createPageWithAI, mergePageWithAI, messageSchema, profileSchema } from "./page-ai.ts";
import { pageSchema, headerSchema, footerSchema } from "./pages.ts";
import { buildStorefront, canonicalBase, storefrontAssetName, storefrontAssetObject, storefrontAssetType, storefrontFile, storefrontGarbage, storefrontObject, storefrontRenderer, storefrontRetainedReleases, storefrontShell, writeStorefront, type StorefrontRelease } from "./storefront-build.tsx";
import { bucketStorefrontFiles, memoryStorefrontFiles, type StorefrontFiles } from "./storefront-files.ts";
import { releaseScopeSchema, scopedSource, scopedConfig, same, type ReleaseScope } from "./pages.ts";
import { calendarGateway, calendarScope, connections, connectOwnerCalendar, bookingCalendars, availableSlots, nextAvailableSlots, type CalendarConnection, type CalendarGateway } from "./calendar.ts";
/**
 * Images attached anywhere in a conversation plus the current ones, newest first within the request limits.
 * Earlier images that were since removed (or would exceed the size limit) are skipped; current ones stay strict.
 */
async function conversationImageIds(store: Store, shop: Shop, chat: { messages: { role: string; detail: { imageIds?: string[] } }[] } | undefined, current: string[]) {
  const earlier = (chat?.messages.filter(message => message.role === "user").flatMap(message => message.detail.imageIds || []) || []).filter(id => !current.includes(id));
  const kept: string[] = [];
  let total = 0;
  for (const id of current) total += (await store.get<ImageUpload>("menuImageUpload", id))?.size || 0;
  for (const id of [...new Set(earlier)].reverse()) {
    if (kept.length + current.length >= requestImageCountLimit) break;
    const record = await store.get<ImageUpload>("menuImageUpload", id);
    if (!record?.complete || record.archived || record.shopId !== shop.id || total + record.size > requestImageTotalLimit) continue;
    kept.unshift(id); total += record.size;
  }
  return [...kept, ...current];
}
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
  themeRunId?: string;
  themeReview?: { attempts: number; approved: boolean };
  chat?: ChatReference;
  local?: boolean;
  scope?: ReleaseScope;
  createdAt: number;
  checklist: string[];
  source?: ShopConfig | null;
  /** The owner's request text, recorded in history.md when the plan is published. */
  request?: string;
};
type Job = {
  id: string;
  shopId: string;
  type: "mail" | "posts";
  to?: string;
  cc?: string[];
  subject?: string;
  body?: string;
  error?: string;
  attempts: number;
  locale?: "ja" | "en";
};
async function body(req: IncomingMessage, limit = 65536) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, tr("入力が長すぎます"));
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return fail(400, tr("入力形式が不正です"));
  }
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function languageUrl(to: string) {
  if (getLocale() !== "en") return to;
  const url = new URL(to, origin());
  url.searchParams.set("lang", "en");
  return to.startsWith("/") ? url.pathname + url.search + url.hash : url.href;
}
function redirect(res: ServerResponse, to: string) {
  // External OAuth URLs retain Google's own query parameters.
  if (to.startsWith("/") || new URL(to, origin()).pathname === "/auth/complete") to = languageUrl(to);
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
    assistant?: typeof converse;
    initialTheme?: typeof createInitialTheme;
    settings?: typeof proposeSettings;
    visualAppearance?: typeof proposeVisualAppearance;
  } = { propose, proposeArticle, identifyVisual, explainSystem, visualAppearance: proposeVisualAppearance },
  calendar: CalendarGateway = calendarGateway,
  customerFiles?: CustomerFiles,
  paymentGateway: PaymentGateway = paypalGateway(),
  liveConnector?: LiveConnector,
  loginMailer?: LoginMailer,
  storefrontFiles?: StorefrontFiles,
) {
  const crmFiles = customerFiles || (store.memory ? memoryCustomerFiles(store) : googleCustomerFiles);
  const pageFiles = storefrontFiles || (store.memory ? memoryStorefrontFiles(store) : bucketStorefrontFiles());
  const ownerToken = (shop: Shop) => store.ownerToken(shop);
  const customerEmailLogin = emailLogin(store, loginMailer || (async (shop, to, subject, text) => {
    if (shop.judge) { await enqueue(shop, "mail", { to, subject, body: text }); return; }
    const token = await ownerToken(shop) || fail(503, tr("店主の Google 再接続が必要です"));
    await sendMail(token, to, subject, text);
  }));
  async function imageResponse(req: IncomingMessage, res: ServerResponse, shop: Shop, imageId: string, url: URL) {
    const view = z.enum(["original", "display", "thumbnail"]).parse(url.searchParams.get("view") || "original");
    const image = await menuImageResource(store, shop, imageId, crmFiles, async () => store.memory ? "" : await ownerToken(shop) || fail(503, tr("店主の Google 再接続が必要です")), view);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("ETag", image.etag);
    const tags = String(req.headers["if-none-match"] || "").split(",").map(tag => tag.trim().replace(/^W\//, ""));
    if (tags.includes(image.etag) || tags.includes("*")) { res.writeHead(304); res.end(); return; }
    const data = await image.read();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  }
  // The administrator's provider choice applies to every shop; a short cache keeps model calls cheap.
  type ProviderSetting = { provider: AiProvider; changedAt: string; changedBy: string };
  let providerCache: { value: AiProvider; at: number } | undefined;
  setProviderResolver(async () => {
    if (providerCache && Date.now() - providerCache.at < 10000) return providerCache.value;
    const value = (await store.get<ProviderSetting>("setting", "aiProvider"))?.provider || "vertex";
    providerCache = { value, at: Date.now() };
    return value;
  });
  /** Judge shops nest under the operator's "gemihub judges/<judge>" Drive folder. */
  async function judgeParent(shop: Shop, token: string) {
    if (!shop.judge) return undefined;
    const existing = await store.get<{ id: string }>("judgeFolder", shop.owner);
    if (existing) return existing.id;
    return store.locked("judge-folders", async () => {
      const again = await store.get<{ id: string }>("judgeFolder", shop.owner);
      if (again) return again.id;
      const connection = await store.get<DemoGoogle>("demoGoogle", "current") || fail(503, demoGoogleUnavailable());
      let root = connection.rootFolderId;
      if (!root) {
        root = await createFolder(token, "gemihub judges");
        await store.put("demoGoogle", "current", { ...connection, rootFolderId: root });
      }
      const id = await createFolder(token, shop.owner.split("@")[0], root);
      await store.put("judgeFolder", shop.owner, { id });
      return id;
    });
  }
  /** Judge AI usage: one quota per judge, never restored by a reset. */
  const chargeJudge = (email: string) => store.locked(`judge-usage:${email}`, async () => {
    const usage = await store.get<JudgeUsage>("judgeUsage", email) || { email, count: 0 };
    if (usage.count >= judgeAiLimit()) fail(429, tr("審査用のAI利用回数の上限に達しました"));
    await store.put("judgeUsage", email, { ...usage, count: usage.count + 1, lastUsedAt: new Date().toISOString() });
  });
  /** The shop's spec.md and history.md as stored in Drive, generated from the settings when not yet stored. */
  async function shopDocuments(shop: Shop) {
    const generated = documents(await effective(shop), shop.history);
    const token = shop.google ? await ownerToken(shop) : undefined;
    if (!shop.google || !token) return generated;
    try {
      const [spec, history] = await Promise.all([readDriveText(token, shop.google.specId), readDriveText(token, shop.google.historyId)]);
      return { spec: spec.trim() ? spec : generated.spec, history: history.trim() ? history : generated.history };
    } catch (error) {
      console.error(error);
      return generated;
    }
  }
  /** Read-only material for the assistant's research layer: documents and operator-visible records. */
  async function shopData(shop: Shop): Promise<ShopData> {
    const config = await effective(shop);
    const now = new Date();
    return {
      documents: await shopDocuments(shop),
      today: dateIn(now, regionOf(config).timeZone),
      records: async kind => {
        if (kind === "bookings") return (await store.bookings(shop.id)).map(booking => ({
          id: booking.id, start: booking.start, end: booking.end, status: booking.status,
          menu: bookingMenuName(config, booking),
          staff: bookingStaffName(config, booking.staffId),
          customer: booking.name, email: booking.customer, price: booking.price,
          ...(booking.payment ? { paid: booking.payment.amount, refund: booking.payment.cancellation ? { amount: booking.payment.cancellation.amount, status: booking.payment.cancellation.status } : undefined } : {}),
        }));
        if (kind === "inquiries") return (await inquiries(shop)).map(inquiry => ({ at: inquiry.at, name: inquiry.name, email: inquiry.email, status: inquiry.status, message: inquiry.message.slice(0, 500), replied: !!inquiry.reply }));
        return customerSummaries(aggregateCustomers(await store.bookings(shop.id), await inquiries(shop), await store.records<CustomerNote>("customerNote", shop), now, undefined, await store.records<import("./customers.ts").CustomerRecord>("customer", shop)));
      },
    };
  }
  const provisionShop = async (shop: Shop, config: ShopConfig, token: string) =>
    provision(shop, config, token, await judgeParent(shop, token));
  const operator = async (user: User | undefined, shop: Shop) => {
    if (!user || user.authMethod === "email" || isArchivedShop(shop)) return false;
    if (user.email === shop.owner) return true;
    const account = await store.get<StaffAccount>("staffAccount", staffAccountKey(shop.id, user.email));
    if (account && !shop.published?.staff.some(staff => staff.id === account.staffId)) return false;
    const member = await store.get<StaffMember>("member", `${shop.id}:${user.email}`);
    return member?.accepted === true && member.status !== "revoked";
  };
  const assertOperator = async (user: User | undefined, shop: Shop) => {
    if (!(await operator(user, shop)))
      fail(403, tr("運営メンバーのみ利用できます"));
  };
  const assertOwner = (user: User | undefined, shop: Shop) => {
    if (isArchivedShop(shop) || user?.authMethod === "email" || user?.email !== shop.owner) fail(403, tr("店主のみ利用できます"));
  };
  const inquiries = (shop: Shop) => store.records<Inquiry>("inquiry", shop);
  const postsFor = (shop: Shop) => store.records<Post>("post", shop);
  // A missing or unreadable image is left out of the public page instead of blocking every save.
  async function storefrontImages(shop: Shop, posts: Post[]) {
    const token = store.memory ? "" : await ownerToken(shop) || "";
    const images: Record<string, import("./menu-image-domain.ts").MenuImageData> = {};
    for (const id of new Set([...managedImageIds(shop.published!), ...publishedPostImageIds(posts)])) {
      try { images[id] = await readMenuImage(store, shop, id, crmFiles, token, "display"); }
      catch (error) { console.warn(`Storefront ${shop.id}: image ${id} left out of the public page`, error); }
    }
    return images;
  }
  async function savePublicShop(shop: Shop) {
    let dropped: StorefrontRelease[] = [];
    if (shop.published) {
      try {
        const posts = await postsFor(shop);
        const build = buildStorefront(shop, publicPosts(posts), origin(), await storefrontShell(), await storefrontImages(shop, posts));
        const release = await writeStorefront(pageFiles, shop.id, build);
        const history = [shop.storefrontRelease, ...shop.storefrontPrevious || []].filter((item): item is StorefrontRelease => !!item && item.id !== release.id);
        shop.storefrontPrevious = history.slice(0, storefrontRetainedReleases);
        dropped = history.slice(storefrontRetainedReleases);
        shop.storefrontRelease = release;
        storefrontRetry.delete(shop.id);
      } catch (error) {
        console.error(error);
        fail(503, tr("公開ページの保存に失敗しました。以前の公開ページは保持しています。同じ操作を再試行してください。"));
      }
    }
    await store.saveShop(shop);
    // Only releases older than the retained ones are removed; a failed cleanup is retried on the next release.
    if (dropped.length) {
      const kept = [shop.storefrontRelease!, ...shop.storefrontPrevious || []];
      for (const path of storefrontGarbage(shop.id, kept, dropped)) await pageFiles.remove(path).catch(error => console.warn(`Storefront ${shop.id}: could not delete ${path}`, error));
    }
  }
  // Shops without a release from the current generator are rebuilt by the background loop; failures back off.
  const storefrontRetry = new Map<string, { at: number; delay: number }>();
  const storefrontCurrent = (shop: Shop) => !!shop.storefrontRelease && shop.storefrontRelease.renderer === storefrontRenderer;
  async function ensureStorefront(shop: Shop) {
    if (!shop.published || storefrontCurrent(shop) || shop.publishingPlanId) return;
    const retry = storefrontRetry.get(shop.id);
    if (retry && retry.at > Date.now()) return;
    try { await savePublicShop(shop); }
    catch (error) {
      const delay = Math.min((retry?.delay || 30000) * 2, 3600000);
      storefrontRetry.set(shop.id, { at: Date.now() + delay, delay });
      throw error;
    }
  }
  const effective = async (shop: Shop) => {
    if (shop.publishingPlanId)
      fail(503, tr("予約ページを更新中です。しばらくしてからお試しください。"));
    return shop.published!;
  };
  async function initialPlanFacts(plan: Plan, shop: Shop): Promise<Plan> {
    if (shop.published || !plan.requiresSetup || !plan.chat) return plan;
    const chat = await readConversation(store, shop, shop.owner, plan.chat.id).catch(error => { if (error?.status === 404) return undefined; throw error; });
    if (!chat) return plan;
    const reply = chat.messages.find(message => message.role === "assistant" && message.requestId === plan.chat!.requestId);
    if (!reply) return plan;
    const facts = initialInterviewFacts(chat.messages.filter(message => message.sequence <= reply.sequence));
    let config = plan.config;
    if (facts.articles) config = { ...config, appearance: { accent: "sage", layout: "standard", imageUrl: "", ...config.appearance, articles: facts.articles } };
    config = initialIntroductionPages(config, facts.introductions);
    return JSON.stringify(config) === JSON.stringify(plan.config) ? plan : { ...plan, config, summary: planSummary(null, config) };
  }
  async function enqueue(
    shop: Shop,
    type: Job["type"],
    data: Partial<Job> = {},
    id: string = randomUUID(),
  ) {
    // Judge access never sends mail; the judge menu lists what would have been sent.
    if (shop.judge && type === "mail") {
      if (await store.get("judgeMail", id)) return;
      await store.put("judgeMail", id, { id, shopId: shop.id, owner: shop.owner, to: data.to || "", ...(data.cc?.length ? { cc: data.cc } : {}), subject: data.subject || "", body: data.body || "", at: new Date().toISOString() } satisfies JudgeMail);
      return;
    }
    if (!shop.google) return;
    if(await store.get("job",id))return;
    await store.put("job", id, {
      id,
      shopId: shop.id,
      type,
      attempts: 0,
      locale: getLocale(),
      ...data,
    });
  }
  async function flush(shop: Shop) {
    if (!shop.google) return;
    const token = await ownerToken(shop);
    if (!token) return;
    for (const job of (await store.list<Job>("job")).filter(
      // Post pages wait for an in-flight publish/restore; mail is never held back by it.
      (j) => j.shopId === shop.id && !(shop.publishingPlanId && j.type === "posts"),
    )) {
      await requestLocale.run(job.locale || "ja", async () => {
        try {
          if (job.type === "posts") {
            const posts=await postsFor(shop);
            await syncPostFiles(shop,posts,token,async()=>await store.saveShop(shop),config=>menuImageSnapshot(store,shop,config,crmFiles,token,publishedPostImageIds(posts)));
          } else await sendMail(token, job.to!, job.subject!, job.body!, job.cc);
          await store.delete("job", job.id);
        } catch (err) {
          job.error = err instanceof Error ? err.message : tr("連携エラー");
          job.attempts++;
          await store.put("job", job.id, job);
        }
      });
    }
  }
  async function notify(
    shop: Shop,
    config: ShopConfig,
    to: string,
    subject: string,
    text: string,
    cc?: string[],
  ) {
    if (cc) {
      const recipients = new Map(cc.map(address => [address.toLowerCase(), address]));
      recipients.delete(to.toLowerCase());
      await enqueue(shop, "mail", { to, cc: [...recipients.values()], subject, body: text });
      return;
    }
    for (const address of new Set([to, config.notificationEmail]))
      await enqueue(shop, "mail", { to: address, subject, body: text });
  }
  const payments = paymentService(store, paymentGateway, async (booking, event) => {
    const key = `${booking.id}:${event}`;
    if (await store.get("paymentNotice", key)) return;
    const shop = await store.shop(booking.shopId);
    if (!shop?.published) return;
    const config = await effective(shop);
    const refund = booking.payment?.cancellation;
    const status = refund ? { completed: tr("返金完了"), pending: tr("返金確認中"), awaiting_funds: tr("お店で返金手続きの確認中"), retrying: tr("返金処理中（自動で再確認します）"), not_required: tr("返金なし"), manual_review: tr("返金の確認が必要です。お店にお問い合わせください") }[refund.status] : booking.status === "no_show" ? tr("無断キャンセルを記録しました（返金なし）") : tr("支払い完了・予約確定");
    await store.transaction(async () => {
      await notify(shop, config, booking.customer, `${config.name} ${refund ? tr("予約キャンセル・返金") : booking.status === "no_show" ? tr("予約の状態が変更されました") : tr("ご予約を承りました")}`,
        tr("{0} 様\n予約: {1}\nメニュー: {2}{3}\n支払額: {4}\n{5}{6}", booking.name, new Date(booking.start).toLocaleString(intlLocale(), { timeZone: regionOf(config).timeZone, timeZoneName: "short" }), bookingMenuName(config, booking), booking.message ? tr("\nメッセージ: {0}", booking.message) : "", formatMinor(booking.payment!.amount, booking.payment!.currency, intlLocale()), status, refund ? tr("\n返金額: {0}", formatMinor(refund.amount, booking.payment!.currency, intlLocale())) : tr("\n返金条件: {0}", policyText(booking.payment!.policy))), event === "paid" ? [shop.owner, config.notificationEmail] : undefined);
      await store.put("paymentNotice", key, { at: new Date().toISOString() });
    });
  });
  async function publishConfiguration(fresh: Shop, plan: Plan, publication = fresh.publication || (fresh.published ? "public" : "provisional")) {
    if (fresh.lastPublishedPlanId === plan.id) return { ok: true, url: `/s/${fresh.slug}` };
    if (plan.base !== fresh.revision) fail(409, tr("本番の内容が変わりました。最新の内容を読み直してください"));
    if (!plan.approved) fail(409, tr("先にプランを承認してください"));
    if (
      fresh.published && fresh.google &&
      !fresh.publishingPlanId &&
      JSON.stringify(plan.source) !==
        JSON.stringify(await effective(fresh))
    )
      fail(
        409,
        tr("お店の設定が更新されています。最新の内容でプランを作り直してください"),
      );
    if (fresh.publishingPlanId && fresh.publishingPlanId !== plan.id)
      fail(409, tr("公開中のプランを先に完了してください"));
    await validateMenuImages(store, fresh, plan.config);
    const history = [
      ...fresh.history,
      {
        at: new Date().toISOString(),
        summary: plan.summary.join(listSeparator("、")),
        ...(plan.request ? { request: plan.request } : {}),
      },
    ];
    // Operational saves (menus, hours, staff…) leave the design untouched and must not consume version slots.
    const designChanged = !fresh.published || !sameDesign(fresh.published, plan.config);
    const token = await ownerToken(fresh);
    const versions = token ? driveDesignVersions(token) : demoDesignVersions(store);
    if (!demoEnabled() || token) {
      if (!token) fail(503, tr("店主の Google 再接続が必要です"));
      fresh.publishingPlanId = plan.id;
      await store.saveShop(fresh);
      try {
        fresh.google = await provisionShop(fresh, plan.config, token);
        await store.saveShop(fresh);
        if (designChanged) await preserveDesignVersion(fresh, plan.id, versions, async () => store.saveShop(fresh));
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
          error instanceof Error ? error.message : tr("Google 連携エラー");
        await store.saveShop(fresh);
        console.error(error);
        fail(
          503,
          tr("保存・反映を完了できませんでした。同じ画面から再試行してください。処理中は予約受付を停止しています。"),
        );
      }
      delete fresh.publishingPlanId;
      delete fresh.publishingError;
    } else if (designChanged) {
      await preserveDesignVersion(fresh, plan.id, versions, async () => store.saveShop(fresh));
    }
    const entry = history.at(-1)!;
    if (designChanged) nextDesignPublication(fresh, entry.at, entry.summary);
    fresh.published = plan.config;
    fresh.publication = publication;
    fresh.draft = null;
    fresh.history = history;
    fresh.revision++;
    fresh.lastPublishedPlanId = plan.id;
    retireDesignVersions(fresh);
    await savePublicShop(fresh);
    await pruneDesignVersions(fresh, versions, async () => store.saveShop(fresh)).catch(console.error);
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
  const server = createServer((req, res) => requestLocale.run(localeForRequest(req), async () => {
    res.setHeader("Content-Language", getLocale());
    res.setHeader("Vary", "Cookie, X-Gemihub-Language, Accept-Language");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url || "/", origin());
      const path = url.pathname;
      const method = req.method || "GET";
      const host = (req.headers.host || "").split(":")[0].toLowerCase();
      const appHost = new URL(origin()).hostname;
      if (path === "/lp" && host === appHost && (method === "GET" || method === "HEAD")) {
        let shell: string;
        try { shell = await readFile(resolve("dist/index.html"), "utf8"); }
        catch { fail(404, tr("画面を表示するには npm run build を実行してください")); }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(method === "HEAD" ? undefined : renderLanding(shell!));
        return;
      }
      if (path === "/sw.js" && host === appHost && (method === "GET" || method === "HEAD")) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(method === "HEAD" ? undefined : await readFile(resolve("dist/sw.js"), "utf8"));
        return;
      }
      if ((path === "/policy" || path === "/terms") && host === appHost && (method === "GET" || method === "HEAD")) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(method === "HEAD" ? undefined : renderLegal(path === "/policy" ? "policy" : "terms"));
        return;
      }
      // Judge shops disappear when judge access ends; a reset archives the previous shop.
      const allShops = (await store.list<Shop>("shop")).filter(shop => !isArchivedShop(shop) && (!shop.judge || judgeActive()));
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
      if (host !== appHost && !hosted) fail(404, tr("お店が見つかりません"));
      const publicHost = !!hosted;
      const s = await session(store, req);
      const user = s?.user && isJudgeEmail(s.user.email) && !judgeActive() ? undefined : s?.user;
      const savedJudgeOwner = async () => {
        const id = cookie(req, "gemihub_judge_owner");
        if (!id || !judgeActive()) return;
        const saved = await store.get<{ user: User; expires: number }>("session", digest(id));
        if (!saved?.user.judge || saved.expires <= Date.now()) return;
        const owner = await store.get<User>("user", saved.user.email);
        const shop = owner?.shopId ? await store.shop(owner.shopId) : undefined;
        if (!owner?.judge || owner.role !== "owner" || owner.shopId !== saved.user.shopId || !shop?.judge || shop.owner !== owner.email) return;
        if (user && isJudgeCustomerEmail(user.email) && user.shopId !== shop.id) return;
        return { id, expires: saved.expires, owner, shop };
      };
      if (user?.judge) {
        // Judge AI calls share one quota per judge, charged once per request before the first model call.
        aiUsage.enterWith({ charge: () => chargeJudge(user.email) });
      }
      // A shop published before static releases is converted once; repeated failures wait for the backoff instead of rebuilding per request.
      const firstStorefront = async (id: string) => {
        if ((storefrontRetry.get(id)?.at || 0) > Date.now()) { res.setHeader("Retry-After", "60"); fail(503, tr("公開ページを読み込めません。しばらくしてからお試しください。")); }
        const shop = await store.locked(id, async () => {
          const current = await store.shop(id) || fail(404, tr("お店がありません"));
          assertStorefrontAccess(current);
          if (!current.storefrontRelease) await ensureStorefront(current);
          return current;
        });
        if (!shop.storefrontRelease) { res.setHeader("Retry-After", "60"); fail(503, tr("公開ページを読み込めません。しばらくしてからお試しください。")); }
        return shop;
      };
      const assertStorefrontAccess = (shop: Shop) => {
        // A judge's own trial customer may use the judge's provisional shop; nobody else may.
        const trialCustomer = !!shop.judge && !!user && isJudgeCustomerEmail(user.email) && user.shopId === shop.id;
        if (shop.publication === "provisional" && (user?.email !== shop.owner || user?.authMethod === "email") && !trialCustomer)
          fail(user ? 403 : 401, tr("仮公開中のため、このページを用意したユーザーのログインが必要です"));
        if (shop.publication === "provisional") {
          res.setHeader("Vary", "Cookie, X-Gemihub-Language, Accept-Language");
          res.setHeader("X-Robots-Tag", "noindex, nofollow");
        }
        if (shop.judge) res.setHeader("X-Robots-Tag", "noindex, nofollow");
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
        if (++entry.n > 60) fail(429, tr("少し時間をおいてお試しください"));
        rate.set(key, entry);
        if (rate.size > 10000)
          for (const [k, v] of rate) if (v.until < Date.now()) rate.delete(k);
      }
      if (path === "/api/session" && method === "GET") {
        const judgeOwner = !publicHost ? await savedJudgeOwner() : undefined;
        return json(res, {
          user: user
            ? {
                email: user.email,
                name: user.name,
                role: user.role,
                shopId: user.shopId,
                ...(user.role === "owner" && user.legacyNotes ? { legacyNotes: true } : {}),
                ...(user.role === "owner" && user.accessPending ? { accessPending: true } : {}),
                ...(user.judge ? { judge: true } : {}),
                ...(user.role === "owner" && isAdmin(user.email) ? { admin: true } : {}),
              }
            : null,
          demo: demoEnabled(),
          hosted: hosted?.slug,
          invite: accessPasswordEnabled(),
          assistantVoice: liveConfigured(),
          ...(user && isJudgeCustomerEmail(user.email) ? { judgeCustomer: true } : {}),
          ...(judgeOwner && judgeOwner.owner.email !== user?.email ? { judgeOwnerAvailable: true } : {}),
        });
      }
      if (path === "/api/legacy-notes/check" && method === "POST" && !publicHost) {
        if (user?.role !== "owner") fail(403, tr("店主としてログインしてください"));
        const saved = await store.get<User>("user", user.email);
        if (!saved?.refreshToken) fail(403, tr("Google のアクセス権を再承認してください"));
        let accessToken: string;
        try { accessToken = (await clients(saved.refreshToken).auth.getAccessToken()).token || ""; }
        catch { fail(401, tr("Google のアクセス権を再承認してください")); }
        if (await hasLegacyNotes(accessToken)) fail(409, tr("旧設定が残っています。kiokuflowでデータの引き継ぎを完了してから、もう一度確認してください。"));
        const own = allShops.find(shop => shop.owner === user.email) || await store.createShop(user.email, regionForRequest(req));
        const updated: User = { ...saved, shopId: own.id, legacyNotes: false };
        await store.put("user", user.email, updated);
        await login(store, res, updated);
        return json(res, { success: true });
      }
      if (path === "/api/logout" && method === "POST") {
        const id = cookie(req, "gemihub_session");
        if (id) await store.delete("session", digest(id));
        const secure = origin().startsWith("https:") ? "; Secure" : "";
        appendCookie(res, `gemihub_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
        appendCookie(res, `gemihub_judge_owner=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
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
          fail(400, tr("ログインの有効期限が切れました"));
        await login(store, res, ticket.user);
        return redirect(res, `${publicHost ? "/" : `/s/${ticket.slug}`}?pane=mine`);
      }
      const staffLogin = path.match(/^\/api\/staff-login\/([^/]+)$/);
      if (staffLogin && method === "GET" && !publicHost) {
        const shop = allShops.find(s => s.id === staffLogin[1] && s.published) || fail(404, tr("お店がありません"));
        return json(res, { name: shop.published!.name, configured: !!process.env.GOOGLE_CLIENT_ID });
      }
      if (path === "/auth/google" && method === "GET" && !publicHost) {
        if (!process.env.GOOGLE_CLIENT_ID)
          fail(
            503,
            tr("Google ログインはサーバーで設定してください。ローカル確認にはデモモードを利用できます。"),
          );
        const staffShopId = url.searchParams.get("staffShop");
        if (staffShopId) {
          const shop = allShops.find(s => s.id === staffShopId && s.published) || fail(404, tr("お店がありません"));
          const state = randomBytes(32).toString("base64url");
          const verifier = randomBytes(48).toString("base64url");
          await store.put("oauth", digest(state), { verifier, locale:getLocale(), staffShopId: shop.id, expires: Date.now() + 600000 });
          res.setHeader("Set-Cookie", `gemihub_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`);
          return redirect(res, oauth().generateAuthUrl({ access_type: "offline", prompt: "consent select_account", scope: ["openid", "email", "profile", calendarScope], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" as never }));
        }
        const slug = url.searchParams.get("shop");
        const shop = slug
          ? allShops.find((s) => s.slug === slug && s.published)
          : undefined;
        if (slug && !shop) fail(404, tr("公開されたお店がありません"));
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
            fail(400, tr("戻り先が不正です"));
          returnHost = target;
        }
        const state = randomBytes(32).toString("base64url");
        const verifier = randomBytes(48).toString("base64url");
        await store.put("oauth", digest(state), {
          verifier,
          locale:getLocale(),
          shopId: shop?.id,
          returnHost,
          expires: Date.now() + 600000,
        });
        res.setHeader(
          "Set-Cookie",
          `gemihub_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`,
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
                  calendarScope,
                ],
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256" as never,
          }),
        );
      }
      if (path === googleCallbackPath && method === "GET" && !publicHost) {
        const state = url.searchParams.get("state") || "";
        if (!state || !equal(state, cookie(req, "gemihub_oauth") || ""))
          fail(400, tr("ログインを最初からやり直してください"));
        const key = digest(state);
        const pending = await store.take<{
          verifier: string;
          locale?: "ja" | "en";
          shopId?: string;
          returnHost: string;
          expires: number;
          staffShopId?: string;
          calendarShopId?: string;
          email?: string;
          staffId?: string;
          adminDemo?: boolean;
        }>("oauth", key);
        if (!pending || pending.expires < Date.now())
          fail(400, tr("ログインの有効期限が切れました"));
        if (pending.locale) { requestLocale.enterWith(pending.locale); res.setHeader("Content-Language", pending.locale); }
        if (url.searchParams.has("error")) fail(400, pending.staffShopId || pending.calendarShopId
          ? tr("Google ログインとカレンダーの利用許可を完了してください。スタッフ用ログインからやり直せます。")
          : tr("Google ログインと必要なアクセスの許可を完了してください。ログインを最初からやり直してください。"));
        if (pending.staffShopId) {
          const identity = await calendar.exchange(url.searchParams.get("code") || "", pending.verifier);
          return await store.locked(pending.staffShopId, async () => {
            const shop = await store.shop(pending.staffShopId!) || fail(404, tr("お店がありません"));
            const key = staffAccountKey(shop.id, identity.email);
            const account = (await staffAccounts(store, shop)).find(account => account.email === identity.email) || fail(403, tr("このGoogleアカウントはスタッフに登録されていません。店主にメールアドレスの登録を依頼してください。"));
            const config = await effective(shop);
            if (!config?.staff.some(staff => staff.id === account.staffId)) fail(403, tr("担当スタッフが削除されています。店主に確認してください。"));
            if ((await connections(store, shop)).some(connection => connection.staffId === account.staffId && connection.email !== identity.email)) fail(409, tr("この担当スタッフは別のアカウントと連携されています。"));
            await store.put("calendar", key, { shopId: shop.id, email: identity.email, staffId: account.staffId, refreshToken: identity.refreshToken });
            if (identity.email !== shop.owner) {
              const member = await store.get<StaffMember>("member", key) || fail(403, tr("スタッフの登録がありません"));
              await store.put("member", key, { ...member, accepted: true, status: "accepted", acceptedAt: member.acceptedAt || new Date().toISOString() });
            }
            await login(store, res, { email: identity.email, name: identity.name || config.staff.find(staff => staff.id === account.staffId)!.name, role: identity.email === shop.owner ? "owner" : "customer", shopId: shop.id });
            return redirect(res, `/?shop=${encodeURIComponent(shop.id)}&tab=bookings&staffLogin=connected`);
          });
        }
        if (pending.calendarShopId) {
          if (!user || user.email !== pending.email) fail(403, tr("連携を開始したアカウントでログインしてください"));
          return await store.locked(pending.calendarShopId, async () => {
            const shop = await store.shop(pending.calendarShopId!) || fail(404, tr("お店がありません"));
            await assertOperator(user, shop);
            const config = await effective(shop);
            if (!config?.staff.some(s => s.id === pending.staffId)) fail(400, tr("担当者を選び直してください"));
            if (pending.staffId === ownerStaffId && user.email !== shop.owner) fail(403, tr("店主のみ利用できます"));
            const identity = await calendar.exchange(url.searchParams.get("code") || "", pending.verifier);
            if (identity.email !== pending.email) fail(403, tr("ログイン中と同じ Google アカウントを選択してください"));
            if ((await connections(store, shop)).some(c => c.staffId === pending.staffId && c.email !== user.email)) fail(409, tr("この担当者は別のメンバーが連携済みです"));
            await store.put("calendar", `${shop.id}:${user.email}`, { shopId: shop.id, email: user.email, staffId: pending.staffId, refreshToken: identity.refreshToken });
            return redirect(res, "/?calendar=connected");
          });
        }
        const auth = oauth();
        const { tokens } = await auth.getToken({
          code: url.searchParams.get("code") || "",
          codeVerifier: pending.verifier,
        });
        if (pending.adminDemo) {
          // The operator's demo Drive/Calendar connection stays separate from their own shop token.
          if (!user || !isAdmin(user.email) || user.email !== pending.email) fail(403, tr("連携を開始したアカウントでログインしてください"));
          const identity = (await auth.verifyIdToken({ idToken: tokens.id_token!, audience: process.env.GOOGLE_CLIENT_ID })).getPayload();
          if (!identity?.email_verified || !identity.email) fail(403, tr("確認済みの Google アカウントが必要です"));
          if (!tokens.scope?.split(" ").includes(calendarScope)) fail(400, tr("Google Calendar の空き状況へのアクセスを承認してください"));
          if (!tokens.refresh_token) fail(400, tr("Google のアクセス権を再承認してください"));
          const previous = await store.get<DemoGoogle>("demoGoogle", "current");
          const email = identity.email.toLowerCase();
          await store.put("demoGoogle", "current", {
            email, refreshToken: encrypt(tokens.refresh_token), connectedAt: new Date().toISOString(), connectedBy: user.email,
            ...(previous?.email === email && previous.rootFolderId ? { rootFolderId: previous.rootFolderId } : {}),
          } satisfies DemoGoogle);
          return redirect(res, "/admin?google=connected");
        }
        const identity = await auth.verifyIdToken({
          idToken: tokens.id_token!,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const profile = identity.getPayload();
        if (!profile?.email_verified || !profile.email)
          fail(403, tr("確認済みの Google アカウントが必要です"));
        const email = profile.email.toLowerCase();
        const existing = await store.get<User>("user", email);
        const u: User = {
          email,
          name: profile.name || email,
          role: pending.shopId ? "customer" : "owner",
          shopId: pending.shopId,
        };
        if (!pending.shopId) {
          if (!tokens.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.send"))
            fail(400, tr("店主ログインでは、Gmail のメール送信も許可してください。"));
          if (!tokens.scope?.split(" ").includes(calendarScope))
            fail(400, tr("店主ログインでは、Google Calendar の空き状況へのアクセスも許可してください。"));
          u.refreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refreshToken;
          u.calendarRefreshToken = tokens.refresh_token ? u.refreshToken : existing?.calendarRefreshToken;
          if (!u.refreshToken || !u.calendarRefreshToken)
            fail(400, tr("Google のアクセス権を再承認してください"));
          u.legacyNotes = await hasLegacyNotes(tokens.access_token || "");
          // Do not create an empty shop just because an existing note user signed in.
          // While sign-up is invitation-only, a new owner first enters the invitation password.
          const existingShop = allShops.find((s) => s.owner === email);
          if (!existingShop && !u.legacyNotes && accessPasswordEnabled()) u.accessPending = true;
          const own = existingShop
            || (!u.legacyNotes && !u.accessPending ? await store.createShop(email, regionForRequest(req)) : undefined);
          u.shopId = own?.id;
          await store.put("user", email, u);
          if (own?.published && !u.legacyNotes) await store.locked(own.id, async () => {
            const current = await store.shop(own.id);
            if (current?.published && !isArchivedShop(current)) await connectOwnerCalendar(store, current, current.published);
          });
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
        if (!pending.shopId && u.legacyNotes) {
          return redirect(res, "/settings/migration");
        }
        return redirect(
          res,
          pending.shopId
            ? `/s/${(await store.shop(pending.shopId))!.slug}?pane=mine`
            : "/",
        );
      }
      const secureCookie = origin().startsWith("https:") ? "; Secure" : "";
      const restoreJudgeOwner = async () => {
        const saved = await savedJudgeOwner();
        if (!saved) return;
        const current = cookie(req, "gemihub_session");
        if (current && current !== saved.id && user && isJudgeCustomerEmail(user.email)) await store.delete("session", digest(current));
        appendCookie(res, `gemihub_session=${saved.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor((saved.expires - Date.now()) / 1000))}${secureCookie}`);
        appendCookie(res, `gemihub_judge_owner=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie}`);
        return saved;
      };
      const failedAttempt = (key: string, limit: number, windowMs: number) => {
        const current = rate.get(key);
        const entry = current && current.until > Date.now() ? current : { n: 0, until: Date.now() + windowMs };
        if (entry.n >= limit) fail(429, tr("少し時間をおいてお試しください"));
        return () => { entry.n++; rate.set(key, entry); };
      };
      if (path === "/api/access/verify" && method === "POST" && !publicHost) {
        if (user?.role !== "owner" || !user.accessPending) fail(403, tr("招待パスワードの入力は不要です"));
        const input = z.object({ password: z.string().min(1).max(256) }).parse(await body(req));
        const recordFailure = failedAttempt(`access:${req.socket.remoteAddress}:${user.email}`, 5, 600000);
        if (!accessPasswordMatches(input.password)) { recordFailure(); fail(401, tr("招待パスワードが違います")); }
        const saved = await store.get<User>("user", user.email) || fail(403, tr("Google のアクセス権を再承認してください"));
        const own = allShops.find(shop => shop.owner === user.email) || await store.createShop(user.email, regionForRequest(req));
        const updated: User = { ...saved, shopId: own.id, accessPending: false };
        await store.put("user", user.email, updated);
        const old = cookie(req, "gemihub_session");
        if (old) await store.delete("session", digest(old));
        await login(store, res, updated);
        return json(res, { success: true });
      }
      if (user?.role === "owner" && user.accessPending && !publicHost && path.startsWith("/api/") && path !== "/api/logout")
        fail(409, tr("招待パスワードを入力してください"));
      const judgeRoute = path.match(/^\/judge\/([^/]+)$/);
      if (judgeRoute && !publicHost && (method === "GET" || method === "HEAD")) {
        if (!judgeActive() || !secretMatches(judgeRoute[1], judgeInvite())) fail(404, tr("見つかりません"));
        // A fresh browser opens the invitation in English unless a language was chosen.
        if (!url.searchParams.has("lang") && !cookie(req, "gemihub_locale")) return redirect(res, `${path}?lang=en`);
      }
      if (path === "/api/judge/start" && method === "POST" && !publicHost) {
        const input = z.object({ invite: z.string().max(512) }).parse(await body(req));
        if (!judgeActive() || !secretMatches(input.invite, judgeInvite())) fail(404, tr("見つかりません"));
        if (await restoreJudgeOwner()) return json(res, { ok: true, resumed: true });
        if (user?.judge) return json(res, { ok: true, resumed: true });
        if (user && isJudgeCustomerEmail(user.email) || cookie(req, "gemihub_judge_owner")) fail(403, tr("店主のセッションを復元できません。運営者にお問い合わせください。"));
        const recordCreation = failedAttempt(`judge-start:${req.socket.remoteAddress}`, 10, 3600000);
        recordCreation();
        const email = `judge-${randomBytes(9).toString("hex")}@${judgeEmailDomain}`;
        const shop = await store.createShop(email, regionForRequest(req));
        shop.judge = { createdAt: new Date().toISOString() };
        await store.saveShop(shop);
        const judge: User = { email, name: tr("審査員"), role: "owner", shopId: shop.id, judge: true };
        await store.put("user", email, judge);
        await login(store, res, judge, judgeUntil()!.getTime());
        return json(res, { ok: true });
      }
      if (path.startsWith("/api/judge/") && !publicHost) {
        if (path === "/api/judge/owner" && method === "POST") {
          // Return from the trial customer to the judge who created it, in the same browser.
          const saved = await restoreJudgeOwner() || fail(403, tr("店主のセッションを復元できません。運営者にお問い合わせください。"));
          return json(res, { ok: true, slug: saved.shop.slug });
        }
        if (!user?.judge) fail(403, tr("審査員としてログインしてください"));
        // An interrupted legacy judge reset may already have archived its old shop.
        const own = (user.shopId ? await (path === "/api/judge/reset" ? store.get<Shop>("shop", user.shopId) : store.shop(user.shopId)) : undefined) || fail(404, tr("お店がありません"));
        if (path === "/api/judge/status" && method === "GET") {
          const usage = await store.get<JudgeUsage>("judgeUsage", user.email);
          return json(res, { until: judgeUntil()!.toISOString(), aiUsed: usage?.count || 0, aiLimit: judgeAiLimit(), storage: !!await store.ownerToken(own), shopId: own.id, slug: own.slug, published: !!own.published });
        }
        if (path === "/api/judge/mails" && method === "GET") {
          const mails = (await store.entries<JudgeMail>("judgeMail")).map(entry => entry.value).filter(mail => mail.shopId === own.id && mail.owner === user.email);
          return json(res, mails.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200));
        }
        if (path === "/api/judge/customer" && method === "POST") {
          if (!own.published) fail(403, tr("自分のお店を公開してからお試しください"));
          const ownerId = cookie(req, "gemihub_session")!;
          const customer: User = { email: `judge-customer-${randomBytes(6).toString("hex")}@${judgeEmailDomain}`, name: tr("審査用のお客様"), role: "customer", shopId: own.id };
          await login(store, res, customer, judgeUntil()!.getTime());
          appendCookie(res, `gemihub_judge_owner=${ownerId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor((judgeUntil()!.getTime() - Date.now()) / 1000))}${secureCookie}`);
          return json(res, { ok: true, slug: own.slug });
        }
        if (path === "/api/judge/reset" && method === "POST") {
          const input = z.object({ requestId: z.uuid() }).parse(await body(req));
          return await store.locked(`judge-reset:${user.email}`, async () => {
            const done = await store.get<{ shopId: string; email: string }>("judgeReset", input.requestId);
            if (done && done.email !== user.email) fail(409, tr("処理IDが重複しています"));
            const saved = await store.get<User>("user", user.email) || fail(403, tr("審査員としてログインしてください"));
            if (!done) {
              const day = new Date().toISOString().slice(0, 10);
              const usage = await store.get<JudgeUsage>("judgeUsage", user.email) || { email: user.email, count: 0 };
              const resets = usage.resets?.day === day ? usage.resets.count : 0;
              if (resets >= 20) fail(429, tr("本日の初期化回数の上限に達しました"));
              const previous = saved.shopId ? await store.shop(saved.shopId) : undefined;
              await store.put("judgeUsage", user.email, { ...usage, resets: { day, count: resets + 1 } });
              if (previous && !previous.judge?.archivedAt) {
                await store.locked(previous.id, async () => {
                  const fresh = (await store.shop(previous.id))!;
                  const token = await store.ownerToken(fresh);
                  if (fresh.google && token) await trashFile(token, fresh.google.folderId);
                  for (const mail of await store.entries<JudgeMail>("judgeMail")) if (mail.value.shopId === fresh.id) await store.delete("judgeMail", mail.id);
                  for (const entry of await store.entries<{ user: User }>("session"))
                    if (entry.value.user?.shopId === fresh.id && isJudgeCustomerEmail(entry.value.user.email)) await store.delete("session", entry.id);
                  // Keep the old records for audit, but detach them from the judge so a new shop is created.
                  await store.saveShop({ ...fresh, owner: `${user.email}#archived-${fresh.id}`, judge: { ...fresh.judge!, archivedAt: new Date().toISOString() } });
                });
              }
              const shop = await store.createShop(user.email, regionForRequest(req));
              if (!shop.judge) { shop.judge = { createdAt: new Date().toISOString() }; await store.saveShop(shop); }
              await store.put("user", user.email, { ...saved, shopId: shop.id });
              await store.put("judgeReset", input.requestId, { shopId: shop.id, email: user.email });
            }
            const updated = await store.get<User>("user", user.email);
            const old = cookie(req, "gemihub_session");
            if (old) await store.delete("session", digest(old));
            await login(store, res, updated!, judgeUntil()!.getTime());
            return json(res, { ok: true });
          });
        }
        fail(404, tr("見つかりません"));
      }
      if ((path.startsWith("/api/admin/") || path === "/admin/google/connect") && !publicHost) {
        if (user?.role !== "owner" || !isAdmin(user.email)) fail(404, tr("見つかりません"));
        if (path === "/admin/google/connect" && method === "GET") {
          if (!process.env.GOOGLE_CLIENT_ID) fail(503, tr("Google ログインはサーバーで設定してください。ローカル確認にはデモモードを利用できます。"));
          const state = randomBytes(32).toString("base64url");
          const verifier = randomBytes(48).toString("base64url");
          await store.put("oauth", digest(state), { verifier, locale: getLocale(), adminDemo: true, email: user.email, returnHost: appHost, expires: Date.now() + 600000 });
          res.setHeader("Set-Cookie", `gemihub_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secureCookie}`);
          return redirect(res, oauth().generateAuthUrl({ access_type: "offline", prompt: "consent select_account", scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file", calendarScope], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" as never }));
        }
        if (path === "/api/admin/status" && method === "GET") {
          const connection = await store.get<DemoGoogle>("demoGoogle", "current");
          let healthy: boolean | undefined;
          if (connection && !store.memory) {
            try { healthy = !!(await clients(connection.refreshToken).auth.getAccessToken()).token; } catch { healthy = false; }
          }
          const setting = await store.get<ProviderSetting>("setting", "aiProvider");
          const invite = judgeInvite();
          const inviteUrl = invite ? `${origin()}/judge/${invite}` : "";
          return json(res, {
            demoGoogle: connection ? { email: connection.email, connectedAt: connection.connectedAt, connectedBy: connection.connectedBy, rootFolderId: connection.rootFolderId, healthy } : null,
            judge: { active: judgeActive(), configured: invite.length >= 32, until: judgeUntil()?.toISOString() || null, aiLimit: judgeAiLimit(), inviteUrl, inviteUrlEn: inviteUrl && `${inviteUrl}?lang=en`, inviteUrlJa: inviteUrl && `${inviteUrl}?lang=ja` },
            ai: { provider: setting?.provider || "vertex", changedAt: setting?.changedAt, changedBy: setting?.changedBy, vertex: { ...vertexStatus(), ready: providerReady("vertex") }, openai: { ...openAiStatus(), ready: providerReady("openai") } },
          });
        }
        if (path === "/api/admin/judges" && method === "GET") {
          const shops = await store.list<Shop>("shop");
          const usages = new Map((await store.entries<JudgeUsage & { lastUsedAt?: string }>("judgeUsage")).map(entry => [entry.id, entry.value]));
          const mails = (await store.entries<JudgeMail>("judgeMail")).map(entry => entry.value);
          const judges = (await store.entries<User>("user")).map(entry => entry.value).filter(judge => judge.judge);
          return json(res, judges.map(judge => {
            const shop = shops.find(item => item.id === judge.shopId);
            const usage = usages.get(judge.email);
            return { email: judge.email, shopName: shop?.published?.name || null, slug: shop?.published ? shop.slug : null, publication: shop?.published ? shop.publication || "public" : null, createdAt: shop?.judge?.createdAt || null, aiUsed: usage?.count || 0, aiLimit: judgeAiLimit(), resets: usage?.resets?.count || 0, mails: mails.filter(mail => mail.shopId === shop?.id).length, lastUsedAt: usage?.lastUsedAt || null };
          }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 500));
        }
        if (path === "/api/admin/google/disconnect" && method === "POST") {
          await store.delete("demoGoogle", "current");
          return json(res, { ok: true });
        }
        if (path === "/api/admin/ai-provider" && method === "POST") {
          const input = z.object({ provider: z.enum(["vertex", "openai"]) }).parse(await body(req));
          if (!providerReady(input.provider)) fail(400, tr("このAIプロバイダの設定が足りません"));
          await store.put("setting", "aiProvider", { provider: input.provider, changedAt: new Date().toISOString(), changedBy: user.email } satisfies ProviderSetting);
          providerCache = { value: input.provider, at: Date.now() };
          return json(res, { ok: true });
        }
        if (path === "/api/admin/ai-test" && method === "POST") {
          const input = z.object({ provider: z.enum(["vertex", "openai"]) }).parse(await body(req));
          try { return json(res, await testProvider(input.provider)); }
          catch (error) { const status = (error as { status?: number }).status; if (status && status < 500) throw error; console.error(error); return json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }); }
        }
        fail(404, tr("見つかりません"));
      }
      if (path === "/api/demo-login" && method === "POST" && !publicHost) {
        if (!demoEnabled()) fail(404, tr("見つかりません"));
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
            (await store.createShop(email, regionForRequest(req)));
        }
        if (!shop) fail(404, tr("お店がありません"));
        const u: User = {
          email,
          name: input.role === "owner" ? tr("デモ店主") : tr("デモのお客様"),
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
      if (user?.role === "owner" && user.legacyNotes && !publicHost && path.startsWith("/api/")) {
        fail(409, tr("旧設定が残っています。kiokuflowでデータの引き継ぎを完了してから、もう一度確認してください。"));
      }
      if (path === "/api/shop-reset" && method === "POST" && !publicHost) {
        if (user?.role !== "owner" || user.judge || user.accessPending) fail(403, tr("店主のみ利用できます"));
        const input = z.object({ shopId: z.uuid() }).parse(await body(req));
        return json(res, await resetShop(store, user.email, input.shopId));
      }
      if (path === "/api/workspace" && method === "GET" && !publicHost) {
        if (!user) fail(401, tr("Google アカウントでログインしてください"));
        const shops = [];
        for (const shop of allShops)
          if (await operator(user, shop)) shops.push(shop);
        return json(res, {
          shops: await Promise.all(
            shops.map(async (shop) => ({
              ...shop,
              isOwner: user.email === shop.owner,
              bookings: await store.bookings(shop.id),
              paymentCheckouts: (await store.list<Checkout>("checkout")).filter(c => c.shopId === shop.id && ["creating", "awaiting_approval", "capturing", "captured"].includes(c.phase)).map(c => ({ ...checkoutView(c), customer: c.customer, name: c.booking.name })),
              inquiries: await inquiries(shop),
              plans: await Promise.all((await store.list<Plan>("plan"))
                .filter((p) => p.shopId === shop.id)
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(plan => shop.owner === user!.email ? initialPlanFacts(plan, shop) : plan)),
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
              // Judges stay on the management origin, where their trial customer session also lives.
              publicUrl: shop.judge
                ? `/s/${shop.slug}`
                : shop.domainVerified
                ? `https://${shop.domain}`
                : process.env.SITE_DOMAIN
                  ? `https://${shop.slug}.${process.env.SITE_DOMAIN}`
                  : `/s/${shop.slug}`,
            })),
          ),
        });
      }
      if (path === "/api/invitations" && method === "GET" && !publicHost) {
        if (!user) fail(401, tr("ログインしてください"));
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
        if (!user) fail(401, tr("ログインしてください"));
        return await store.locked(accept[1], async () => {
          const m = await store.get<{
            shopId: string;
            email: string;
            accepted: boolean;
            status?: string;
            acceptedAt?: string;
          }>("member", `${accept[1]}:${user.email}`);
          if (!m || m.status === "revoked" || m.status === "registered")
            fail(403, tr("このアカウントへの招待はありません"));
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
          (await store.shop(ownerRoute[1])) || fail(404, tr("お店がありません"));
        await assertOperator(user, shop);
        const action = ownerRoute[2] || "";
        // These reads must stay available while a model call holds the shop write lock.
        if (action === "conversations" && method === "GET") return json(res, { email: user!.email, conversations: await conversations(store, shop, user!.email) });
        const conversationRead = action.match(/^conversations\/([a-f0-9]{64})(\/progress)?$/);
        if (conversationRead && method === "GET") {
          const conversation = await store.get<ShopConversation>("shopChat", conversationRead[1]);
          if (!conversation || conversation.shopId !== shop.id || conversation.email !== user!.email) fail(404, tr("チャットが見つかりません"));
          const progress = await store.get<ChatGeneration>("shopChatGeneration", conversation.id);
          let generation = progress?.shopId === shop.id && progress.email === user!.email ? progress : null;
          // The plan/message are authoritative if the last progress write was interrupted.
          if (generation && generation.stage !== "complete") {
            const message = await store.get<ShopChatMessage>("shopChatMessage", chatMessageId(conversation.id, generation.chat.requestId, "assistant"));
            const planId = message?.detail.planId;
            const plan = planId ? await store.get<Plan>("plan", planId) : undefined;
            if (plan?.shopId === shop.id) generation = { ...generation, stage: "complete", base: plan.base, planId: plan.id, preview: undefined };
          }
          if (conversationRead[2]) return json(res, generation);
          const chat = await readConversation(store, shop, user!.email, conversation.id);
          const linked = [...new Set(chat.messages.flatMap(message => message.detail.planId ? [message.detail.planId] : []))];
          const plans = (await Promise.all(linked.map(id => store.get<Plan>("plan", id)))).filter(plan => plan?.shopId === shop.id);
          return json(res, { ...chat, generation, plans: await Promise.all(plans.map(plan => initialPlanFacts(plan!, shop))) });
        }
        const imageRead = action.match(/^(?:images|menu-images)\/([a-f0-9]{64})$/);
        if (imageRead && method === "GET") {
          assertOwner(user, shop);
          return await imageResponse(req, res, shop, imageRead[1], url);
        }
        const staffImageRead = action.match(/^staff-photo\/images\/([a-f0-9]{64})$/);
        if (staffImageRead && method === "GET") {
          const assigned = (await staffAccounts(store, shop)).find(account => account.email === user!.email) || fail(403, tr("担当スタッフの登録がありません"));
          const staff = (await effective(shop)).staff.find(staff => staff.id === assigned.staffId) || fail(403, tr("担当スタッフが削除されています"));
          const image = await store.get<ImageUpload>("menuImageUpload", staffImageRead[1]);
          if (staff.imageId !== staffImageRead[1] && image?.uploadedBy !== user!.email) fail(404, tr("画像がありません"));
          return await imageResponse(req, res, shop, staffImageRead[1], url);
        }
        const settingsAi = action.match(/^live-settings\/(basic|menus|staff|hours|rules)\/ai$/);
        if (settingsAi && method === "POST") {
          assertOwner(user, shop);
          const section = settingsAi[1] as LiveSection;
          const input = z.object({ note: z.string().trim().min(1).max(12000), value: z.unknown(), requestId: z.uuid() }).parse(await body(req, 250000));
          const id = digest(`${shop.id}:${user!.email}:${section}:${input.requestId}`);
          return await store.locked(`settings-ai:${id}`, async () => {
            const hash = digest(JSON.stringify({ section, note: input.note, value: input.value }));
            const cached = await store.get<{ hash: string; proposal: SettingsProposal; expires: number }>("settingsAiProposal", id);
            if (cached) {
              if (cached.hash !== hash) fail(409, tr("依頼の内容が変わっています。設定案を作り直してください。"));
              if (cached.expires > Date.now()) return json(res, cached.proposal);
            }
            const current = await store.locked(shop.id, async () => {
              const fresh = await store.shop(shop.id) || fail(404, tr("お店がありません"));
              assertOwner(user, fresh);
              if (!fresh.published) fail(409, tr("先にお店の共通設定を反映してください"));
              return updateLiveValue(await effective(fresh), section, input.value);
            });
            // Network/model calls do not hold the booking/configuration lock.
            const proposed = await (intelligence.settings || proposeSettings)(section, current, input.note);
            const config = updateLiveValue(current, section, proposed.value);
            if (section === "basic" && (["region", "notificationEmail", "map"] as const).some(key => !same(current[key], config[key]))) fail(400, tr("設定案を作成できませんでした。メモの内容を具体的にして、もう一度お試しください。"));
            if (section === "rules" && !same(current.rules.payment, config.rules.payment)) fail(400, tr("設定案を作成できませんでした。メモの内容を具体的にして、もう一度お試しください。"));
            const proposal = { ...proposed, value: liveValue(config, section), changes: settingsChanges(current, config, section) };
            await store.put("settingsAiProposal", id, { shopId: shop.id, hash, proposal, expires: Date.now() + 3600000 });
            return json(res, proposal);
          });
        }
        if (action === "assistant" && method === "POST") {
          // Questions about this shop, answered from spec.md, history.md and the system OKF bundle.
          if (!shop.published) fail(409, tr("お店を公開してから質問してください"));
          const input = z.object({
            question: z.string().trim().min(1).max(4000),
            messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(12).default([]),
          }).parse(await body(req, 100000));
          const reply = await (intelligence.assistant || converse)({ question: input.question, messages: input.messages, data: await shopData(shop), demo: demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT });
          return json(res, { answer: reply.answer, sources: reply.sources, ...(reply.draft ? { draft: reply.draft, request: draftText(reply.draft) } : {}) });
        }
        if (action === "images/generate" && method === "POST") {
          assertOwner(user, shop);
          const input = generateImageSchema.parse(await body(req, 20000));
          // Image generation can take minutes; do not hold the booking/configuration lock.
          return await store.locked(`image-generation:${shop.id}:${input.requestId}`, async () => {
            const fresh = await store.locked(shop.id, async () => {
              const current = (await store.shop(shop.id))!; assertOwner(user, current);
              if (!store.memory && !current.google) { const token = await ownerToken(current) || fail(503, tr("店主の Google 再接続が必要です")); current.google = await provisionShop(current, current.draft || sample, token); await store.saveShop(current); }
              return current;
            });
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
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
            if(previousRequest&&previousRequest.hash!==hash)fail(409,tr("記事の依頼が変わっています。新しい依頼として送信してください"));
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
            const context=await articleToolContext(store,prepared.fresh,prepared.config,wikiPaths(input.instruction),crmFiles,store.memory?"":await ownerToken(prepared.fresh)||fail(503,tr("店主のGoogle再接続が必要です")));
            const result=await intelligence.proposeArticle(input.instruction,input.source,input.title,demoEnabled()&&!process.env.GOOGLE_CLOUD_PROJECT,{...context,messages:conversationContext(prepared.chat)});
            const parsed=z.object({title:z.string().min(1).max(160),excerpt:z.string().max(300),body:z.string().min(1).max(20000)}).parse(result);
            for(const imageId of postImageIds(parsed.body))if(!context.files.some(file=>file.imageId===imageId))fail(400,tr("参照できない画像が記事に含まれています"));
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
              const post=(await postsFor(fresh)).find(post=>post.id===input.postId)||fail(404,tr("記事がありません"));
              if(post.version!==input.version)fail(409,tr("記事が更新されています。一覧から記事を開き直してください"));
              return post;
            });
            const hash=digest(JSON.stringify(input));
            const cached=await store.get<{hash:string;metadata:z.infer<typeof articleMetadataSchema>}>("postMetadata",id);
            if(cached){if(cached.hash!==hash)fail(409,tr("記事の内容が変わっています。もう一度保存してください"));return json(res,cached.metadata);}
            const generated=articleMetadataSchema.parse(await (intelligence.articleMetadata||generateArticleMetadata)(input.content,demoEnabled()&&!process.env.GOOGLE_CLOUD_PROJECT));
            const metadata={...generated,slug:existing?.address?.slug||existing?.draft.slug||generated.slug};
            await store.put("postMetadata",id,{hash,metadata});return json(res,metadata);
          });
        }
        return await store.locked(shop.id, async () => {
          const fresh = (await store.shop(shop.id))!;
          await assertOperator(user, fresh);
          if (action === "design-versions" && method === "GET") {
            assertOwner(user, fresh);
            const requested = url.searchParams.get("target");
            const target = requested ? parseTargetKey(requested) : undefined;
            const pendingRestore = fresh.designRestore;
            // Read-only: retired versions are trashed by the next publish/restore, not while holding the lock here.
            // A screen's history lists only versions whose state of that screen differs from now.
            let retained = (fresh.designVersions || []).slice(0, 10);
            if (fresh.published && target && retained.some(version => !version.fingerprints)) {
              // Without a connection the older versions just stay unlisted for this screen; the history itself still loads.
              const token = await ownerToken(fresh);
              if (token || demoEnabled()) retained = await indexedDesignVersions(retained, token ? driveDesignVersions(token) : demoDesignVersions(store));
            }
            const visible = fresh.published ? versionsFor(retained, fresh.published, target) : [];
            // A failed restore (even of the oldest retained version) still needs a visible retry action.
            if (pendingRestore && targetKey(pendingRestore.target) === targetKey(target) && !visible.some(version => version.number === pendingRestore.version.number))
              visible.splice(9, 1, pendingRestore.version);
            return json(res, {
              versions: visible.map(({ number, at, summary }) => ({ number, at, summary })),
              revision: fresh.revision,
              current: fresh.published ? currentDesignPublication(fresh) : null,
              pendingRestore: pendingRestore ? { requestId: pendingRestore.requestId, number: pendingRestore.version.number, target: targetKey(pendingRestore.target) } : null,
              publishing: !!fresh.publishingPlanId,
            });
          }
          const designRestore = action.match(/^design-versions\/(\d+)\/restore$/);
          if (designRestore && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ requestId: z.uuid(), revision: z.number().int().nonnegative(), target: z.string().max(240).optional() }).parse(await body(req));
            if (fresh.lastDesignRestoreId === input.requestId) return json(res, { ok: true });
            const number = Number(designRestore[1]);
            const target = input.target ? parseTargetKey(input.target) : undefined;
            const pending = fresh.designRestore;
            if (pending && (pending.requestId !== input.requestId || pending.version.number !== number || targetKey(pending.target) !== targetKey(target)) || fresh.publishingPlanId && fresh.publishingPlanId !== `restore:${input.requestId}`)
              fail(409, tr("公開処理が完了してからお試しください"));
            if (!fresh.published || input.revision !== fresh.revision) fail(409, tr("本番の内容が変わりました。最新の内容を読み直してください"));
            const version = pending?.version || fresh.designVersions?.find(version => version.number === number) || fail(404, tr("版が見つかりません"));
            const token = await ownerToken(fresh);
            if (!token && !demoEnabled()) fail(503, tr("店主の Google 再接続が必要です"));
            const versions = token ? driveDesignVersions(token) : demoDesignVersions(store);
            const snapshot = await versions.read(version);
            let config: ShopConfig;
            try { config = restoreDesign(fresh.published, snapshot.design, target); }
            catch (error) { fail(409, error instanceof Error ? error.message : tr("操作できませんでした")); }
            await validateMenuImages(store, fresh, config);
            // A restore must always be undoable: refuse before pausing bookings when the current state cannot be archived.
            if (fresh.designBackupOperationId !== `restore:${input.requestId}` && !versions.ready(fresh))
              fail(409, tr("現在の公開状態を版履歴に保存できないため復元できません。一度デザインを公開してからお試しください"));
            const at = pending?.at || new Date().toISOString();
            const previous = currentDesignPublication(fresh);
            const when = new Date(version.at).toLocaleString(intlLocale(), { timeZone: regionOf(config).timeZone, timeZoneName: "short" });
            const summary = target
              ? tr("「{0}」を版 {1}（{2} の公開状態）に復元。実行前の状態は版 {3} として保存しました。", targetLabel(target, snapshot.design), version.number, when, previous.number)
              : tr("版 {0}（{1} の公開状態）に復元。実行前の状態は版 {2} として保存しました。", version.number, when, previous.number);
            const history = [...fresh.history, { at, summary }];
            fresh.designRestore = { requestId: input.requestId, version, at, ...(target ? { target } : {}) };
            fresh.publishingPlanId = `restore:${input.requestId}`;
            await store.saveShop(fresh);
            try {
              await preserveDesignVersion(fresh, fresh.publishingPlanId, versions, async () => store.saveShop(fresh), true);
              if (token) {
                // Regenerate every export from the restored design plus today's operational settings,
                // instead of copying archived files that also carry old menus/prices/hours.
                fresh.google = await provisionShop(fresh, config, token);
                await store.saveShop(fresh);
                await syncConfig({ ...fresh, history }, config, token, async () => await store.saveShop(fresh), undefined, await menuImageSnapshot(store, fresh, config, crmFiles, token));
              }
            } catch (error) {
              fresh.publishingError = error instanceof Error ? error.message : tr("Google 連携エラー");
              await store.saveShop(fresh);
              console.error(error);
              fail(503, tr("復元を完了できませんでした。版履歴から同じ版の復元を再試行してください。処理中は予約受付を停止しています。"));
            }
            // Only a whole-design restore makes that version "current"; a single screen leaves the rest as it is.
            nextDesignPublication(fresh, at, summary, target ? undefined : version.number);
            fresh.published = config;
            fresh.history = history;
            fresh.revision++;
            fresh.lastDesignRestoreId = input.requestId;
            delete fresh.designRestore;
            delete fresh.publishingPlanId;
            delete fresh.publishingError;
            // Drafts, article records, bookings, customer/inquiry records and payments are untouched.
            retireDesignVersions(fresh);
            await savePublicShop(fresh);
            await pruneDesignVersions(fresh, versions, async () => store.saveShop(fresh)).catch(console.error);
            // Post pages embed the header/footer, so they follow the restored design.
            await enqueue(fresh, "posts");
            await flush(fresh);
            return json(res, { ok: true });
          }
          if (action === "export" && method === "GET") {
            assertOwner(user, fresh);
            const format = z.enum(["json", "csv"]).parse(url.searchParams.get("format") || "json");
            const table = z.enum(Object.keys(exportColumns) as [ExportTable, ...ExportTable[]]).parse(url.searchParams.get("table") || "bookings");
            const content = format === "csv" ? exportCsv(await exportRows(store, fresh, table), exportColumns[table]) : JSON.stringify(await shopExport(store, fresh, user!.email), null, 2);
            const filename = `gemihub-${fresh.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-${format === "csv" ? table + "-" : ""}${new Date().toISOString().slice(0, 10)}.${format}`;
            res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Cache-Control", "private, no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.end(content);
            return;
          }
          const initialThemeRoute = action.match(/^plans\/([^/]+)\/theme$/);
          if (initialThemeRoute && method === "POST") {
            assertOwner(user, fresh);
            const storedOriginal = await store.get<Plan>("plan", initialThemeRoute[1]);
            if (!storedOriginal || storedOriginal.shopId !== fresh.id || !storedOriginal.requiresSetup || fresh.published || fresh.publishingPlanId || storedOriginal.base !== fresh.revision) fail(409, tr("初回テーマの確認画面を開き直してください。"));
            const original = await initialPlanFacts(storedOriginal, fresh);
            const input = z.object({ instruction: z.string().trim().min(1).max(4000), imageIds: requestImageIdsSchema.default([]), media: mediaSchema }).parse(await body(req, 12000000));
            if (input.media.data.length > 5600000) fail(400, tr("4MB以下の PNG を指定してください"));
            const id = digest(`${fresh.id}:theme-correction:${original.id}:${input.instruction}:${input.imageIds.join(",")}:${digest(input.media.data)}`);
            const completed = await store.get<Plan>("plan", id);
            if (completed) return json(res, { plan: await initialPlanFacts(completed, fresh) });
            const previous = original.themeRunId ? await store.get<ThemeRun>("initialThemeRun", original.themeRunId) : undefined;
            const chat = original.chat ? await readConversation(store, fresh, user!.email, original.chat.id) : undefined;
            const ids = [...new Set([...(previous?.imageIds || (chat ? await conversationImageIds(store, fresh, chat, []) : themeImageIds(original.config.appearance?.theme))), ...input.imageIds])];
            const images = await readRequestImages(store, fresh, ids, crmFiles, store.memory || !ids.length ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です")));
            const state = await store.get<ThemeRun>("initialThemeRun", id);
            const base = structuredClone(original.config);
            const request = `${previous?.request || (chat ? conversationContext(chat).map(m => `${m.role}: ${m.text}`).join("\n") : original.request || "")}\nCurrent accepted theme: ${JSON.stringify(original.config.appearance?.theme || null)}\nCorrection: ${input.instruction}`;
            const reviewed = await (intelligence.initialTheme || createInitialTheme)({ config: base, request, images, screen: input.media }, { state, save: next => store.put("initialThemeRun", id, next) });
            const config = shopSchema.parse({ ...base, appearance: { accent: "sage", layout: "standard", imageUrl: "", ...base.appearance, theme: reviewed.candidate } });
            validateProposedImages(config, original.config, images);
            const plan: Plan = { ...original, id, config, themeRunId: id, themeReview: { attempts: reviewed.attempts, approved: true }, createdAt: Date.now(), summary: planSummary(null, config), approved: false };
            await store.put("plan", id, plan);
            if (chat && original.chat) {
              const reply = chat.messages.find(m => m.role === "assistant" && m.requestId === original.chat!.requestId);
              if (reply) await store.put("shopChatMessage", reply.id, { ...reply, detail: { ...reply.detail, planId: id } });
            }
            return json(res, { plan });
          }
          const libraryRoute = action.match(/^images(?:\/([a-f0-9]{64})(?:\/(rename|archive))?)?$/);
          if (libraryRoute && (method === "GET" || method === "POST")) {
            assertOwner(user, fresh);
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
            if (action === "images" && method === "GET") return json(res, await listImages(store, fresh, fresh.published ? await effective(fresh) : fresh.draft));
            if (method === "POST" && action === "images") {
              const input = await body(req, 8 * 1024 * 1024);
              if (!store.memory && !fresh.google) { fresh.google = await provisionShop(fresh, fresh.draft || sample, token); await store.saveShop(fresh); }
              return json(res, await uploadMenuImage(store, fresh, input, crmFiles, token));
            }
            if (libraryRoute[1] && method === "POST" && libraryRoute[2]) {
              if (libraryRoute[2] === "rename") await updateImage(store, fresh, libraryRoute[1], await body(req, 2000), crmFiles, token);
              else await archiveImage(store, fresh, libraryRoute[1], fresh.published ? await effective(fresh) : fresh.draft);
              return json(res, { ok: true });
            }
          }
          if (action === "menu-images" && method === "POST") {
            assertOwner(user, fresh);
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
            const input = await body(req, 8 * 1024 * 1024);
            if (!store.memory && !fresh.google) { fresh.google = await provisionShop(fresh, fresh.draft || sample, token); await store.saveShop(fresh); }
            return json(res, await uploadMenuImage(store, fresh, input, crmFiles, token));
          }
          const staffPhotoRoute = action.match(/^staff-photo(?:\/images(?:\/([a-f0-9]{64}))?)?$/);
          if (staffPhotoRoute && (method === "GET" || method === "POST")) {
            const assigned = (await staffAccounts(store, fresh)).find(account => account.email === user!.email) || fail(403, tr("担当スタッフの登録がありません"));
            const current = await effective(fresh);
            const staff = current.staff.find(staff => staff.id === assigned.staffId) || fail(403, tr("担当スタッフが削除されています"));
            const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
            const choices = (await listImages(store, fresh, current)).filter(image => image.id === staff.imageId);
            for (const image of await store.entries<ImageUpload>("menuImageUpload")) {
              if (image.value.shopId === fresh.id && image.value.uploadedBy === user!.email && image.value.complete && !image.value.archived && !choices.some(choice => choice.id === image.id)) {
                choices.push({id:image.id,name:image.value.name || tr("スタッフ写真"),mimeType:image.value.mimeType,size:image.value.size,createdAt:image.value.createdAt || "",source:"upload",usedBy:[]});
              }
            }
            if (action === "staff-photo" && method === "GET") return json(res, { staffId: staff.id, name: staff.name, imageId: staff.imageId });
            if (action === "staff-photo/images" && method === "GET") return json(res, choices);
            if (action === "staff-photo/images" && method === "POST") return json(res, await uploadMenuImage(store, fresh, await body(req, 8*1024*1024), crmFiles, token, user!.email));
            if (action === "staff-photo" && method === "POST") {
              const input = z.object({imageId:z.string().regex(/^[a-f0-9]{64}$/).optional(),previousImageId:z.string().default(""),requestId:z.uuid()}).parse(await body(req));
              if (input.imageId && !choices.some(image => image.id === input.imageId)) fail(403, tr("自分の写真を選択してください"));
              const id = digest(`${fresh.id}:${user!.email}:staff-photo:${input.requestId}`);
              let plan = await store.get<Plan>("plan",id);
              if (plan) {
                if (plan.config.staff.find(person=>person.id===staff.id)?.imageId !== input.imageId) fail(409, tr("保存する写真が変わっています"));
              } else {
                if ((staff.imageId || "") !== input.previousImageId) fail(409, tr("写真が更新されています。最新の状態を確認してください"));
                if (staff.imageId === input.imageId) return json(res,{ok:true});
                const config = shopSchema.parse({...current,staff:current.staff.map(person=>person.id===staff.id?{...person,imageId:input.imageId}:person)});
                plan = {id,shopId:fresh.id,base:fresh.revision,source:current,config,approved:true,local:true,createdAt:Date.now(),summary:[tr("{0}のスタッフ写真を更新", staff.name)],checklist:checklist()};
                await store.put("plan",id,plan);
              }
              return json(res, await publishConfiguration(fresh,plan));
            }
            fail(404, tr("見つかりません"));
          }
          const liveSettings = action.match(/^live-settings\/(basic|menus|staff|hours|rules)$/);
          if (liveSettings && (method === "GET" || method === "POST")) {
            assertOwner(user, fresh);
            const section = liveSettings[1] as LiveSection;
            if (method === "GET") {
              if (!fresh.published) fail(409, tr("先にお店の共通設定を反映してください"));
              return json(res, { config: await effective(fresh) });
            }
            const input = z.object({ value: z.unknown(), requestId: z.uuid() }).parse(await body(req));
            const id = digest(`${fresh.id}:${user!.email}:settings:${section}:${input.requestId}`);
            let plan = await store.get<Plan>("plan", id);
            if (plan) {
              if (!same(liveValue(plan.config, section), liveValue(updateLiveValue(plan.source || plan.config, section, input.value), section))) fail(409, tr("保存する内容を確認し直してください"));
            } else {
              if (!fresh.published) fail(409, tr("先にお店の共通設定を反映してください"));
              const current = await effective(fresh);
              const config = updateLiveValue(current, section, input.value);
              plan = { id, shopId: fresh.id, base: fresh.revision, config, source: current, summary: planSummary(current, config), approved: true, local: true, createdAt: Date.now(), checklist:checklist() };
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
            const images = await readRequestImages(store, fresh, input.imageIds, crmFiles, store.memory || !input.imageIds.length ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です")));
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
            if (!same(expectedRemote, scopedSource(current, input.scope))) fail(409, tr("リモートが再更新されました。比較を開き直してください"));
            const proposal = await (intelligence.mergePage || mergePageWithAI)({ baseline, local: localValue, remote: expectedRemote, kind: input.scope.kind === "part" ? input.scope.part : input.scope.kind });
            const value = outputSchema.parse(proposal.value);
            if (input.scope.kind === "page" && value && "id" in value && value.id !== input.scope.pageId) fail(400, tr("AI が対象外のページを変更しました"));
            const latest = fresh.published ? await effective(fresh) : null;
            if (!same(expectedRemote, scopedSource(latest, input.scope))) fail(409, tr("リモートが再更新されました。比較を開き直してください"));
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
              fail(409, tr("本番の内容が変わりました。最新の内容を取り込んで印を確認し直してください"));
            const images = await readRequestImages(store, fresh, input.imageIds, crmFiles, store.memory || !input.imageIds.length ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です")));
            const proposed = input.target === "appearance" && intelligence.visualAppearance
              ? await intelligence.visualAppearance(visual.config, input.instruction, images)
              : await intelligence.propose(tr("ペンで選んだ対象 {0} のみ変更する。他の箇所は変更しない。依頼：{1}", input.target, input.instruction), visual.config, user!.email, demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT, images);
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
            return json(res, { configured: !!process.env.GOOGLE_CLIENT_ID, loginUrl: `/staff-login/${fresh.id}`, staff: (config?.staff || []).filter(staff => staff.id !== ownerStaffId).map(staff => {
              const account = accounts.find(account => account.staffId === staff.id);
              return { staffId: staff.id, name: staff.name, email: account?.email || "", accepted: account?.email === fresh.owner || members.some(member => member.email === account?.email && member.accepted), connected: linked.some(connection => connection.staffId === staff.id && connection.email === account?.email) };
            }) });
          }
          if (action === "staff-accounts" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ staffId: z.string().min(1), email: z.union([z.string().trim().pipe(emailSchema), z.literal("")]), previousEmail: z.string().default("") }).parse(await body(req));
            const config = await effective(fresh);
            if (!config?.staff.some(staff => staff.id === input.staffId)) fail(400, tr("担当スタッフを選択してください"));
            if (input.staffId === ownerStaffId || input.email === fresh.owner && config.ownerBooking) fail(400, tr("店主の追加登録は不要です。ログイン時のカレンダーを自動で利用します。"));
            const accounts = await staffAccounts(store, fresh);
            const previous = accounts.find(account => account.staffId === input.staffId);
            if ((previous?.email || "") !== input.previousEmail) fail(409, tr("登録内容が更新されています。最新の内容を確認してください。"));
            if (input.email && accounts.some(account => account.email === input.email && account.staffId !== input.staffId)) fail(409, tr("このアカウントは別のスタッフに登録されています。"));
            if (input.email && (await connections(store, fresh)).some(connection => (connection.staffId === input.staffId && connection.email !== input.email) || (connection.email === input.email && connection.staffId !== input.staffId))) {
              if (!previous || previous.email === input.email) fail(409, tr("別のスタッフとしてカレンダー連携中です。本人が連携を解除してから登録してください。"));
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
            const calendarConnected = input.email === fresh.owner && await connectOwnerCalendar(store, fresh, config);
            return json(res, { ok: true, calendarConnected });
          }
          if (action === "calendar" && method === "GET") {
            const connection = (await bookingCalendars(store, fresh, await effective(fresh))).find(connection => connection.email === user!.email);
            const account = (await staffAccounts(store, fresh)).find(account => account.email === user!.email);
            return json(res, { connected: !!connection, staffId: connection?.staffId || account?.staffId, email: user!.email, configured: !!process.env.GOOGLE_CLIENT_ID, loginUrl: user!.email === fresh.owner ? "/auth/google" : `/staff-login/${fresh.id}` });
          }
          if (action === "calendar/disconnect" && method === "POST") {
            await store.delete("calendar", `${fresh.id}:${user!.email}`);
            if (user!.email === fresh.owner) {
              const owner = await store.get<User>("user", fresh.owner);
              if (owner?.calendarRefreshToken) {
                delete owner.calendarRefreshToken;
                await store.put("user", fresh.owner, owner);
              }
            }
            return json(res, { ok: true });
          }
          if (action === "calendar/connect" && method === "POST") {
            if (!process.env.GOOGLE_CLIENT_ID) fail(503, tr("Google ログインをサーバーで設定してください"));
            const { staffId } = z.object({ staffId: z.string().min(1) }).parse(await body(req));
            const config = await effective(fresh);
            if (!config?.staff.some(s => s.id === staffId)) fail(400, tr("予約の担当者を選択してください"));
            if (staffId === ownerStaffId) fail(user!.email === fresh.owner ? 400 : 403, tr("店主の追加登録は不要です。ログイン時のカレンダーを自動で利用します。"));
            const assigned = (await staffAccounts(store, fresh)).find(account => account.email === user!.email);
            if (assigned && assigned.staffId !== staffId) fail(403, tr("登録されている担当スタッフで接続してください"));
            if ((await connections(store, fresh)).some(c => c.staffId === staffId && c.email !== user!.email)) fail(409, tr("この担当者は別のメンバーが連携済みです"));
            const state = randomBytes(32).toString("base64url");
            const verifier = randomBytes(48).toString("base64url");
            await store.put("oauth", digest(state), { verifier, locale:getLocale(), calendarShopId: fresh.id, email: user!.email, staffId, expires: Date.now() + 600000 });
            res.setHeader("Set-Cookie", `gemihub_oauth=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${origin().startsWith("https:") ? "; Secure" : ""}`);
            return json(res, { authUrl: oauth().generateAuthUrl({ access_type: "offline", prompt: "consent", login_hint: user!.email, scope: ["openid", "email", calendarScope], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" as never }) });
          }
          if (action === "system" && method === "GET") {
            if (!fresh.published) fail(409, tr("公開後に仕組み図を表示します"));
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
          if (action === "conversations" && method === "POST") {
            const input = conversationInputSchema.parse(await body(req));
            if (input.intent !== "consult") assertOwner(user,fresh);
            return json(res,await createConversation(store,fresh,user!.email,input.intent,input.requestId,!!input.begin));
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
            if(!fresh.published&&input.intent!=="create-shop")fail(409,tr("先にお店づくりを始めてください"));
            if(input.intent==="create-shop"){assertOwner(user,fresh);if(fresh.published)fail(409,tr("お店ができました。相談・修正・新ページ作成から選んでください"));}
            let savedChat = input.chat ? await readConversation(store,fresh,user!.email,input.chat.id) : undefined;
            if (savedChat && savedChat.intent !== input.intent) fail(409,tr("依頼の種類が変わっています。もう一度お話しください"));
            if (savedChat) {
              await appendChatMessage(store,fresh,savedChat,{role:"user",text:input.question,requestId:input.chat!.requestId,detail:{imageIds:input.imageIds}});
              savedChat = await readConversation(store,fresh,user!.email,savedChat.id);
              const previous = savedChat.messages.find(message => message.role === "assistant" && message.requestId === input.chat!.requestId);
              if (previous) return json(res,{answer:previous.text,...previous.detail,chat:savedChat});
            }
            if (input.revision !== fresh.revision)
              fail(409, tr("お店の仕様が変わりました。現在の仕様を更新してください"));
            const config = fresh.published ? await effective(fresh) : fresh.draft || {...structuredClone(sample),notificationEmail:user!.email};
            if (input.hash && input.hash !== contentHash(config)) fail(409, tr("お店の仕様が変わりました。現在の仕様を更新してください"));
            // Images attached earlier in this conversation stay visible to the AI, not only this message's.
            const imageIds = await conversationImageIds(store, fresh, savedChat, input.imageIds);
            if (imageIds.length) assertOwner(user, fresh);
            const images = await readRequestImages(store, fresh, imageIds, crmFiles, store.memory || !imageIds.length ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です")));
            const excluded = new Set(savedChat?.messages.slice(-25).map(message=>message.id) || []);
            const relatedHistory = await searchConversationHistory(store,fresh,user!.email,input.question,excluded);
            const interview = !fresh.published ? initialInterviewFacts(savedChat?.messages || [...input.messages, { role: "user", text: input.question, detail: { imageIds: input.imageIds } }]) : undefined;
            const response = interview?.question ? { answer: interview.question, changeRequest: true, ready: false } : await intelligence.explainSystem(input.intent ? `${requestIntentInstruction[input.intent]}\n${input.question}` : input.question, config, demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT, { messages: savedChat ? conversationContext({...savedChat,messages:savedChat.messages.filter(message => message.requestId !== input.chat!.requestId)}) : input.messages, history: fresh.history, initialSetup:!fresh.published, relatedHistory, searchHistory:query=>searchConversationHistory(store,fresh,user!.email,query,excluded), ...(images.length ? { images } : {}) });
            if (fresh.published && !same(config, await effective(fresh))) fail(409, tr("回答中にお店の仕様が変わりました。現在の仕様を更新して質問し直してください"));
            let answer: {answer:string;changeRequest:boolean;ready?:boolean} = input.intent === "consult" ? { ...response, changeRequest: false, ready: false } : response;
            if(input.intent==="create-shop"&&answer.ready&&!answeredFinalDetails(savedChat?.messages || [...input.messages,{role:"user",text:input.question}])) answer={answer:tr(finalDetailsQuestion),changeRequest:true,ready:false};
            if (savedChat) await appendChatMessage(store,fresh,savedChat,{role:"assistant",text:answer.answer,requestId:input.chat!.requestId,detail:{changeRequest:answer.changeRequest,ready:answer.ready}});
            return json(res,{...answer,...(savedChat ? {chat:await readConversation(store,fresh,user!.email,savedChat.id)} : {})});
          }
          if (action === "visual/identify" && method === "POST") {
            assertOwner(user, fresh);
            if (fresh.publishingPlanId)
              fail(409, tr("公開処理が完了してからお試しください"));
            const input = z
              .object({
                media: mediaSchema,
                instruction: z.string().trim().min(1).max(4000),
                planId: z.string().optional(),
                displayed: shopSchema,
                local: z.object({ base: z.number().int(), source: shopSchema.nullable(), pageId: z.string().optional(), part: z.enum(["header", "footer"]).optional() }).optional(),
                screen: z.object({ id: z.string().max(200), label: z.string().max(200), file: z.string().max(300) }).optional(),
              })
              .parse(await body(req, 12000000));
            if (
              input.media.mimeType !== "image/png" ||
              input.media.data.length > 5600000
            )
              fail(400, tr("4MB以下の PNG を指定してください"));
            const source = fresh.published ? await effective(fresh) : null;
            let config = source;
            if (input.local) {
              const scope = input.local.part ? { kind: "part" as const, part: input.local.part } : input.local.pageId ? { kind: "page" as const, pageId: input.local.pageId } : { kind: "shared" as const };
              if (input.planId || !same(scopedSource(input.local.source, scope), scopedSource(source, scope)))
                fail(409, tr("本番の内容が変わりました。最新の内容を取り込んでください"));
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
                fail(409, tr("最新の承認済みプレビューを開き直してください"));
              config = plan.config;
            }
            if (
              !config ||
              JSON.stringify(shopSchema.parse(config)) !==
                JSON.stringify(input.displayed)
            )
              fail(
                409,
                tr("画面の設定が古くなっています。開き直して印をつけてください"),
              );
            if (input.local?.pageId && !config.pages.some(p => p.id === input.local!.pageId)) fail(400, tr("対象ページがありません"));
            const targets = visualTargets(config).filter(t => !input.local || (input.local.part ? t.id === `part:${input.local.part}` : input.local.pageId
              ? t.id.startsWith(`page:${input.local.pageId}:`)
              : !t.id.startsWith("menu:") && !t.id.startsWith("staff:") && !t.id.startsWith("page:") && !t.id.startsWith("part:")));
            const result = await intelligence.identifyVisual(
              input.media,
              targets,
              input.instruction,
              input.screen,
            );
            const candidates = targets.filter((t) => result.ids.includes(t.id));
            if (!candidates.length)
              fail(
                400,
                result.explanation +
                  tr(" 変更したい箇所を依頼文で具体的に伝えるか、赤いペンで囲んでください。"),
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
            if(receipt){if(receipt.hash!==creationHash)fail(409,tr("保存する記事の内容が変わっています"));return json(res,(await postsFor(fresh)).find(post=>post.id===receipt.postId)||fail(404,tr("記事がありません")));}
            if(autoMetadata)content.slug=uniquePostSlug(content,await postsFor(fresh),creationId);
            if (publish && (!fresh.published || fresh.publishingPlanId)) fail(409, tr("先にお店の反映処理を完了してください"));
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
            for(const imageId of postImageIds(content.body))await readMenuImage(store,fresh,imageId,crmFiles,store.memory?"":await ownerToken(fresh)||fail(503,tr("店主のGoogle再接続が必要です")));
            validatePostAddress(post, content, await postsFor(fresh));
            if (publish) {
              post.published = structuredClone(content); post.publishedAt = at; post.address = postAddress(content);
              fresh.history.push({ at, summary: tr("{0}を保存・公開：{1}", postLabel(content.category), content.title) });
            }
            await store.transaction(async () => {
              await store.put("post", post.id, post);
              if(requestId)await store.put("postCreation",creationId,{hash:creationHash,postId:post.id});
              if (publish) await savePublicShop(fresh);
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
              fail(404, tr("記事がありません"));
            const raw = await body(req);
            const { version } = z
              .object({ version: z.number().int().positive() })
              .parse(raw);
            if (version !== post.version)
              fail(
                409,
                tr("別の画面で記事が更新されました。一覧から記事を開き直してください"),
              );
            const at = new Date().toISOString();
            if (postAction[2] === "save") {
              const { content, publish } = z
                .object({ content: postContentSchema, publish: z.boolean().optional() })
                .parse(raw);
              if (publish && (!fresh.published || fresh.publishingPlanId)) fail(409, tr("先にお店の反映処理を完了してください"));
              for(const imageId of postImageIds(content.body))await readMenuImage(store,fresh,imageId,crmFiles,store.memory?"":await ownerToken(fresh)||fail(503,tr("店主のGoogle再接続が必要です")));
            validatePostAddress(post, content, await postsFor(fresh));
              post.draft = content;
              if (publish) {
                post.published = structuredClone(content); post.publishedAt = at; post.address = postAddress(content);
                fresh.history.push({ at, summary: tr("{0}を保存・公開：{1}", postLabel(content.category), content.title) });
              }
            } else if (postAction[2] === "publish") {
              z.object({ approved: z.literal(true) }).parse(raw);
              if (!fresh.published)
                fail(409, tr("先にお店の予約ページを公開してください"));
              if (fresh.publishingPlanId)
                fail(409, tr("お店の公開処理を完了してから記事を公開してください"));
              for(const imageId of postImageIds(post.draft.body))await readMenuImage(store,fresh,imageId,crmFiles,store.memory?"":await ownerToken(fresh)||fail(503,tr("店主のGoogle再接続が必要です")));
              validatePostAddress(post, post.draft, await postsFor(fresh));
              post.published = structuredClone(post.draft);
              post.publishedAt = at;
              post.address = postAddress(post.draft);
              fresh.history.push({
                at,
                summary: tr("{0}を公開：{1}", postLabel(post.draft.category), post.draft.title),
              });
            } else {
              if (!post.published) fail(409, tr("この記事はすでに非公開です"));
              fresh.history.push({
                at,
                summary: tr("{0}を非公開：{1}", postLabel(post.published.category), post.published.title),
              });
              post.published = null;
            }
            post.version++;
            post.updatedAt = at;
            post.updatedBy = user!.email;
            await store.transaction(async () => {
              await store.put("post", post.id, post);
              await savePublicShop(fresh);
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
                tr("公開処理が未完了です。承認済みプランの公開を再試行してください"),
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
            if (savedChat && savedChat.intent !== input.intent) fail(409,tr("チャットの種類が変わっています"));
            const chatPlanId = input.chat ? digest(`${fresh.id}:chat-plan:${input.chat.id}:${input.chat.requestId}`) : undefined;
            const existingChatPlan = chatPlanId ? await store.get<Plan>("plan",chatPlanId) : undefined;
            if (existingChatPlan?.shopId === fresh.id && input.chat) { await attachChatPlan(store,fresh,user!.email,input.chat,existingChatPlan.id); return json(res,await initialPlanFacts(existingChatPlan,fresh)); }
            const previousReply = savedChat?.messages.find(message => message.role === "assistant" && message.requestId === input.chat!.requestId);
            if (input.chat && !previousReply) fail(409,tr("変更案の元になった会話が見つかりません"));
            if(input.intent==="create-shop"&&savedChat&&(!previousReply?.detail.ready||!answeredFinalDetails(savedChat.messages.filter(message=>message.sequence<=previousReply.sequence))))fail(409,tr("確認画面へ進む前に、ほかに伝えたいことがあるかお答えください"));
            if (previousReply?.detail.planId) {
              const previous = await store.get<Plan>("plan",previousReply.detail.planId);
              if (previous?.shopId === fresh.id) return json(res,await initialPlanFacts(previous,fresh));
            }
            const current = fresh.published ? await effective(fresh) : null;
            if(input.intent==="create-shop"&&current)fail(409,tr("お店は作成済みです。修正を選んでください"));
            if (input.intent === "consult") fail(400, tr("相談では設定を変更しません。修正または新ページ作成を選んでください"));
            if (input.intent === "new-page" && (!current || input.config || input.local || input.visual)) fail(400, tr("新ページ作成は仮公開したあとに依頼してください"));
            if (input.context && (input.context.revision !== fresh.revision || input.context.hash !== contentHash(current))) fail(409, tr("お店の仕様が変わりました。現在の仕様を更新して変更を相談し直してください"));
            let releaseConfig = input.config;
            if (input.local?.scope && input.config) releaseConfig = shopSchema.parse(scopedConfig(current, input.config, input.local.scope));
            const localPlanId = input.local ? digest(`${fresh.id}:${user!.email}:${input.local.requestId}`) : undefined;
            if (input.local) {
              if (!input.config || input.visual) fail(400, tr("反映するローカル設定を指定してください"));
              const previous = await store.get<Plan>("plan", localPlanId!);
              if (previous) {
                if (previous.shopId !== fresh.id || JSON.stringify(previous.config) !== JSON.stringify(releaseConfig)) fail(409, tr("反映する内容を確認し直してください"));
                return json(res, previous);
              }
              if (input.local.scope
                ? !same(scopedSource(input.local.source, input.local.scope), scopedSource(current, input.local.scope))
                : input.local.base !== fresh.revision || !same(input.local.source, current))
                fail(409, tr("本番の内容が変わりました。ローカル編集は保持しています。最新の内容を取り込んで変更を確認してください"));
            }
            let visual: VisualRequest | undefined;
            if (input.visual) {
              if (input.config)
                fail(400, tr("ペンの依頼と項目入力は別々に行ってください"));
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
                fail(409, tr("印の対象を確認し直してください"));
              if (JSON.stringify(current) !== JSON.stringify(visual.source))
                fail(409, tr("設定が変わりました。画面を開き直してください"));
            }
            // A plan from a conversation uses every image attached in it, such as a sample page photo.
            const planImageIds = visual ? input.imageIds : await conversationImageIds(store, fresh, savedChat, input.imageIds);
            const images = await readRequestImages(store, fresh, planImageIds, crmFiles, store.memory || !planImageIds.length ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です")));
            const relatedHistory = input.intent ? await searchConversationHistory(store,fresh,user!.email,input.text,new Set(savedChat?.messages.slice(-24).map(message=>message.id) || [])) : [];
            const historicalContext = relatedHistory.length ? tr("参照用の過去の会話です。今回の変更依頼でも、反映済みという意味でもありません。現在の設定を優先してください。\n{0}\n今回の会話と依頼:\n", JSON.stringify(relatedHistory)) : "";
            const themeRunId = !current && !input.config ? digest(`${fresh.id}:initial-theme:${chatPlanId || input.text}:${planImageIds.join(",")}`) : undefined;
            const themeState = themeRunId ? await store.get<ThemeRun>("initialThemeRun", themeRunId) : undefined;
            let generation: ChatGeneration | undefined = input.chat ? { shopId: fresh.id, email: user!.email, chat: input.chat, base: fresh.revision, stage: "preparing", attempts: 0, startedAt: Date.now(), updatedAt: Date.now() } : undefined;
            const saveGeneration = async (update: Partial<ChatGeneration>) => {
              if (!generation) return;
              generation = { ...generation, ...update, updatedAt: Date.now() };
              await store.put("shopChatGeneration", generation.chat.id, generation);
            };
            await saveGeneration({});
            try {
              const proposed = input.config
                ? {
                    config: releaseConfig!,
                    summary: planSummary(current, releaseConfig!),
                  }
                : await intelligence.propose(
                    visual
                      ? tr("ペンで選んだ対象 {0} のみ変更する。予約ルール・料金・所要時間など他の箇所は一切変えない。依頼：{1}", input.visual!.target, input.text)
                      : input.intent ? `${requestIntentInstruction[input.intent]}\n${historicalContext}${savedChat ? conversationContext(savedChat).map(message => `${message.role === "user" ? tr("店主") : "AI"}: ${message.text}`).join("\n") : input.text}` : input.text,
                    visual?.config || current,
                    user!.email,
                    demoEnabled() && !process.env.GOOGLE_CLOUD_PROJECT,
                    images,
                    // A new shop takes the region from the owner's first visit; later ones keep their own.
                    (visual?.config || current) ? (visual?.config || current)!.region : fresh.regionDefault,
                    themeRunId ? { state: themeState, ...(savedChat ? { shopName: initialInterviewFacts(savedChat.messages).name, articles: initialInterviewFacts(savedChat.messages).articles, introductions: initialInterviewFacts(savedChat.messages).introductions } : {}), save: async state => {
                      await store.put("initialThemeRun", themeRunId, state);
                      await saveGeneration({ stage: state.candidate ? "reviewing" : state.feedback.length ? "repairing" : "generating", attempts: state.attempts, preview: initialThemePreview(state) });
                    } } : undefined,
                  );
              if (!current && savedChat) {
                const facts = initialInterviewFacts(savedChat.messages);
                if (facts.name) proposed.config.name = facts.name;
                if (facts.articles) proposed.config.appearance = { accent: "sage", layout: "standard", imageUrl: "", ...proposed.config.appearance, articles: facts.articles };
                proposed.config = initialIntroductionPages(proposed.config, facts.introductions);
              }
              if (input.intent === "new-page") {
                const added = proposed.config.pages.filter(page => !current!.pages.some(existing => existing.id === page.id));
                if (!added.length) fail(400, tr("新しいページが見つかりませんでした。追加したいページをもう一度教えてください"));
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
                ...(themeRunId ? { themeRunId } : {}),
                approved: false,
                requiresSetup: !current && !input.config,
                createdAt: Date.now(),
                checklist:checklist(),
                source: current,
                ...(input.chat ? {chat:input.chat} : {}),
                ...(!input.config && !input.visual ? { request: input.text.slice(0, 2000) } : {}),
              };
              if (!plan.summary.length) fail(400, tr("変更点がありません"));
              artifacts(plan.config, '<title></title><div id="root"></div>');
              await store.put("plan", plan.id, plan);
              if (input.chat) await attachChatPlan(store,fresh,user!.email,input.chat,plan.id);
              await saveGeneration({ stage: "complete", planId: plan.id, preview: undefined });
              return json(res, plan);
            } catch (error) {
              await saveGeneration({ stage: "failed" }).catch(() => {});
              throw error;
            }
          }
          const p = action.match(/^plans\/([^/]+)\/(approve|publish)$/);
          if (p && method === "POST") {
            assertOwner(user, fresh);
            const plan = await store.get<Plan>("plan", p[1]);
            if (!plan || plan.shopId !== fresh.id)
              fail(404, tr("プランがありません"));
            if (fresh.lastPublishedPlanId === plan.id)
              return json(res, { ok: true, url: `/s/${fresh.slug}` });
            if (plan.base !== fresh.revision)
              fail(409, tr("公開内容が変わりました。プランを作り直してください"));
            const corrected = await initialPlanFacts(plan, fresh);
            if (corrected !== plan) {
              Object.assign(plan, corrected);
              await store.put("plan", plan.id, plan);
              if (plan.approved) fresh.draft = plan.config;
            }
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
            if (!fresh.published || fresh.publishingPlanId) fail(409, tr("先に仮公開を完了してください"));
            const config = await effective(fresh);
            const posts = publicPosts(await postsFor(fresh));
            return json(res, { config, posts, revision: fresh.revision, hash: contentHash({ config, posts }) });
          }
          if (action === "publication" && method === "POST") {
            assertOwner(user, fresh);
            const input = z.object({ publication: z.literal("public"), revision: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await body(req));
            if (!fresh.published || fresh.publishingPlanId) fail(409, tr("先に仮公開を完了してください"));
            if (fresh.revision !== input.revision) fail(409, tr("お店の内容が変わりました。最新の内容を確認してから全公開してください"));
            const config = await effective(fresh);
            const posts = publicPosts(await postsFor(fresh));
            if (input.hash !== contentHash({ config, posts })) fail(409, tr("プレビュー後に内容が変わりました。最新の内容を読み直して確認してください"));
            if (fresh.publication !== "public") {
              fresh.publication = "public";
              fresh.history.push({ at: new Date().toISOString(), summary: tr("本番公開に切り替えました") });
              await savePublicShop(fresh);
            }
            return json(res, { ok: true, url: `/s/${fresh.slug}` });
          }
          if (action === "operations" && method === "GET") {
            return json(res, {
              bookings: await store.bookings(fresh.id),
              paymentCheckouts: (await store.list<Checkout>("checkout")).filter(c => c.shopId === fresh.id && ["creating", "awaiting_approval", "capturing", "captured"].includes(c.phase)).map(c => ({ ...checkoutView(c), customer: c.customer, name: c.booking.name })),
              inquiries: await inquiries(fresh),
            });
          }
          const customerRoute = action.match(/^customers(?:\/([^/]+)(?:\/(.*))?)?$/);
          if (customerRoute && (method === "GET" || method === "POST")) {
            const filter = customerFilterSchema.parse({ period: url.searchParams.get("period") ?? undefined, since: url.searchParams.get("since") ?? undefined });
            const now = new Date();
            const loadCustomers = async () => aggregateCustomers(await store.bookings(fresh.id), await inquiries(fresh), await store.records<CustomerNote>("customerNote", fresh), now, customerSince(filter, now, regionOf(fresh.published).timeZone), await store.records<import("./customers.ts").CustomerRecord>("customer", fresh), regionOf(fresh.published).timeZone);
            const customers = await loadCustomers();
            if (!customerRoute[1] && method === "GET") return json(res, customerSummaries(customers));
            const email = normalizeEmail(decodeURIComponent(customerRoute[1] || ""));
            const customer = customers.find(customer => customer.email === email) || fail(404, tr("お客様が見つかりません"));
            const tail = customerRoute[2] || "";
            if (!tail && method === "GET") return json(res, customer);
            if (tail === "images" && method === "GET") return json(res, {
              name: customer.name,
              images: customerImages((await store.records<CustomerNote>("customerNote", fresh)).filter(note => normalizeEmail(note.email) === email)),
            });
            if (tail === "notes" && method === "POST") {
              const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
              await addCustomerNote(store, fresh, email, user!.email, await body(req, 15 * 1024 * 1024), crmFiles, token);
              return json(res, (await loadCustomers()).find(customer => customer.email === email));
            }
            const noteRoute = tail.match(/^notes\/([^/]+)(?:\/(delete|files)(?:\/([^/]+))?)?$/);
            if (noteRoute) {
              const note = (await store.records<CustomerNote>("customerNote", fresh)).find(note => note.id === noteRoute[1] && normalizeEmail(note.email) === email && note.status === "active") || fail(404, tr("メモがありません"));
              if (noteRoute[2] === "files" && noteRoute[3] && method === "GET") {
                const attachment = note.attachments.find(file => file.id === noteRoute[3]) || fail(404, tr("添付ファイルがありません"));
                const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
                const data = await crmFiles.read(fresh, token, attachment.id);
                if (data.length !== attachment.size) fail(409, tr("添付ファイルが変更されています"));
                return json(res, { data: data.toString("base64") });
              }
              if (method === "POST" && (!noteRoute[2] || noteRoute[2] === "delete")) {
                const input = z.object({ text: z.string().max(10000).optional(), attachmentNames: z.array(customerAttachmentSchema.pick({ id: true, name: true })).max(5).optional(), previousUpdatedAt: z.string() }).parse(await body(req));
                if (input.previousUpdatedAt !== note.updatedAt) fail(409, tr("メモが更新されています。詳細を開き直して確認してください。入力内容は画面に残っています"));
                if (!noteRoute[2]) {
                  if (input.text === undefined && !input.attachmentNames?.length) fail(400, tr("変更内容を指定してください"));
                  if (input.text !== undefined && !input.text.trim() && !note.attachments.length) fail(400, tr("メモを入力してください"));
                  const names = input.attachmentNames || [];
                  if (new Set(names.map(file => file.id)).size !== names.length || names.some(file => !note.attachments.some(attachment => attachment.id === file.id))) fail(400, tr("添付ファイルを確認してください"));
                  for (const file of names) {
                    const attachment = note.attachments.find(attachment => attachment.id === file.id)!;
                    if (attachment.name === file.name) continue;
                    const token = store.memory ? "" : await ownerToken(fresh) || fail(503, tr("店主の Google 再接続が必要です"));
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
              ) || fail(404, tr("予約がありません"));
            const paid = await store.get<Checkout>("checkout", b.id);
            if (paid?.shopId === fresh.id && paid.phase === "confirmed") {
              if (input.status === "cancelled") {
                const booking = await payments.cancel(paid, user!.email, "shop");
                await flush(fresh);
                return json(res, { ok: true, booking });
              }
              if (paid.booking.status !== "active") fail(409, tr("この予約は処理済みです"));
              paid.booking.status = "no_show"; paid.booking.updatedBy = user!.email; paid.booking.updatedAt = new Date().toISOString();
              await store.put("checkout", paid.id, paid); await payments.sync(paid); await flush(fresh);
              return json(res, { ok: true, booking: paid.booking });
            }
            if (b.payment) fail(409, tr("支払いの記録を確認してください"));
            if (b.status !== "active") fail(409, tr("この予約は処理済みです"));
            const config = await effective(fresh);
            b.status = input.status;
            b.updatedBy = user!.email;
            b.updatedAt = new Date().toISOString();
            await store.saveBooking(b);
            await notify(
              fresh,
              config,
              b.customer,
              tr("予約の状態が変更されました"),
              tr("{0} 様\n予約: {1}\n状態: {2}", b.name, b.start, b.status),
            );
            await flush(fresh);
            return json(res, { ok: true });
          }
          const inquiryAction=action.match(/^inquiries\/([^/]+)\/(reply|status)$/);
          if(inquiryAction&&method==="POST"){
            const q=(await inquiries(fresh)).find(q=>q.id===inquiryAction[1]&&q.shopId===fresh.id)||fail(404,tr("お問い合わせがありません"));
            if(inquiryAction[2]==="status"){
              const input=z.object({status:inquiryStatusSchema,previousStatus:inquiryStatusSchema.optional()}).parse(await body(req));
              const current=inquiryStatus(q);
              if(input.previousStatus&&input.previousStatus!==current&&input.status!==current)fail(409,tr("対応状況が更新されています。最新の状態を確認してください"));
              q.status=input.status;await store.put("inquiry",q.id,q);return json(res,{ok:true});
            }
            const input=z.object({text:z.string().trim().min(1).max(5000),requestId:z.uuid().optional(),previousReply:z.string().max(5000).optional(),status:inquiryStatusSchema.optional()}).parse(await body(req));
            const key=digest(`${fresh.id}:${q.id}:${input.requestId||randomUUID()}`);
            const hash=digest(JSON.stringify({text:input.text,previousReply:input.previousReply??null,status:input.status??null}));
            const operation=await store.get<{hash:string;done:boolean}>("inquiryReplyRequest",key);
            if(operation&&operation.hash!==hash)fail(409,tr("返信内容が変わっています。入力し直してください"));
            if(operation?.done){await flush(fresh);return json(res,{ok:true});}
            if(input.previousReply!==undefined&&q.reply!==input.previousReply&&!(operation&&q.reply===input.text))fail(409,tr("他の担当者が返信しています。最新の状態を確認してください"));
            await store.put("inquiryReplyRequest",key,{shopId:fresh.id,inquiryId:q.id,hash,done:false});
            q.reply=input.text;q.status=input.status||inquiryStatus(q);await store.put("inquiry",q.id,q);
            await enqueue(fresh,"mail",{to:q.email,subject:tr("{0} からの返信", fresh.published!.name),body:input.text},digest(`${key}:mail`));
            await store.put("inquiryReplyRequest",key,{shopId:fresh.id,inquiryId:q.id,hash,done:true});
            await flush(fresh);return json(res,{ok:true});
          }
          if (action === "invite" && method === "POST") {
            assertOwner(user, fresh);
            const { email } = z
              .object({ email: emailSchema })
              .parse(await body(req));
            if (email === fresh.owner)
              fail(400, tr("店主はすでに運営メンバーです"));
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
              subject: tr("お店の運営に招待されました"),
              body: tr("{0}の運営に招待されました。{1} にこのメールアドレスの Google アカウントでログインして招待を承諾してください。", fresh.published?.name || tr("お店"), origin()),
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
            if (!member) fail(404, tr("メンバーがありません"));
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
                  (s) => !isArchivedShop(s) && s.id !== fresh.id && s.domain === domain,
                )
              )
                fail(409, tr("このドメインは利用できません"));
              fresh.domain = domain;
              fresh.domainVerified = false;
              fresh.domainToken = randomBytes(24).toString("hex");
              await savePublicShop(fresh);
              return json(res, { ok: true });
            });
          }
          if (action === "domain/verify" && method === "POST") {
            assertOwner(user, fresh);
            if (!fresh.domain || !fresh.domainToken)
              fail(400, tr("先にドメインを設定してください"));
            const records = await resolveTxt(`_gemihub.${fresh.domain}`).catch(() => []);
            if (!records.some((r) => r.join("") === fresh.domainToken))
              fail(400, tr("確認用 TXT レコードが見つかりません"));
            fresh.domainVerified = true;
            await savePublicShop(fresh);
            return json(res, { ok: true });
          }
          if (action === "retry" && method === "POST") {
            await payments.reconcile(fresh.id);
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
          fail(404, tr("見つかりません"));
        });
      }
      const publicRoute = path.match(/^\/api\/public\/([^/]+)(?:\/(.*))?$/);
      if (publicRoute) {
        const shopRef =
          allShops.find((s) => s.slug === publicRoute[1] && s.published) ||
          fail(404, tr("公開されたお店がありません"));
        if (hosted && hosted.id !== shopRef.id) fail(404, tr("お店がありません"));
        const action = publicRoute[2] || "";
        if (["auth/email", "auth/email/info", "auth/email/verify"].includes(action) && method === "POST") {
          const shop = await store.shop(shopRef.id) || fail(404, tr("お店がありません"));
          assertStorefrontAccess(shop);
          if (shop.publication === "provisional") fail(403, tr("仮公開中のため、このページを用意したユーザーのログインが必要です"));
          const requestOrigin = publicHost ? `https://${host}` : origin();
          const storefrontPath = publicHost ? "/" : `/s/${shop.slug}`;
          const input = await body(req, 2000);
          if (action === "auth/email") {
            await customerEmailLogin.request(shop, requestOrigin, storefrontPath, req.socket.remoteAddress || "unknown", input);
            return json(res, { ok: true });
          }
          if (action === "auth/email/info") return json(res, await customerEmailLogin.info(shop, requestOrigin, input));
          const customer = await customerEmailLogin.verify(shop, requestOrigin, input);
          await login(store, res, customer);
          return json(res, { ok: true, redirectTo: `${storefrontPath}?pane=mine&lang=${getLocale()}` });
        }
        const imageRead = action.match(/^(menu-images|images)\/([a-f0-9]{64})$/);
        if (imageRead && method === "GET") {
          const shop = await store.shop(shopRef.id) || fail(404, tr("お店がありません"));
          assertStorefrontAccess(shop);
          const config = await effective(shop);
          const ids = imageRead[1] === "images" ? managedImageIds(config) : config.menus.filter(menu => menu.active).map(menu => menu.imageId);
          if (!ids.includes(imageRead[2]) && !(imageRead[1] === "images" && publishedPostImageIds(await postsFor(shop)).includes(imageRead[2]))) fail(404, tr("画像がありません"));
          return await imageResponse(req, res, shop, imageRead[2], url);
        }
        return await store.locked(shopRef.id, async () => {
          const shop = (await store.shop(shopRef.id))!;
          assertStorefrontAccess(shop);
          const customer = () => {
            if (!user || user.role !== "customer" || user.shopId !== shop.id)
              fail(401, tr("このお店のお客様としてログインしてください"));
            return user!;
          };
          const paidCancellation = action.match(/^bookings\/([^/]+)\/(cancel|cancel-quote)$/);
          if (paidCancellation && ((method === "POST" && paidCancellation[2] === "cancel") || (method === "GET" && paidCancellation[2] === "cancel-quote"))) {
            const u = customer();
            const paid = await store.get<Checkout>("checkout", paidCancellation[1]);
            if (paid) {
              if (paid.shopId !== shop.id || paid.customer !== u.email) fail(404, tr("予約がありません"));
              if (paid.phase !== "confirmed" || !paid.booking.payment) fail(409, tr("支払いを確認中です。確定後にキャンセルしてください。"));
              if (paidCancellation[2] === "cancel-quote") {
                const p = paid.booking.payment;
                return json(res, p.cancellation || refundQuote(p.amount, paid.booking.start, new Date().toISOString(), p.policy, "customer"));
              }
              const input = z.object({ expectedRefund: z.number().int().min(0).optional() }).parse(await body(req));
              const at = new Date().toISOString();
              if (!paid.booking.payment!.cancellation) {
                const p = paid.booking.payment!;
                const quote = refundQuote(p.amount, paid.booking.start, at, p.policy, "customer");
                if (input.expectedRefund !== quote.amount) fail(409, tr("返金額を再確認してからキャンセルしてください。時間の経過で返金額が変わる場合があります。"));
              }
              const booking = await payments.cancel(paid, u.email, "customer", at);
              await flush(shop);
              return json(res, { ok: true, booking });
            }
            if (paidCancellation[2] === "cancel-quote") fail(404, tr("支払い済みの予約がありません"));
          }
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
              ) || fail(404, tr("記事がありません"));
            return json(res, post);
          }
          const config = await effective(shop);
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
                user?.email === shop.owner && user.authMethod !== "email" && !publicHost
                  ? config
                  : { ...config, notificationEmail: undefined },
              shopId: shop.id,
              canEdit: user?.email === shop.owner && user.authMethod !== "email" && !publicHost,
              customerProfile: profile,
              registrationRequired: isCustomer && !profile,
              preview: false,
              publication: shop.publication || "public",
              recentPosts: livePosts.slice(0, 5).map(summarizePost),
              authUrl: `${languageUrl(`${publicHost ? `https://${host}` : origin()}${publicHost ? "/" : `/s/${shop.slug}`}?pane=mine`)}#email-login`,
              googleAuthUrl: process.env.GOOGLE_CLIENT_ID ? languageUrl(`${origin()}/auth/google?shop=${encodeURIComponent(shop.slug)}${hosted ? `&host=${encodeURIComponent(host)}` : ""}`) : undefined,
            });
          }
          if (action === "slots/next" && method === "GET")
            return json(res, await nextAvailableSlots(store, shop, config, url.searchParams.get("menu") || "", url.searchParams.get("staff") || undefined, calendar, url.searchParams.getAll("option")));
          if (action === "slots" && method === "GET")
            return json(
              res,
              await availableSlots(store, shop, config,
                url.searchParams.get("date") || "",
                url.searchParams.get("menu") || "",
                url.searchParams.get("staff") || undefined, calendar, undefined, url.searchParams.getAll("option")),
            );
          if (action === "checkouts" && method === "GET") {
            const u = customer();
            return json(res, (await store.list<Checkout>("checkout")).filter(c => c.shopId === shop.id && c.customer === u.email && ["creating", "awaiting_approval", "capturing", "captured"].includes(c.phase)).map(checkoutView));
          }
          const checkoutAction = action.match(/^checkouts\/([a-f0-9]{64})\/(capture|abandon|resume)$/);
          if (checkoutAction && method === "POST") {
            const u = customer();
            const c = await store.get<Checkout>("checkout", checkoutAction[1]);
            if (!c || c.shopId !== shop.id || c.customer !== u.email) fail(404, tr("お支払いの記録がありません"));
            if (checkoutAction[2] === "abandon") {
              if (["creating", "awaiting_approval"].includes(c.phase)) { c.phase = "expired"; await store.put("checkout", c.id, c); }
            } else if (checkoutAction[2] === "resume") await payments.create(c);
            else await payments.capture(c, async () => {
              const b = c.booking;
              const date = dateIn(b.start, regionOf(config).timeZone);
              return (await availableSlots(store, shop, config, date, b.menuId, b.staffId, calendar, c.id, b.optionIds)).some(slot => slot.start === b.start && slot.end === b.end && slot.staffId === b.staffId);
            });
            await flush(shop);
            return json(res, { ok: c.phase === "confirmed", booking: c.phase === "confirmed" ? c.booking : undefined, checkout: checkoutView(c) });
          }
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
            if (!await ownProfile()) fail(428, tr("先に会員情報を登録してください"));
            const input = z
              .object({
                name: z.string().min(1).max(100),
                message: z.string().max(2000).default(""),
                menuId: z.string(),
                optionIds: z.array(z.string().regex(/^[a-z0-9_-]+$/)).max(10).refine(ids => new Set(ids).size === ids.length).default([]),
                staffId: z.string().optional(),
                start: z.iso.datetime(),
                requestId: z.uuid().optional(),
                paymentConsent: z.object({ amount: z.number().min(0), policy: refundTiersSchema }).optional(),
                expectedPrice: z.number().min(0).optional(),
                expectedDuration: z.number().int().min(15).optional(),
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
            const pending = requestKey ? await store.get<Checkout>("checkout", digest(requestKey)) : undefined;
            if (pending) {
              if (pending.customer !== u.email || pending.shopId !== shop.id || pending.booking.name !== input.name || pending.booking.message !== input.message || pending.booking.start !== input.start || pending.booking.menuId !== input.menuId || JSON.stringify([...(pending.booking.optionIds || [])].sort()) !== JSON.stringify([...input.optionIds].sort()) || (input.staffId && pending.booking.staffId !== input.staffId)) fail(409, tr("予約内容が変更されています。空き枠から選び直してください。"));
              await payments.create(pending);
              return json(res, { ok: pending.phase === "confirmed", booking: pending.phase === "confirmed" ? pending.booking : undefined, checkout: checkoutView(pending) });
            }
            if (previous) {
              if (JSON.stringify([...(previous.optionIds || [])].sort()) !== JSON.stringify([...input.optionIds].sort())) fail(409, tr("予約内容が変更されています。空き枠から選び直してください。"));
              return json(res, { ok: true, booking: previous });
            }
            const selection = menuSelection(config, input.menuId, input.optionIds);
            if (!selection) fail(400, tr("メニューと追加メニューの組み合わせを確認してください"));
            const menuPrice = selection.price;
            if (input.expectedPrice !== undefined && input.expectedPrice !== selection.price || input.expectedDuration !== undefined && input.expectedDuration !== selection.duration) fail(409, tr("料金や所要時間が変わりました。メニューと空き時間を確認し直してください。"));
            if (config.rules.payment?.enabled && menuPrice && (!input.requestId || !input.paymentConsent || input.paymentConsent.amount !== menuPrice || JSON.stringify(input.paymentConsent.policy) !== JSON.stringify(config.rules.payment.refundTiers))) fail(409, tr("料金と返金条件を読み直し、同意してからPayPalへ進んでください。"));
            const date = dateIn(input.start, regionOf(config).timeZone);
            const slot = (await availableSlots(store, shop, config, date, input.menuId, input.staffId, calendar, undefined, input.optionIds)).find((s) => s.start === input.start);
            if (!slot)
              fail(409, tr("この時間は予約できません。空き状況を更新してください"));
            const b: Booking = {
              id: requestKey ? digest(requestKey) : randomUUID(),
              requestKey,
              shopId: shop.id,
              customer: u.email,
              name: input.name,
              message: input.message,
              menuId: input.menuId,
              price: selection.price,
              ...(selection.optionIds.length ? { optionIds: selection.optionIds, items: selection.items } : {}),
              ...slot,
              status: "active",
              createdAt: new Date().toISOString(),
            };
            if (config.rules.payment?.enabled && b.price > 0) {
              // Return only to this storefront's verified host or the configured app origin.
              const storefront = hosted ? `https://${host}/` : `${origin()}/s/${shop.slug}`;
              const back = new URL(storefront);
              back.searchParams.set("pane", "mine"); back.searchParams.set("checkout", b.id);
              back.searchParams.set("paypal", "return");
              const returnUrl = back.href;
              back.searchParams.set("paypal", "cancel");
              const checkout = await payments.begin(b, config.rules.payment.refundTiers, returnUrl, back.href, currencyOf(regionOf(config)), config.name);
              return json(res, { ok: false, checkout: checkoutView(checkout) });
            }
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
                tr("{0} ご予約を承りました", config.name),
                tr("{0} 様\n{1}\n{2}{3}", b.name, bookingMenuName(config, b), new Date(b.start).toLocaleString(intlLocale(), { timeZone: regionOf(config).timeZone, timeZoneName: "short" }), b.message ? tr("\nメッセージ: {0}", b.message) : ""),
                [shop.owner, config.notificationEmail],
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
              ) || fail(404, tr("予約がありません"));
            if (b.payment) fail(409, tr("支払いの記録を確認してください"));
            if (b.status !== "active") fail(409, tr("この予約は処理済みです"));
            if (
              Date.parse(b.start) - Date.now() <
              config.rules.cancelHours * 3600000
            )
              fail(
                409,
                tr("キャンセル期限を過ぎています。お店にお問い合わせください"),
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
                tr("予約をキャンセルしました"),
                tr("{0} 様\n予約: {1}\nメニュー: {2}", b.name, new Date(b.start).toLocaleString(intlLocale(), { timeZone: regionOf(config).timeZone, timeZoneName: "short" }), bookingMenuName(config, b)),
              );
            });
            await flush(shop);
            return json(res, { ok: true });
          }
          if (action === "inquiries" && method === "POST") {
            const u = customer();
            if (!await ownProfile()) fail(428, tr("先に会員情報を登録してください"));
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
              tr("{0} お問い合わせを受け付けました", config.name),
              input.message,
            );
            await flush(shop);
            return json(res, { ok: true });
          }
          fail(404, tr("見つかりません"));
        });
      }
      if (path === "/robots.txt" && (method === "GET" || method === "HEAD")) {
        const indexable = (shop: Shop) => shop.published && shop.publication !== "provisional" && !shop.judge;
        const shops = publicHost ? [hosted!] : allShops;
        const sitemaps = shops.filter(shop => indexable(shop) && canonicalBase(shop, origin()) === (publicHost ? `https://${host}` : `${origin()}/s/${shop.slug}`)).map(shop => `${canonicalBase(shop, origin())}/sitemap.xml`);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(method === "HEAD" ? undefined : `User-agent: *\nDisallow: /api/\nDisallow: /auth/\nDisallow: /admin\nDisallow: /judge\nDisallow: /publication-preview\nDisallow: /settings\n${sitemaps.map(url => `Sitemap: ${url}\n`).join("")}`);
        return;
      }
      const sitemap = publicHost && path === "/sitemap.xml" ? hosted : allShops.find(shop => path === `/s/${shop.slug}/sitemap.xml`);
      if ((method === "GET" || method === "HEAD") && sitemap) {
        if (!sitemap.published || sitemap.publication === "provisional" || sitemap.judge || canonicalBase(sitemap, origin()) !== (publicHost ? `https://${host}` : `${origin()}/s/${sitemap.slug}`)) fail(404, tr("ページがありません"));
        // Reads never wait for a publication in progress; only a shop without any release is converted first.
        let shop = await store.shop(sitemap.id) || fail(404, tr("お店がありません"));
        if (!shop.published || shop.publication === "provisional" || shop.judge) fail(404, tr("ページがありません"));
        if (!shop.storefrontRelease) shop = await firstStorefront(shop.id);
        const xml = await pageFiles.read(storefrontObject(shop.id, shop.storefrontRelease!, storefrontFile("sitemap.xml", publicHost, getLocale())));
        if (xml === undefined) fail(503, tr("公開ページを読み込めません。しばらくしてからお試しください。"));
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.end(method === "HEAD" ? undefined : xml);
        return;
      }
      const assetRoute = publicHost ? path.match(/^\/_assets\/([^/]+)$/) : path.match(/^\/s\/([^/]+)\/_assets\/([^/]+)$/);
      if (assetRoute && (method === "GET" || method === "HEAD")) {
        const name = assetRoute[publicHost ? 1 : 2];
        const ref = publicHost ? hosted : allShops.find(item => item.slug === assetRoute[1] && item.published);
        const shop = ref && await store.shop(ref.id);
        if (!shop?.published || !storefrontAssetName.test(name)) fail(404, tr("見つかりません"));
        if (shop.publication === "provisional" && !user) fail(404, tr("見つかりません"));
        assertStorefrontAccess(shop);
        // Pages of the retained releases may still be open in a browser, so their assets stay available.
        if (![shop.storefrontRelease, ...shop.storefrontPrevious || []].some(release => release?.assets?.includes(name))) fail(404, tr("見つかりません"));
        const body = await pageFiles.read(storefrontAssetObject(shop.id, name)) || fail(404, tr("見つかりません"));
        res.setHeader("Content-Type", storefrontAssetType(name));
        // Names are content hashes; restricted shops (provisional, judge) are never stored in shared caches.
        res.setHeader("Cache-Control", res.hasHeader("X-Robots-Tag") ? "private, max-age=3600" : "public, max-age=31536000, immutable");
        res.end(method === "HEAD" ? undefined : body);
        return;
      }
      if (path.startsWith("/api/") || path.startsWith("/auth/"))
        fail(404, tr("見つかりません"));
      if (
        publicHost &&
        (path.startsWith("/admin") ||
          path.startsWith("/publication-preview") ||
          path.startsWith("/s/"))
      )
        fail(404, tr("見つかりません"));
      if (method !== "GET" && method !== "HEAD")
        fail(405, tr("利用できない操作です"));
      const publicationPreviewPage = path.match(/^\/publication-preview\/([^/]+)$/);
      if (publicationPreviewPage) {
        const shop = await store.shop(publicationPreviewPage[1]) || fail(404, tr("お店がありません"));
        assertOwner(user, shop);
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Vary", "Cookie, X-Gemihub-Language, Accept-Language");
      }
      const root = resolve("dist");
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(`${root}/`)) {
        if (path !== "/") fail(404, tr("見つかりません"));
      }
      const manualAsset = /^\/manual\/(?:en\/)?[a-z0-9-]+\.jpg$/.test(path);
      const asset =
        path.startsWith("/assets/") || path === "/live-audio.js" || path === "/storefront-login.js" || manualAsset;
      if (
        !asset &&
        path !== "/" &&
        (publicHost
          ? !/^\/(blogs|announcements|pages)(?:\/[a-z0-9-]+)?$/.test(path)
          : path !== "/manual" && path !== "/settings/migration" && path !== "/admin" && path !== "/judge-menu" && !judgeRoute && !/^\/publication-preview\/[^/]+$/.test(path) &&
            !/^\/(s)\/[^/]+(?:\/(blogs|announcements|pages)(?:\/[a-z0-9-]+)?)?$/.test(
              path,
            ))
      )
        fail(404, tr("見つかりません"));
      const appShell = async () => {
        let shell: Buffer;
        try { shell = await readFile(resolve(root, "index.html")); }
        catch { return fail(404, tr("画面を表示するには npm run build を実行してください")); }
        return Buffer.from(localizeShell(shell.toString("utf8")));
      };
      let data = Buffer.alloc(0);
      if (asset) {
        try { data = await readFile(file); }
        catch { fail(404, tr("見つかりません")); }
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
          let shop = await store.shop(shopRef.id);
          if (!shop?.published) fail(404, tr("公開されたお店がありません"));
          if (shop.publication === "provisional" && !user) {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Vary", "Cookie, X-Gemihub-Language, Accept-Language");
            res.setHeader("X-Robots-Tag", "noindex, nofollow");
            return redirect(res, `${origin()}/auth/google?shop=${encodeURIComponent(shop.slug)}${publicHost ? `&host=${encodeURIComponent(host)}` : ""}`);
          }
          assertStorefrontAccess(shop);
          const operation = !category && (["reserve", "mine", "contact"].includes(url.searchParams.get("pane") || "") || url.searchParams.has("checkout"));
          if (operation) {
            // An empty app shell is used only for interactive customer operations.
            // Public HTML is never mounted or replaced by React.
            res.setHeader("X-Robots-Tag", "noindex, nofollow");
            data = await appShell();
          } else {
            // One-time conversion for shops published before static releases were introduced.
            // Subsequent reads use only the selected bucket objects, never a request-time render.
            if (!shop.storefrontRelease) shop = await firstStorefront(shop.id);
            const route = category ? `${category}${key && key !== "index" ? `/${key}` : ""}` : "";
            const page = storefrontFile(route, publicHost, getLocale());
            const release = shop.storefrontRelease!;
            if (!release.paths.includes(page)) fail(404, tr("ページがありません"));
            const html = await pageFiles.read(storefrontObject(shop.id, release, page));
            if (html === undefined) fail(503, tr("公開ページを読み込めません。しばらくしてからお試しください。"));
            data = Buffer.from(html);
            const etag = `"${digest(`${release.id}:${page}`)}"`;
            res.setHeader("ETag", etag);
            if (!res.hasHeader("X-Robots-Tag") && req.headers["if-none-match"] === etag) { res.writeHead(304); res.end(); }
          }
          if (res.writableEnded) return;
        } else if (category || local) fail(404, tr("公開されたお店がありません"));
        else data = await appShell();
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
        manualAsset || path === "/storefront-login.js"
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
              .map((i) => `${i.path.join(".")}: ${tr(i.message)}`)
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
              ? tr("処理を完了できませんでした。設定と連携状態をご確認ください。")
              : err.message,
        },
        status,
      );
    }
  }));
  attachAssistantLive(server, async (req, shopId) => {
    const s = await session(store, req);
    const user = s?.user && isJudgeEmail(s.user.email) && !judgeActive() ? undefined : s?.user;
    const shop = await store.shop(shopId);
    if (!user || !shop?.published || (shop.judge && !judgeActive()) || !(await operator(user, shop))) return undefined;
    if (user.judge) await chargeJudge(user.email);
    return { data: await shopData(shop) };
  }, liveConnector);
  let stopped = false;
  const timer = setInterval(() => {
    void (async () => {
      await store.cleanup();
      if (stopped) return;
      const shops = await store.list<Shop>("shop");
      if (stopped) return;
      for (const shop of shops.filter(
        (s) => s.published && !isArchivedShop(s),
      ))
        void store
          .locked(shop.id, async () => {
            const fresh = await store.shop(shop.id);
            if (fresh) {
              await payments.reconcile(fresh.id); await flush(fresh);
              // Converts shops published before static releases and refreshes releases from an older generator.
              await ensureStorefront(fresh).catch(error => console.error(`Storefront ${fresh.id}: background release failed`, error));
            }
          })
          .catch(console.error);
    })().catch(console.error);
  }, 60000);
  timer.unref();
  server.on("close", () => { stopped = true; clearInterval(timer); });
  return server;
}
