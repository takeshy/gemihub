import type { Route } from "./+types/hubwork.admin";
import { requireAdminAuth } from "~/services/hubwork-admin-auth.server";
import { getAllAccounts } from "~/services/hubwork-accounts.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminAuth(request);
  const accounts = await getAllAccounts();
  return { accounts };
}

export default function AdminDashboard({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hubwork Admin</title>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #f9fafb; }
          h1 { color: #111827; }
          table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
          th { background: #f3f4f6; font-weight: 600; color: #374151; }
          td { color: #4b5563; }
          a { color: #2563eb; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 500; }
          .badge-paid { background: #dbeafe; color: #1e40af; }
          .badge-granted { background: #d1fae5; color: #065f46; }
          .badge-active { background: #d1fae5; color: #065f46; }
          .badge-inactive { background: #fee2e2; color: #991b1b; }
          .badge-other { background: #f3f4f6; color: #374151; }
          .btn { display: inline-block; padding: 8px 16px; background: #2563eb; color: white; border-radius: 6px; font-size: 14px; }
          .btn:hover { background: #1d4ed8; text-decoration: none; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        `}</style>
      </head>
      <body>
        <div className="header">
          <h1>Hubwork Admin</h1>
          <a href="/hubwork/admin/accounts/create" className="btn">Create Account</a>
        </div>

        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Domain</th>
              <th>Plan</th>
              <th>Billing</th>
              <th>Account</th>
              <th>Domain Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 40 }}>No accounts</td></tr>
            ) : accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.email || "—"}</td>
                <td>{account.defaultDomain || account.customDomain || "—"}</td>
                <td>
                  <span className={`badge badge-${account.plan || "other"}`}>
                    {account.plan || "none"}
                  </span>
                </td>
                <td>
                  <span className={`badge badge-${account.billingStatus === "active" ? "active" : "inactive"}`}>
                    {account.billingStatus}
                  </span>
                </td>
                <td>
                  <span className={`badge badge-${account.accountStatus === "enabled" ? "active" : "inactive"}`}>
                    {account.accountStatus}
                  </span>
                </td>
                <td>
                  <span className={`badge badge-${account.domainStatus === "active" ? "active" : account.domainStatus === "none" ? "other" : "inactive"}`}>
                    {account.domainStatus}
                  </span>
                </td>
                <td>{account.createdAt && typeof (account.createdAt as unknown as { toDate?: () => Date }).toDate === "function" ? (account.createdAt as unknown as { toDate(): Date }).toDate().toLocaleDateString() : "—"}</td>
                <td><a href={`/hubwork/admin/accounts/${account.id}`}>Edit</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </body>
    </html>
  );
}
