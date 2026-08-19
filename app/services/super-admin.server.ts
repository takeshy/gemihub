/**
 * Super-admin gate — Phase 6.
 *
 * Super admins have cross-organization visibility and can perform
 * destructive operations (delete orgs, view audit logs for any org,
 * manage billing). They are NOT Organization members by default —
 * their power comes from this module, not from Firestore ACL.
 *
 * Configuration (env, comma-separated):
 *   SUPER_ADMIN_EMAILS=alice@example.com,bob@example.com
 *
 * In production these should be company staff only. There is no UI
 * to add/remove super admins — it requires a deployment change.
 */

const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export function isSuperAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}

/** Assert super admin; throws 403 Response if not. */
export function requireSuperAdmin(email: string | undefined): void {
  if (!isSuperAdmin(email)) {
    throw new Response("Forbidden: super admin required", { status: 403 });
  }
}

/**
 * Require either:
 *   a) the user is a super admin, OR
 *   b) the user is a member of the org with role >= minRole.
 *
 * Used for admin routes that super admins can view for any org.
 */
export async function requireSuperAdminOrOrgRole(
  email: string | undefined,
  orgId: string,
  minRole: "owner" | "admin" | "member",
  checkMembership: (orgId: string, uid: string) => Promise<{ role: string } | null>,
): Promise<void> {
  if (isSuperAdmin(email)) return;

  // Fallback to org membership check
  const { emailToUid } = await import("~/services/organizations.server");
  const uid = emailToUid(email ?? "");
  const member = await checkMembership(orgId, uid);
  if (!member) {
    throw new Response("Forbidden: not a member of this organization", { status: 403 });
  }

  const roleHierarchy = { owner: 3, admin: 2, member: 1 };
  const userLevel = roleHierarchy[member.role as keyof typeof roleHierarchy] ?? 0;
  const requiredLevel = roleHierarchy[minRole] ?? 0;
  if (userLevel < requiredLevel) {
    throw new Response(`Forbidden: requires ${minRole} role`, { status: 403 });
  }
}
