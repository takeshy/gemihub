import type { Route } from "./+types/hubwork.api.stripe.webhook";
import { getStripe } from "~/services/stripe.server";
import {
  getAccountByRootFolderId,
  getAccountByEmail,
  getAccountByStripeCustomerId,
  createAccount,
  updateAccount,
} from "~/services/hubwork-accounts.server";
import { removeDomain } from "~/services/hubwork-domain.server";

export async function action({ request }: Route.ActionArgs) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Response("Webhook secret not configured", { status: 500 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    throw new Response("Missing stripe-signature header", { status: 400 });
  }

  const rawBody = await request.text();
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    throw new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const rootFolderId = session.metadata?.rootFolderId || "";
      const accountSlug = session.metadata?.accountSlug || "";
      const planType = (session.metadata?.plan === "lite" ? "lite" : "pro") as "lite" | "pro";
      const email = session.customer_details?.email || "";
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : "";

      // Find existing account by rootFolderId or email
      let account = rootFolderId ? await getAccountByRootFolderId(rootFolderId) : null;
      if (!account && email) {
        account = await getAccountByEmail(email);
      }

      if (account) {
        await updateAccount(account.id, {
          plan: planType,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          billingStatus: "active",
          accountStatus: "enabled",
          ...(email && !account.email ? { email } : {}),
          ...(accountSlug && !account.accountSlug ? { accountSlug, defaultDomain: `${accountSlug}.gemihub.net` } : {}),
        });
      } else {
        const newId = await createAccount({
          email: email || "",
          refreshToken: "",
          rootFolderName: "",
          rootFolderId: rootFolderId || "",
          plan: planType,
          accountSlug: accountSlug || undefined,
        });
        if (customerId) {
          await updateAccount(newId, { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId });
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : "";
      if (customerId) {
        const account = await getAccountByStripeCustomerId(customerId);
        if (account) {
          if (account.customDomain) {
            try {
              await removeDomain(account.id, account.customDomain);
            } catch (e) {
              console.warn(`[stripe-webhook] Failed to remove custom domain for ${account.id}:`, e);
            }
          }
          await updateAccount(account.id, { billingStatus: "canceled", accountStatus: "disabled" });
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : "";
      if (customerId) {
        const account = await getAccountByStripeCustomerId(customerId);
        if (account) {
          const isActive = subscription.status === "active" || subscription.status === "trialing";
          const billingStatus = isActive
            ? "active" as const
            : subscription.status === "past_due"
              ? "past_due" as const
              : "canceled" as const;
          // Free GCP resources when transitioning to canceled (e.g. end of
          // cancel_at_period_end window). subscription.deleted handles the
          // immediate-delete path; this handles the scheduled-cancel path.
          if (
            billingStatus === "canceled" &&
            account.billingStatus !== "canceled" &&
            account.customDomain
          ) {
            try {
              await removeDomain(account.id, account.customDomain);
            } catch (e) {
              console.warn(`[stripe-webhook] Failed to remove custom domain for ${account.id}:`, e);
            }
          }
          await updateAccount(account.id, {
            billingStatus,
            ...(billingStatus === "canceled" ? { accountStatus: "disabled" as const } : {}),
            ...(isActive && account.accountStatus === "disabled" && (account.plan === "lite" || account.plan === "pro") ? { accountStatus: "enabled" as const } : {}),
          });
        }
      }
      break;
    }
  }

  return Response.json({ received: true });
}
