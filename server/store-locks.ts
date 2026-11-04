import { randomUUID } from "node:crypto";
import type { DocumentReference, Firestore, Transaction } from "@google-cloud/firestore";
import { tr } from "../shared/i18n.ts";

export const lockLeaseMs = 5 * 60_000;
export const lockRenewMs = 60_000;
export type LockLease = { ref: DocumentReference; owner: string; expiresAt: number; active: boolean; lost: boolean };
export const lockLost = () => Object.assign(new Error(tr("操作の有効期限が切れました。最新の状態を確認して再試行してください")), { status: 503 });

export function assertLocalLocks(leases: LockLease[]) {
  if (leases.some(lease => !lease.active || lease.lost || lease.expiresAt <= Date.now())) throw lockLost();
}

/** These reads must be in the same transaction as the protected business writes. */
export async function assertLocks(tx: Transaction, leases: LockLease[]) {
  assertLocalLocks(leases);
  for (const lease of leases) {
    const doc = await tx.get(lease.ref);
    if (!doc.exists || doc.get("owner") !== lease.owner || doc.get("expiresAt") <= Date.now()) {
      lease.lost = true;
      throw lockLost();
    }
  }
}

export async function acquireLock(db: Firestore, ref: DocumentReference, id: string): Promise<LockLease | undefined> {
  const owner = randomUUID();
  const expiresAt = await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const now = Date.now();
    // The original format had only `at`. Recover those locks after the same
    // grace period; malformed timestamps remain blocked for operator review.
    const expires = doc.exists ? doc.get("expiresAt") ?? Date.parse(doc.get("at")) + lockLeaseMs : 0;
    if (doc.exists && (!Number.isFinite(expires) || expires > now)) return undefined;
    const until = now + lockLeaseMs;
    tx.set(ref, { shopId: id, at: new Date(now).toISOString(), owner, expiresAt: until });
    return until;
  });
  return expiresAt === undefined ? undefined : { ref, owner, expiresAt, active: true, lost: false };
}

export async function renewLock(db: Firestore, lease: LockLease) {
  const expiresAt = await db.runTransaction(async tx => {
    await assertLocks(tx, [lease]);
    const until = Date.now() + lockLeaseMs;
    tx.update(lease.ref, { expiresAt: until });
    return until;
  });
  lease.expiresAt = expiresAt;
}

export async function releaseLock(db: Firestore, lease: LockLease) {
  lease.active = false;
  await db.runTransaction(async tx => {
    const doc = await tx.get(lease.ref);
    // A delayed finally must never remove a replacement owner's lock.
    if (doc.exists && doc.get("owner") === lease.owner) tx.delete(lease.ref);
  });
}
