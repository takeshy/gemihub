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
 * USD prices are opt-in per plan and fall back to the JPY price when unset.
 *
 * The retired `STRIPE_PRICE_ID_PRO*` variables are deliberately NOT consulted:
 * Pro was renamed to Business at a different amount, so falling back to it
 * would charge the old price for the new plan.
 */
function resolvePriceId(planType: "lite" | "business", currency: HubworkCurrency): string | undefined {
  if (currency === "usd") {
    const usdPriceId = planType === "lite"
      ? process.env.STRIPE_PRICE_ID_LITE_USD
      : process.env.STRIPE_PRICE_ID_BUSINESS_USD;
    if (usdPriceId) return usdPriceId;
  }
  return planType === "lite" ? process.env.STRIPE_PRICE_ID_LITE : process.env.STRIPE_PRICE_ID_BUSINESS;
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
    const topUpSession = await stripeClient.checkout.sessions.create({
      mode: "payment",
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
    const addonSession = await stripeClient.checkout.sessions.create({
      mode: "subscription",
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

  const planType = requestedPlan === "lite" ? "lite" : "business";
  const accountSlug = (formData.get("accountSlug") as string || "").toLowerCase().trim();
  const currency: HubworkCurrency = formData.get("currency") === "usd" ? "usd" : "jpy";

  const reviewSlugs = parseSlugList(process.env.HUBWORK_REVIEW_SLUGS);

  const existing = await getAccountByRootFolderId(tokens.rootFolderId);

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const baseUrl = `${proto}://${url.host}`;

  // Google OAuth verification bypass: create a granted Pro account without Stripe.
  // Only effective when HUBWORK_REVIEW_SLUGS contains the submitted slug and the
  // user has no existing account yet.
  if (planType === "business" && !existing && accountSlug && reviewSlugs.includes(accountSlug)) {
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
  if (existing?.stripeSubscriptionId && existing.billingStatus === "active") {
    if (existing.plan === planType) {
      throw new Response("Already on this plan", { status: 400 });
    }
    // Pro requires a slug
    if (planType === "business") {
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
    if (planType === "business" && accountSlug && !existing.accountSlug) {
      updates.accountSlug = accountSlug;
      updates.defaultDomain = `${accountSlug}.${HUBWORK_DOMAIN}`;
    }
    await updateAccount(existing.id, updates);

    // Lite → Business upgrades change the subscription in place, so
    // checkout.session.completed never fires — provision the organization
    // here (idempotent; reuses an existing membership).
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

  // New subscription
  if (!accountSlug && planType === "business") {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }
  if (planType === "business" && (!accountSlug || accountSlug.length < 3 || !SLUG_PATTERN.test(accountSlug))) {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }
  if (planType === "business") {
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
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/settings?hubwork_subscribed=1`,
    cancel_url: `${baseUrl}/settings`,
    customer_email: tokens.email || undefined,
    metadata: {
      rootFolderId: tokens.rootFolderId,
      accountSlug,
      plan: planType,
      currency,
    },
  });

  if (!session.url) {
    throw new Response("Failed to create checkout session", { status: 500 });
  }

  return redirect(session.url);
}
