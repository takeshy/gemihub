import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.admin.account";
import { requireAdminAuth } from "~/services/hubwork-admin-auth.server";
import { getAccountById, updateAccount, deleteAccount } from "~/services/hubwork-accounts.server";
import type { HubworkAccountPlan, HubworkAccountStatus, HubworkBillingStatus, HubworkDomainStatus } from "~/types/hubwork";
import { validateOrigin } from "~/utils/security";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireAdminAuth(request);
  const account = await getAccountById(params.accountId);
  if (!account) throw new Response("Account not found", { status: 404 });
  return { account };
}

export async function action({ request, params }: Route.ActionArgs) {
  validateOrigin(request);
  await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "update": {
      const plan = formData.get("plan") as string;
      const billingStatus = formData.get("billingStatus") as string;
      const accountStatus = formData.get("accountStatus") as string;
      const domainStatus = formData.get("domainStatus") as string;
      const email = (formData.get("email") as string || "").trim();
      const validPlans: HubworkAccountPlan[] = ["lite", "pro", "granted"];
      const validBillingStatuses: HubworkBillingStatus[] = ["active", "past_due", "canceled"];
      const validAccountStatuses: HubworkAccountStatus[] = ["enabled", "disabled"];
      const validDomainStatuses: HubworkDomainStatus[] = ["none", "pending_dns", "provisioning_cert", "active", "failed"];
      if (!validPlans.includes(plan as HubworkAccountPlan)) throw new Response("Invalid plan", { status: 400 });
      if (!validBillingStatuses.includes(billingStatus as HubworkBillingStatus)) throw new Response("Invalid billingStatus", { status: 400 });
      if (!validAccountStatuses.includes(accountStatus as HubworkAccountStatus)) throw new Response("Invalid accountStatus", { status: 400 });
      if (!validDomainStatuses.includes(domainStatus as HubworkDomainStatus)) throw new Response("Invalid domainStatus", { status: 400 });
      await updateAccount(params.accountId, {
        plan: plan as HubworkAccountPlan,
        billingStatus: billingStatus as HubworkBillingStatus,
        accountStatus: accountStatus as HubworkAccountStatus,
        domainStatus: domainStatus as HubworkDomainStatus,
        email,
      });
      return redirect(`/hubwork/admin/accounts/${params.accountId}`);
    }
    case "delete": {
      await deleteAccount(params.accountId);
      return redirect("/hubwork/admin");
    }
    default:
      throw new Response("Unknown intent", { status: 400 });
  }
}

export default function AdminAccountDetail({ loaderData }: Route.ComponentProps) {
  const { account } = loaderData;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Account: {account.email || account.id}</title>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; background: #f9fafb; }
          h1 { color: #111827; font-size: 20px; }
          .card { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          label { display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 4px; margin-top: 16px; }
          input, select { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
          .info { font-size: 13px; color: #6b7280; margin-top: 4px; }
          .actions { display: flex; gap: 12px; margin-top: 24px; }
          .btn { padding: 8px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; border: none; }
          .btn-primary { background: #2563eb; color: white; }
          .btn-danger { background: #dc2626; color: white; }
          .btn-secondary { background: #e5e7eb; color: #374151; text-decoration: none; display: inline-block; }
          a { color: #2563eb; text-decoration: none; font-size: 14px; }
        `}</style>
      </head>
      <body>
        <p><a href="/hubwork/admin">&larr; Back to list</a></p>
        <h1>Account: {account.email || account.id}</h1>
        <div className="card">
          <form method="post">
            <input type="hidden" name="intent" value="update" />

            <label>Email</label>
            <input name="email" defaultValue={account.email} />

            <label>Plan</label>
            <select name="plan" defaultValue={account.plan || "granted"}>
              <option value="granted">Granted (free)</option>
              <option value="lite">Lite (¥300)</option>
              <option value="pro">Pro (¥2,000)</option>
            </select>

            <label>Billing Status</label>
            <select name="billingStatus" defaultValue={account.billingStatus}>
              <option value="active">Active</option>
              <option value="past_due">Past Due</option>
              <option value="canceled">Canceled</option>
            </select>

            <label>Account Status</label>
            <select name="accountStatus" defaultValue={account.accountStatus}>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>

            <label>Domain Status</label>
            <select name="domainStatus" defaultValue={account.domainStatus}>
              <option value="none">None</option>
              <option value="pending_dns">Pending DNS</option>
              <option value="provisioning_cert">Provisioning Cert</option>
              <option value="active">Active</option>
              <option value="failed">Failed</option>
            </select>

            <label>Account Slug</label>
            <p className="info">{account.accountSlug || "—"}</p>

            <label>Built-in Domain</label>
            <p className="info">{account.defaultDomain || "—"}</p>

            <label>Custom Domain</label>
            <p className="info">{account.customDomain || "—"}</p>

            <label>Root Folder ID</label>
            <p className="info">{account.rootFolderId || "—"}</p>

            <label>Stripe Customer ID</label>
            <p className="info">{account.stripeCustomerId || "—"}</p>

            <label>Stripe Subscription ID</label>
            <p className="info">{account.stripeSubscriptionId || "—"}</p>

            <div className="actions">
              <button type="submit" className="btn btn-primary">Save</button>
              <a href="/hubwork/admin" className="btn btn-secondary">Cancel</a>
            </div>
          </form>

          <form method="post" style={{ marginTop: 32, borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
            <input type="hidden" name="intent" value="delete" />
            <button type="submit" className="btn btn-danger" onClick={(e) => { if (!confirm("Delete this account?")) e.preventDefault(); }}>
              Delete Account
            </button>
          </form>
        </div>
      </body>
    </html>
  );
}
