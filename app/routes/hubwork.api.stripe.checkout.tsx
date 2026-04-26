import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.api.stripe.checkout";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { createAccount, getAccountByRootFolderId, getAccountBySlug } from "~/services/hubwork-accounts.server";
import { getStripe } from "~/services/stripe.server";
import { validateOrigin } from "~/utils/security";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function parseSlugList(value: string | undefined): string[] {
  return (value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);
  const sessionTokens = await requireAuth(request);
  const { tokens } = await getValidTokens(request, sessionTokens);

  const formData = await request.formData();
  const planType = (formData.get("plan") as string || "pro") === "lite" ? "lite" : "pro";
  const accountSlug = (formData.get("accountSlug") as string || "").toLowerCase().trim();

  const reviewSlugs = parseSlugList(process.env.HUBWORK_REVIEW_SLUGS);
  const stripeAllowedSlugs = parseSlugList(process.env.HUBWORK_STRIPE_ALLOWED_SLUGS);

  const existing = await getAccountByRootFolderId(tokens.rootFolderId);

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const baseUrl = `${proto}://${url.host}`;
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";

  // Google OAuth verification bypass: create a granted Pro account without Stripe.
  // Only effective when HUBWORK_REVIEW_SLUGS contains the submitted slug and the
  // user has no existing account yet.
  if (planType === "pro" && !existing && accountSlug && reviewSlugs.includes(accountSlug)) {
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

  // Stripe checkout allowlist: any non-listed Pro slug is treated as "not yet
  // available" while OAuth verification is in progress. The UI displays the
  // returned error message without navigating away.
  // Localhost bypasses the allowlist so sandbox Stripe flows can be tested.
  if (planType === "pro" && !isLocalhost) {
    const effectiveSlug = accountSlug || existing?.accountSlug || "";
    if (!stripeAllowedSlugs.includes(effectiveSlug)) {
      return Response.json(
        { error: "unavailable" },
        { status: 200 }
      );
    }
  }

  // Upgrade existing subscription (e.g. Lite → Pro)
  if (existing?.stripeSubscriptionId && existing.billingStatus === "active") {
    if (existing.plan === planType) {
      throw new Response("Already on this plan", { status: 400 });
    }
    // Pro requires a slug
    if (planType === "pro") {
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

    const newPriceId = planType === "lite"
      ? process.env.STRIPE_PRICE_ID_LITE
      : process.env.STRIPE_PRICE_ID_PRO;
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
    const { updateAccount } = await import("~/services/hubwork-accounts.server");
    const updates: Record<string, string> = { plan: planType };
    if (planType === "pro" && accountSlug && !existing.accountSlug) {
      updates.accountSlug = accountSlug;
      updates.defaultDomain = `${accountSlug}.gemihub.net`;
    }
    await updateAccount(existing.id, updates);

    return redirect(`${baseUrl}/settings?hubwork_upgraded=1`);
  }

  // New subscription
  if (!accountSlug && planType === "pro") {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }
  if (planType === "pro" && (!accountSlug || accountSlug.length < 3 || !SLUG_PATTERN.test(accountSlug))) {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }
  if (planType === "pro") {
    const slugTaken = await getAccountBySlug(accountSlug);
    if (slugTaken) {
      throw new Response("This slug is already taken", { status: 409 });
    }
  }

  const priceId = planType === "lite"
    ? process.env.STRIPE_PRICE_ID_LITE
    : process.env.STRIPE_PRICE_ID_PRO;
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
    },
  });

  if (!session.url) {
    throw new Response("Failed to create checkout session", { status: 500 });
  }

  return redirect(session.url);
}
