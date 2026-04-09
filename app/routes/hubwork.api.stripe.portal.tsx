import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.api.stripe.portal";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getAccountByRootFolderId } from "~/services/hubwork-accounts.server";
import { getStripe } from "~/services/stripe.server";

export async function action({ request }: Route.ActionArgs) {
  const sessionTokens = await requireAuth(request);
  const { tokens } = await getValidTokens(request, sessionTokens);

  const account = await getAccountByRootFolderId(tokens.rootFolderId);
  if (!account?.stripeCustomerId) {
    throw new Response("No Stripe subscription found", { status: 404 });
  }

  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const returnUrl = `${proto}://${url.host}/settings`;

  let portalSession;
  try {
    const stripe = getStripe();
    portalSession = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: returnUrl,
    });
  } catch (err) {
    console.error("Stripe billing portal error:", err);
    throw new Response("Failed to create billing portal session", { status: 502 });
  }

  return redirect(portalSession.url);
}
