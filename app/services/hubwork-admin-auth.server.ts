import { requireAuth } from "./session.server";

function getAdminEmails(): string[] {
  const raw = process.env.HUBWORK_ADMIN_EMAILS;
  if (!raw) {
    throw new Response("HUBWORK_ADMIN_EMAILS not configured", { status: 500 });
  }
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Require Google OAuth login with email in HUBWORK_ADMIN_EMAILS.
 * Basic Auth is handled at the HTTP server level (before React Router).
 */
export async function requireAdminAuth(request: Request) {
  const tokens = await requireAuth(request);

  if (!tokens.email) {
    throw new Response("Session missing email. Please re-login.", { status: 403 });
  }

  const allowed = getAdminEmails();
  if (!allowed.includes(tokens.email.toLowerCase().trim())) {
    throw new Response("Forbidden: not an admin", { status: 403 });
  }

  return tokens;
}
