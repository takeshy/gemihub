import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.api.stripe.checkout";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { createAccount, getAccountByRootFolderId, getAccountBySlug } from "~/services/hubwork-accounts.server";
import { getStripe } from "~/services/stripe.server";
import { validateOrigin } from "~/utils/security";
import type { HubworkCurrency } from "~/types/hubwork";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function parseSlugList(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * USD prices are opt-in per plan and fall back to the base price when unset.
 * The base prices are multi-currency (JPY + USD via currency_options), so the
 * fallback alone is enough; `STRIPE_PRICE_ID_PRO_USD` simply follows the same
 * optional override pattern as Lite/Business.
 *
 * `STRIPE_PRICE_ID_PRO` is the NEW Pro plan's price. The retired pre-Business
 * Pro variables of the same name were provisioned fresh for this plan and the
 * old ones are never referenced.
 */
function resolvePriceId(planType: "lite" | "pro" | "business", currency: HubworkCurrency): string | undefined {
  if (currency === "usd") {
    const usdPriceId = planType === "lite"
      ? process.env.STRIPE_PRICE_ID_LITE_USD
      : planType === "pro"
        ? process.env.STRIPE_PRICE_ID_PRO_USD
        : process.env.STRIPE_PRICE_ID_BUSINESS_USD;
    if (usdPriceId) return usdPriceId;
  }
  return planType === "lite"
    ? process.env.STRIPE_PRICE_ID_LITE
    : planType === "pro"
      ? process.env.STRIPE_PRICE_ID_PRO
      : process.env.STRIPE_PRICE_ID_BUSINESS;
}

/**
 * Explicit allowlist instead of `plan === "lite" ? "lite" : "business"`: a
 * ternary would silently charge a mistyped or new plan name at the Business
 * price.
 */
function normalizePlanType(requestedPlan: string): "lite" | "pro" | "business" | undefined {
  if (requestedPlan === "lite" || requestedPlan === "pro" || requestedPlan === "business") {
    return requestedPlan;
  }
  return undefined;
}

/**
 * The `currency` to put on the Checkout Session, or undefined to let the price
 * decide.
 *
 * A multi-currency price (one price carrying ¥7,500 AND $50) bills in its
 * default currency unless the session names another — picking a different
 * price id, which is how single-currency setups work, does nothing for it. So
 * ask Stripe what the price actually supports:
 *
 *   - already the requested currency  → nothing to set
 *   - offered via currency_options    → set it, and the customer is billed in it
 *   - not offered                     → leave it; billing falls back to the
 *                                       price's own currency rather than failing
 */
async function sessionCurrencyFor(
  priceId: string,
  requested: HubworkCurrency,
): Promise<HubworkCurrency | undefined> {
  try {
    // currency_options is only returned when expanded — without this the
    // multi-currency prices look single-currency and nothing is ever set.
    const price = await getStripe().prices.retrieve(priceId, {
      expand: ["currency_options"],
    });
    if (price.currency === requested) return undefined;
    return price.currency_options?.[requested] ? requested : undefined;
  } catch (error) {
    console.warn("[stripe] could not read the price's currencies:", error);
    return undefined;
  }
}

export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);
  const sessionTokens = await requireAuth(request);
  const { tokens } = await getValidTokens(request, sessionTokens);

  const formData = await request.formData();
  const requestedPlan = (formData.get("plan") as string) || "business";

  // Vertex budget top-up: a one-time payment ($10 / ¥1,500 per unit) that
  // extends the organization's current-month AI budget. Org owners/admins only.
  if (requestedPlan === "vertex-topup") {
    const orgId = (formData.get("orgId") as string || "").trim();
    const unitsRaw = Number(formData.get("units") || 1);
    const units = Number.isInteger(unitsRaw) && unitsRaw >= 1 && unitsRaw <= 20 ? unitsRaw : 1;
    const topUpCurrency: HubworkCurrency = formData.get("currency") === "usd" ? "usd" : "jpy";
    if (!orgId) throw new Response("Missing orgId", { status: 400 });
    const { requireOrgAccess } = await import("~/services/project-acl.server");
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin") {
      throw new Response("Only organization administrators can purchase budget top-ups", { status: 403 });
    }
    const topUpPriceId = topUpCurrency === "usd"
      ? process.env.STRIPE_PRICE_ID_VERTEX_TOPUP_USD ?? process.env.STRIPE_PRICE_ID_VERTEX_TOPUP
      : process.env.STRIPE_PRICE_ID_VERTEX_TOPUP;
    if (!topUpPriceId) {
      throw new Response("Stripe is not configured for budget top-ups", { status: 500 });
    }
    const topUpUrl = new URL(request.url);
    const topUpProto = request.headers.get("x-forwarded-proto") || topUpUrl.protocol.replace(":", "");
    const topUpBase = `${topUpProto}://${topUpUrl.host}`;
    const stripeClient = getStripe();
    const topUpSessionCurrency = await sessionCurrencyFor(topUpPriceId, topUpCurrency);
    const topUpSession = await stripeClient.checkout.sessions.create({
      mode: "payment",
      ...(topUpSessionCurrency ? { currency: topUpSessionCurrency } : {}),
      line_items: [{ price: topUpPriceId, quantity: units }],
      success_url: `${topUpBase}/settings?tab=enterprise`,
      cancel_url: `${topUpBase}/settings?tab=enterprise`,
      customer_email: tokens.email || undefined,
      metadata: {
        type: "vertex-topup",
        orgId,
        units: String(units),
        currency: topUpCurrency,
      },
    });
    if (!topUpSession.url) {
      throw new Response("Failed to create checkout session", { status: 500 });
    }
    return redirect(topUpSession.url);
  }

  // Personal Vertex budget top-up: a one-time payment ($10 / ¥1,500 per unit)
  // that adds to the user's personal prepaid AI balance. No org required —
  // the user's email is the key. Reuses the same Stripe price as org top-ups.
  if (requestedPlan === "personal-vertex-topup") {
    // The balance is keyed by email. Without one the webhook has nothing to
    // credit, and the payment would go through for nothing.
    if (!tokens.email) {
      throw new Response("This account has no email address to credit the balance to", { status: 400 });
    }
    const unitsRaw = Number(formData.get("units") || 1);
    const units = Number.isInteger(unitsRaw) && unitsRaw >= 1 && unitsRaw <= 20 ? unitsRaw : 1;
    const topUpCurrency: HubworkCurrency = formData.get("currency") === "usd" ? "usd" : "jpy";
    const topUpPriceId = topUpCurrency === "usd"
      ? process.env.STRIPE_PRICE_ID_VERTEX_TOPUP_USD ?? process.env.STRIPE_PRICE_ID_VERTEX_TOPUP
      : process.env.STRIPE_PRICE_ID_VERTEX_TOPUP;
    if (!topUpPriceId) {
      throw new Response("Stripe is not configured for budget top-ups", { status: 500 });
    }
    const topUpUrl = new URL(request.url);
    const topUpProto = request.headers.get("x-forwarded-proto") || topUpUrl.protocol.replace(":", "");
    const topUpBase = `${topUpProto}://${topUpUrl.host}`;
    const stripeClient = getStripe();
    const topUpSessionCurrency = await sessionCurrencyFor(topUpPriceId, topUpCurrency);
    const topUpSession = await stripeClient.checkout.sessions.create({
      mode: "payment",
      ...(topUpSessionCurrency ? { currency: topUpSessionCurrency } : {}),
      line_items: [{ price: topUpPriceId, quantity: units }],
      success_url: `${topUpBase}/settings?tab=general`,
      cancel_url: `${topUpBase}/settings?tab=general`,
      customer_email: tokens.email || undefined,
      metadata: {
        type: "personal-vertex-topup",
        // The personal balance is keyed by email (emailToUid lowercases it).
        email: tokens.email,
        units: String(units),
        currency: topUpCurrency,
      },
    });
    if (!topUpSession.url) {
      throw new Response("Failed to create checkout session", { status: 500 });
    }
    return redirect(topUpSession.url);
  }

  // Storage add-on: a monthly subscription of 500 GB units (¥5,000 / $30
  // per unit) that extends the organization's storage quota. Org
  // owners/admins only. Each purchase is its own subscription so it can be
  // cancelled independently from the Stripe customer portal.
  if (requestedPlan === "storage-addon") {
    const orgId = (formData.get("orgId") as string || "").trim();
    // One add-on per organization: the quota tops out at 100 + 500 GB.
    const units = 1;
    const addonCurrency: HubworkCurrency = formData.get("currency") === "usd" ? "usd" : "jpy";
    if (!orgId) throw new Response("Missing orgId", { status: 400 });
    const { requireOrgAccess } = await import("~/services/project-acl.server");
    const access = await requireOrgAccess(request, orgId);
    if (access.role !== "owner" && access.role !== "admin") {
      throw new Response("Only organization administrators can purchase storage add-ons", { status: 403 });
    }
    {
      const { getOrganization } = await import("~/services/organizations.server");
      const { storageAddonUnits, MAX_STORAGE_ADDON_UNITS } = await import("~/services/storage-quota.server");
      const org = await getOrganization(orgId);
      if (org && storageAddonUnits(org) >= MAX_STORAGE_ADDON_UNITS) {
        throw new Response("This organization already has the storage add-on", { status: 409 });
      }
    }
    const addonPriceId = addonCurrency === "usd"
      ? process.env.STRIPE_PRICE_ID_STORAGE_ADDON_USD ?? process.env.STRIPE_PRICE_ID_STORAGE_ADDON
      : process.env.STRIPE_PRICE_ID_STORAGE_ADDON;
    if (!addonPriceId) {
      throw new Response("Stripe is not configured for storage add-ons", { status: 500 });
    }
    const addonUrl = new URL(request.url);
    const addonProto = request.headers.get("x-forwarded-proto") || addonUrl.protocol.replace(":", "");
    const addonBase = `${addonProto}://${addonUrl.host}`;
    const stripeClient = getStripe();
    const addonSessionCurrency = await sessionCurrencyFor(addonPriceId, addonCurrency);
    const addonSession = await stripeClient.checkout.sessions.create({
      mode: "subscription",
      ...(addonSessionCurrency ? { currency: addonSessionCurrency } : {}),
      line_items: [{ price: addonPriceId, quantity: units }],
      success_url: `${addonBase}/settings?tab=enterprise`,
      cancel_url: `${addonBase}/settings?tab=enterprise`,
      customer_email: tokens.email || undefined,
      metadata: { type: "storage-addon", orgId, units: String(units), currency: addonCurrency },
      // Stamp the subscription itself so lifecycle webhooks
      // (subscription.updated / .deleted) can be routed without a session.
      subscription_data: {
        metadata: { type: "storage-addon", orgId, units: String(units) },
      },
    });
    if (!addonSession.url) {
      throw new Response("Failed to create checkout session", { status: 500 });
    }
    return redirect(addonSession.url);
  }

  const planType = normalizePlanType(requestedPlan);
  if (!planType) {
    throw new Response(`Unknown plan: ${requestedPlan}`, { status: 400 });
  }
  const accountSlug = (formData.get("accountSlug") as string || "").toLowerCase().trim();
  const additionalOrganization = planType === "business" && formData.get("additionalOrganization") === "true";
  const currency: HubworkCurrency = formData.get("currency") === "usd" ? "usd" : "jpy";

  const reviewSlugs = parseSlugList(process.env.HUBWORK_REVIEW_SLUGS);

  const existing = additionalOrganization ? null : await getAccountByRootFolderId(tokens.rootFolderId);

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const baseUrl = `${proto}://${url.host}`;

  // Google OAuth verification bypass: create a granted Pro account without Stripe.
  // Only effective when HUBWORK_REVIEW_SLUGS contains the submitted slug and the
  // user has no existing account yet.
  //
  // Never for an additional-organization purchase: `existing` is forced to null
  // above, so this branch would be reachable for a buyer who already has an
  // account — and the createAccount below runs WITHOUT allowDuplicateOwner, so
  // the email dedup would just hand back their existing account id, provision
  // no organization, and still redirect to ?hubwork_subscribed=1.
  if (planType === "business" && !additionalOrganization && !existing && accountSlug && reviewSlugs.includes(accountSlug)) {
    if (accountSlug.length < 3 || !SLUG_PATTERN.test(accountSlug)) {
      throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
    }
    const slugTaken = await getAccountBySlug(accountSlug);
    if (slugTaken) {
      throw new Response("This slug is already taken", { status: 409 });
    }
    await createAccount({
      email: tokens.email || "",
      refreshToken: sessionTokens.refreshToken,
      rootFolderName: "gemihub",
      rootFolderId: tokens.rootFolderId,
      plan: "granted",
      accountSlug,
    });
    return redirect(`${baseUrl}/settings?hubwork_subscribed=1`);
  }

  // Upgrade existing subscription (e.g. Lite → Pro)
  if (existing?.stripeSubscriptionId && existing.billingStatus !== "canceled") {
    if (existing.plan === planType) {
      throw new Response("Already on this plan", { status: 400 });
    }
    // Business → Pro is not offered: the account would keep its
    // orgId/projectId (and therefore organization-gated features like Sheets,
    // custom domains, and the org's Vertex AI budget) while paying the Pro
    // price. Untangling the provisioned organization is out of scope, so
    // reject this transition outright rather than relying on the UI alone.
    if (planType === "pro" && (existing.plan === "business" || existing.plan === "granted")) {
      throw new Response("Downgrading from Business to Pro is not supported", { status: 400 });
    }
    // Business and Pro both need a slug for the built-in subdomain
    if (planType === "business" || planType === "pro") {
      if (!accountSlug || accountSlug.length < 3 || !SLUG_PATTERN.test(accountSlug)) {
        throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
      }
      if (!existing.accountSlug) {
        const slugTaken = await getAccountBySlug(accountSlug);
        if (slugTaken && slugTaken.id !== existing.id) {
          throw new Response("This slug is already taken", { status: 409 });
        }
      }
    }

    // Use the account's existing billing currency, not a resubmitted form
    // value, so an upgrade can't silently switch a subscriber's currency.
    const existingCurrency: HubworkCurrency = existing.currency === "usd" ? "usd" : "jpy";
    const newPriceId = resolvePriceId(planType, existingCurrency);
    if (!newPriceId) {
      throw new Response("Stripe is not configured for this plan", { status: 500 });
    }

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      throw new Response("Could not find subscription item", { status: 500 });
    }

    await stripe.subscriptions.update(existing.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: "create_prorations",
      metadata: {
        rootFolderId: tokens.rootFolderId,
        accountSlug: accountSlug || existing.accountSlug || "",
        plan: planType,
      },
    });

    // Update account immediately (webhook will also fire, but this gives instant feedback)
    const { updateAccount, HUBWORK_DOMAIN } = await import("~/services/hubwork-accounts.server");
    const updates: Record<string, string> = { plan: planType };
    if ((planType === "business" || planType === "pro") && accountSlug && !existing.accountSlug) {
      updates.accountSlug = accountSlug;
      updates.defaultDomain = `${accountSlug}.${HUBWORK_DOMAIN}`;
    }
    await updateAccount(existing.id, updates);

    // Plan changes on an existing subscription (Lite→Pro, Lite→Business,
    // Pro→Business) update it in place, so checkout.session.completed never
    // fires — only a move to Business provisions the organization here
    // (idempotent; reuses an existing membership). Business→Pro downgrades
    // are not offered: untangling the provisioned organization is out of
    // scope.
    if (planType === "business") {
      const { provisionBusinessOrganization } = await import("~/services/business-provisioning.server");
      await provisionBusinessOrganization({
        accountId: existing.id,
        email: tokens.email || existing.email || "",
        accountSlug: accountSlug || existing.accountSlug,
      });
    }

    return redirect(`${baseUrl}/settings?hubwork_upgraded=1`);
  }

  // New subscription — Business and Pro both require a slug for the
  // built-in subdomain (site hosting resolves accounts by Host header).
  if (!accountSlug && planType !== "lite") {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }
  if (planType !== "lite" && (!accountSlug || accountSlug.length < 3 || !SLUG_PATTERN.test(accountSlug))) {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }
  if (planType !== "lite") {
    const slugTaken = await getAccountBySlug(accountSlug);
    if (slugTaken) {
      throw new Response("This slug is already taken", { status: 409 });
    }
  }

  const priceId = resolvePriceId(planType, currency);
  if (!priceId) {
    throw new Response("Stripe is not configured for this plan", { status: 500 });
  }

  const stripe = getStripe();
  const sessionCurrency = await sessionCurrencyFor(priceId, currency);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ...(sessionCurrency ? { currency: sessionCurrency } : {}),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/settings?hubwork_subscribed=1`,
    cancel_url: `${baseUrl}/settings`,
    customer_email: tokens.email || undefined,
    metadata: {
      rootFolderId: tokens.rootFolderId,
      accountSlug,
      plan: planType,
      currency,
      additionalOrganization: additionalOrganization ? "true" : "false",
    },
  });

  if (!session.url) {
    throw new Response("Failed to create checkout session", { status: 500 });
  }

  return redirect(session.url);
}
