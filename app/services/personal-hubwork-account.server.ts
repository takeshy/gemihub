import { getAccountByRootFolderId, getAccountByEmail } from "./hubwork-accounts.server";
import type { SessionTokens } from "./session.server";

type Identity = Pick<SessionTokens, "email" | "rootFolderId">;
const lookups = { getAccountByRootFolderId, getAccountByEmail };

/** Organization selection never determines ownership of personal credentials. */
export async function getOwnedPersonalAccount(identity: Identity, resolve = lookups) {
  const email = identity.email?.trim().toLowerCase();
  if (!email || !identity.rootFolderId) return null;
  const byRoot = await resolve.getAccountByRootFolderId(identity.rootFolderId);
  const account = byRoot ?? await resolve.getAccountByEmail(email);
  if (!account || account.email.trim().toLowerCase() !== email) return null;
  return account;
}
