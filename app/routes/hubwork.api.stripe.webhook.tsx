import type { Route } from "./+types/hubwork.api.stripe.webhook";
import { getStripe } from "~/services/stripe.server";
import {
  getAccountByRootFolderId,
  getAccountByEmail,
  getAccountByStripeCustomerId,
  createAccount,
  setAccountBillingStatus,
  updateAccount,
} from "~/services/hubwork-accounts.server";
import { removeDomain } from "~/services/hubwork-domain.server";

/**
 * Resolve which plan a Stripe price id corresponds to. Used to reconcile
 * Firestore's stored plan against a subscription price change made outside
 * our own checkout flow (e.g. the Stripe Billing Portal, if its
 * configuration allows switching products) — without this, an account could
 * end up billed at one plan while still entitled to another.
 */
function planFromPriceId(priceId: string | undefined): "lite" | "pro" | "business" | undefined {
  if (!priceId) return undefined;
  if (priceId === process.env.STRIPE_PRICE_ID_LITE || priceId === process.env.STRIPE_PRICE_ID_LITE_USD) return "lite";
  if (priceId === process.env.STRIPE_PRICE_ID_PRO || priceId === process.env.STRIPE_PRICE_ID_PRO_USD) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ID_BUSINESS || priceId === process.env.STRIPE_PRICE_ID_BUSINESS_USD) return "business";
  return undefined;
}

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
        // One add-on per organization; quantity is fixed at 1 (100 + 500 GB).
        const units = 1;
        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || "";
        if (orgId && subscriptionId) {
          const { setOrgStorageAddon } = await import("~/services/organizations.server");
          await setOrgStorageAddon(orgId, subscriptionId, units);
        }
        break;
      }

      // Vertex budget top-up (one-time payment): extend the org's AI budget
      // for the current billing period by one unit's worth per purchased
      // unit. Idempotent via the checkout session id.
      if (session.metadata?.type === "vertex-topup") {
        const orgId = session.metadata.orgId || "";
        const units = Math.max(1, Math.min(20, parseInt(session.metadata.units || "1", 10) || 1));
        if (orgId) {
          const { addAiBudgetTopUp, VERTEX_TOPUP_UNIT_CREDIT_USD } = await import("~/services/ai-budget.server");
          await addAiBudgetTopUp(orgId, units * VERTEX_TOPUP_UNIT_CREDIT_USD, session.id);
        }
        break;
      }

      // Personal Vertex budget top-up (one-time payment): add to the user's
      // personal prepaid AI balance. Idempotent via the checkout session id.
      if (session.metadata?.type === "personal-vertex-topup") {
        // Checkout refuses to start without an email, so a missing one here
        // means a paid session we cannot credit — log it loudly rather than
        // dropping the payment silently.
        const email = session.metadata.email || session.customer_details?.email || "";
        const units = Math.max(1, Math.min(20, parseInt(session.metadata.units || "1", 10) || 1));
        if (!email) {
          console.error(`[stripe-webhook] personal-vertex-topup ${session.id} has no email to credit`);
          break;
        }
        const { addPersonalAiBudgetTopUp, VERTEX_TOPUP_UNIT_CREDIT_USD } = await import("~/services/ai-budget.server");
        const { emailToUid } = await import("~/services/organizations.server");
        const credited = await addPersonalAiBudgetTopUp(
          emailToUid(email),
          units * VERTEX_TOPUP_UNIT_CREDIT_USD,
          session.id,
        );
        if (!credited) {
          console.warn(`[stripe-webhook] personal-vertex-topup ${session.id} already credited; ignoring redelivery`);
        }
        break;
      }

      const rootFolderId = session.metadata?.rootFolderId || "";
      const accountSlug = session.metadata?.accountSlug || "";
      // Missing plan metadata means a legacy pre-Pro session (Business used
      // to be the only paid plan besides Lite) — default to business for
      // compatibility with those old Checkout Sessions. Any other,
      // unrecognized value is a bug upstream (checkout.tsx validates plan
      // before creating the Session) and must not silently grant Business
      // entitlements.
      const rawPlan = session.metadata?.plan;
      let planType: "lite" | "pro" | "business";
      if (rawPlan === undefined) {
        planType = "business";
      } else if (rawPlan === "lite" || rawPlan === "pro" || rawPlan === "business") {
        planType = rawPlan;
      } else {
        console.error(`[stripe-webhook] checkout.session.completed ${session.id} has unrecognized plan metadata: ${rawPlan}`);
        break;
      }
      const currency = (session.metadata?.currency === "usd" ? "usd" : "jpy") as "jpy" | "usd";
      const email = session.customer_details?.email || "";
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : "";
      const additionalOrganization = session.metadata?.additionalOrganization === "true";

      // Find existing account by rootFolderId or email
      let account = additionalOrganization ? null : rootFolderId ? await getAccountByRootFolderId(rootFolderId) : null;
      if (!additionalOrganization && !account && email) {
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
        await setAccountBillingStatus(account.id, "active");
        provisionedAccountId = account.id;
      } else {
        const newId = await createAccount({
          email: email || "",
          refreshToken: "",
          rootFolderName: "",
          // Additional Business subscriptions belong to an organization, not
          // the buyer's personal Drive billing record. Keeping this empty also
          // leaves the single personal Premium lookup deterministic.
          rootFolderId: additionalOrganization ? "" : rootFolderId || "",
          plan: planType,
          currency,
          accountSlug: accountSlug || undefined,
          allowDuplicateOwner: additionalOrganization,
          idempotencyKey: additionalOrganization ? session.id : undefined,
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
          forceNewOrganization: additionalOrganization,
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
          await setAccountBillingStatus(account.id, "canceled");
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
          if (active) await setOrgStorageAddon(orgId, subscription.id, Math.max(1, Math.min(1, quantity)));
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
          // Keep Firestore's plan in sync with whatever Stripe is actually
          // billing, in case the price changed outside our own checkout
          // flow's guards (e.g. via the Billing Portal).
          const newPlan = planFromPriceId(subscription.items.data[0]?.price?.id);
          if (
            newPlan &&
            (account.plan === "lite" || account.plan === "pro" || account.plan === "business") &&
            newPlan !== account.plan
          ) {
            if (account.plan === "business" && newPlan === "pro") {
              console.warn(`[stripe-webhook] account ${account.id} moved from business to pro outside the app's own checkout flow — plan reconciled to match billing, but organization data was not deprovisioned and needs manual review`);
            }
            await updateAccount(account.id, { plan: newPlan });
          }
          await setAccountBillingStatus(account.id, billingStatus);
        }
      }
      break;
    }
  }

  return Response.json({ received: true });
}
