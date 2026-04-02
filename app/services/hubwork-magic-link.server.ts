import crypto from "node:crypto";
import { Timestamp } from "@google-cloud/firestore";
import { getFirestore, HUBWORK_MAGIC_TOKENS } from "./firestore.server";

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim().replace(/\u3000/g, "").replace(/\s+/g, "");
}

/**
 * Generate a magic link token and store in Firestore.
 * Returns the token string. Invalidates previous unused tokens for the same email+account.
 */
export async function createMagicToken(
  email: string,
  accountId: string,
  type: string
): Promise<string> {
  const normalized = normalizeEmail(email);
  const db = getFirestore();
  const col = db.collection(HUBWORK_MAGIC_TOKENS);

  // Invalidate previous tokens for this email+account
  const existing = await col
    .where("email", "==", normalized)
    .where("accountId", "==", accountId)
    .where("used", "==", false)
    .get();
  const batch = db.batch();
  for (const doc of existing.docs) {
    batch.delete(doc.ref);
  }

  const token = crypto.randomUUID().replace(/-/g, "");
  batch.set(col.doc(token), {
    accountId,
    email: normalized,
    type,
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    used: false,
  });

  await batch.commit();
  return token;
}

/**
 * Verify a magic link token. Returns { email, accountId } if valid, null otherwise.
 * Uses a Firestore transaction to atomically mark the token as used.
 */
export async function verifyMagicToken(
  token: string
): Promise<{ email: string; accountId: string; type: string } | null> {
  const db = getFirestore();
  const docRef = db.collection(HUBWORK_MAGIC_TOKENS).doc(token);

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (!doc.exists) return null;

    const data = doc.data()!;
    if (data.used) return null;

    const expiresAt = data.expiresAt as Timestamp;
    if (expiresAt.toMillis() < Date.now()) {
      tx.delete(docRef);
      return null;
    }

    tx.update(docRef, { used: true });
    return { email: data.email as string, accountId: data.accountId as string, type: data.type as string };
  });
}
