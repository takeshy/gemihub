import { redirect } from "react-router";
import type { Route } from "./+types/hubwork.admin.account-create";
import { requireAdminAuth } from "~/services/hubwork-admin-auth.server";
import { createAccount, getAccountByEmail } from "~/services/hubwork-accounts.server";
import { validateOrigin } from "~/utils/security";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdminAuth(request);
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  validateOrigin(request);
  await requireAdminAuth(request);
  const formData = await request.formData();
  const email = (formData.get("email") as string || "").trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Valid email is required" };
  }

  const existing = await getAccountByEmail(email);
  if (existing) {
    return { error: "An account with this email already exists" };
  }

  await createAccount({
    email,
    refreshToken: "",
    rootFolderName: "",
    rootFolderId: "",
    plan: "granted",
  });

  return redirect("/hubwork/admin");
}

export default function AdminCreateAccount({ actionData }: Route.ComponentProps) {
  const error = actionData?.error;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Create Granted Account</title>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; background: #f9fafb; }
          h1 { color: #111827; font-size: 20px; }
          .card { background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          label { display: block; font-size: 14px; font-weight: 500; color: #374151; margin-bottom: 4px; }
          input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
          .error { color: #dc2626; font-size: 14px; margin-bottom: 12px; }
          .actions { display: flex; gap: 12px; margin-top: 20px; }
          .btn { padding: 8px 16px; border-radius: 6px; font-size: 14px; cursor: pointer; border: none; }
          .btn-primary { background: #2563eb; color: white; }
          .btn-secondary { background: #e5e7eb; color: #374151; text-decoration: none; display: inline-block; }
          a { color: #2563eb; text-decoration: none; font-size: 14px; }
          .hint { font-size: 13px; color: #6b7280; margin-top: 4px; }
        `}</style>
      </head>
      <body>
        <p><a href="/hubwork/admin">&larr; Back to list</a></p>
        <h1>Create Granted Account</h1>
        <div className="card">
          {error && <p className="error">{error}</p>}
          <form method="post">
            <label>Email</label>
            <input name="email" type="email" required placeholder="user@example.com" />
            <p className="hint">The user can enable Hubwork from Settings after logging in with this email.</p>
            <div className="actions">
              <button type="submit" className="btn btn-primary">Create</button>
              <a href="/hubwork/admin" className="btn btn-secondary">Cancel</a>
            </div>
          </form>
        </div>
      </body>
    </html>
  );
}
