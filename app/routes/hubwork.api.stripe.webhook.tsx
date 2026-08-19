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

      // Storage add-on subscription: record the purchased 500 GB units on
      // the organization, keyed by subscription id (idempotent).
      if (session.metadata?.type === "storage-addon") {
        const orgId = session.metadata.orgId || "";
        const units = Math.max(1, Math.min(8, parseInt(session.metadata.units || "1", 10) || 1));
        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || "";
        if (orgId && subscriptionId) {
          const { setOrgStorageAddon } = await import("~/services/organizations.server");
          await setOrgStorageAddon(orgId, subscriptionId, units);
        }
        break;
      }

      // Vertex budget top-up (one-time payment): extend the org's
      // current-month AI budget by $10 per purchased unit. Idempotent via
      // the checkout session id.
      if (session.metadata?.type === "vertex-topup") {
        const orgId = session.metadata.orgId || "";
        const units = Math.max(1, Math.min(20, parseInt(session.metadata.units || "1", 10) || 1));
        if (orgId) {
          const { addAiBudgetTopUp } = await import("~/services/ai-budget.server");
          await addAiBudgetTopUp(orgId, units * 10, session.id);
        }
        break;
      }

      const rootFolderId = session.metadata?.rootFolderId || "";
      const accountSlug = session.metadata?.accountSlug || "";
      const planType = (session.metadata?.plan === "lite" ? "lite" : "business") as "lite" | "business";
      const currency = (session.metadata?.currency === "usd" ? "usd" : "jpy") as "jpy" | "usd";
      const email = session.customer_details?.email || "";
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : "";

      // Find existing account by rootFolderId or email
      let account = rootFolderId ? await getAccountByRootFolderId(rootFolderId) : null;
      if (!account && email) {
        account = await getAccountByEmail(email);
      }

      let provisionedAccountId: string | null = null;
      if (account) {
        await updateAccount(account.id, {
          plan: planType,
          currency,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          billingStatus: "active",
          accountStatus: "enabled",
          ...(email && !account.email ? { email } : {}),
          ...(accountSlug && !account.accountSlug ? { accountSlug, defaultDomain: `${accountSlug}.gemihub.net` } : {}),
        });
        provisionedAccountId = account.id;
      } else {
        const newId = await createAccount({
          email: email || "",
          refreshToken: "",
          rootFolderName: "",
          rootFolderId: rootFolderId || "",
          plan: planType,
          currency,
          accountSlug: accountSlug || undefined,
        });
        if (customerId) {
          await updateAccount(newId, { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId });
        }
        provisionedAccountId = newId;
      }

      // Business plan: the completed payment authorizes provisioning an
      // organization for the buyer (Owner = purchaser) with one default
      // shared project. Idempotent — an existing membership is reused, so
      // Stripe webhook retries and re-subscriptions are safe.
      if (planType === "business" && provisionedAccountId) {
        const { provisionBusinessOrganization } = await import("~/services/business-provisioning.server");
        const buyerEmail = email || account?.email || "";
        await provisionBusinessOrganization({
          accountId: provisionedAccountId,
          email: buyerEmail,
          accountSlug: accountSlug || account?.accountSlug,
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;

      // Storage add-on cancelled: drop its units from the organization —
      // and never touch the account's main plan/billing status.
      if (subscription.metadata?.type === "storage-addon") {
        const orgId = subscription.metadata.orgId || "";
        if (orgId) {
          const { removeOrgStorageAddon } = await import("~/services/organizations.server");
          await removeOrgStorageAddon(orgId, subscription.id).catch(() => {});
        }
        break;
      }

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

      // Storage add-on quantity changed (e.g. via the Stripe portal): sync
      // the recorded units; a lapsed/canceled add-on drops to zero units.
      if (subscription.metadata?.type === "storage-addon") {
        const orgId = subscription.metadata.orgId || "";
        if (orgId) {
          const { setOrgStorageAddon, removeOrgStorageAddon } = await import("~/services/organizations.server");
          const active = subscription.status === "active" || subscription.status === "trialing";
          const quantity = subscription.items.data[0]?.quantity ?? 1;
          if (active) await setOrgStorageAddon(orgId, subscription.id, Math.max(1, Math.min(8, quantity)));
          else await removeOrgStorageAddon(orgId, subscription.id).catch(() => {});
        }
        break;
      }

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
            ...(isActive && account.accountStatus === "disabled" && (account.plan === "lite" || account.plan === "business") ? { accountStatus: "enabled" as const } : {}),
          });
        }
      }
      break;
    }
  }

  return Response.json({ received: true });
}
