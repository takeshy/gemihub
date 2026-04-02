import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.api.stripe.checkout";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getAccountByRootFolderId, getAccountBySlug } from "~/services/hubwork-accounts.server";
import { getStripe } from "~/services/stripe.server";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export async function action({ request }: Route.ActionArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens } = await getValidTokens(request, sessionTokens);

  const formData = await request.formData();
  const planType = (formData.get("plan") as string || "pro") === "lite" ? "lite" : "pro";
  const accountSlug = (formData.get("accountSlug") as string || "").toLowerCase().trim();

  const existing = await getAccountByRootFolderId(tokens.rootFolderId);

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
      updates.defaultDomain = `${accountSlug}.gemihub.online`;
    }
    await updateAccount(existing.id, updates);

    const url = new URL(request.url);
    const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
    return redirect(`${proto}://${url.host}/settings?hubwork_upgraded=1`);
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

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const baseUrl = `${proto}://${url.host}`;

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
