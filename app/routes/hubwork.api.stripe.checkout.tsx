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

  // Prevent duplicate subscriptions
  const existing = await getAccountByRootFolderId(tokens.rootFolderId);
  if (existing?.plan && existing.billingStatus === "active") {
    throw new Response("Active subscription already exists", { status: 400 });
  }

  const formData = await request.formData();
  const accountSlug = (formData.get("accountSlug") as string || "").toLowerCase().trim();

  // Validate slug
  if (!accountSlug || accountSlug.length < 3 || !SLUG_PATTERN.test(accountSlug)) {
    throw new Response("Invalid account slug. Must be 3+ chars, lowercase alphanumeric and hyphens.", { status: 400 });
  }

  // Check slug uniqueness
  const slugTaken = await getAccountBySlug(accountSlug);
  if (slugTaken) {
    throw new Response("This slug is already taken", { status: 409 });
  }

  const planType = (formData.get("plan") as string || "pro") === "lite" ? "lite" : "pro";
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
