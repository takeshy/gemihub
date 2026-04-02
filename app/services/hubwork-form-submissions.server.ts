import { FieldValue } from "@google-cloud/firestore";
import crypto from "node:crypto";
import { getFirestore, HUBWORK_FORM_SUBMISSIONS } from "./firestore.server";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Firestore-based idempotency check for form submissions.
 * Returns true if the key already exists (duplicate), false if new (and writes the key).
 * Uses transactional check-and-set to work correctly across multiple Cloud Run instances.
 */
export async function checkFormIdempotency(
  accountId: string,
  key: string
): Promise<boolean> {
  const db = getFirestore();
  const safeKey = crypto.createHash("sha256").update(key).digest("hex");
  const docId = `${accountId}_${safeKey}`;
  const docRef = db.collection(HUBWORK_FORM_SUBMISSIONS).doc(docId);

  const result = await db.runTransaction(async (tx) => {
    const doc = await tx.get(docRef);
    if (doc.exists) {
      return true; // duplicate
    }
    tx.set(docRef, {
      accountId,
      key,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    return false; // new submission
  });

  return result;
}
