import crypto from "node:crypto";
import { google } from "googleapis";
import { FieldValue, Timestamp } from "@google-cloud/firestore";
import { getFirestore, HUBWORK_ACCOUNTS } from "./firestore.server";
import type {
  HubworkAccount,
  HubworkAccountPlan,
  HubworkScheduleDoc,
  HubworkScheduleRuntime,
  ResolvedAccountTokens,
} from "~/types/hubwork";
import { isHubworkFeatureAvailable } from "~/types/hubwork";
import type { HubworkSchedule } from "~/types/settings";

// --- Encryption (AES-256-GCM, same pattern as session.server.ts) ---

const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return "dev-secret-change-in-production";
})();

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey(SESSION_SECRET);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string {
  const key = deriveKey(SESSION_SECRET);
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
}

// --- In-memory access token cache (per-account) ---

const tokenCache = new Map<
  string,
  { accessToken: string; expiryTime: number }
>();
const refreshPromises = new Map<string, Promise<ResolvedAccountTokens>>();

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// --- Gemini API Key encryption (same AES-256-GCM as refresh token) ---

export function encryptGeminiApiKey(apiKey: string): string {
  return encrypt(apiKey);
}

export function decryptGeminiApiKey(encrypted: string): string {
  return decrypt(encrypted);
}

// --- Account CRUD ---

/** Derive a slug from email (part before @, sanitized) */
function deriveSlugFromEmail(email: string): string {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export async function createAccount(params: {
  email: string;
  refreshToken: string;
  customDomain?: string;
  rootFolderName: string;
  rootFolderId: string;
  spreadsheetId?: string;
  plan?: HubworkAccountPlan;
  accountSlug?: string;
}): Promise<string> {
  const db = getFirestore();

  // Prevent duplicate accounts for the same email or rootFolderId
  if (params.email) {
    const byEmail = await getAccountByEmail(params.email);
    if (byEmail) return byEmail.id;
  }
  if (params.rootFolderId) {
    const byRoot = await getAccountByRootFolderId(params.rootFolderId);
    if (byRoot) return byRoot.id;
  }

  const slug = params.accountSlug || deriveSlugFromEmail(params.email);
  // Ensure slug uniqueness
  const existing = await getAccountBySlug(slug);
  const uniqueSlug = existing ? `${slug}-${Date.now().toString(36)}` : slug;

  const docRef = db.collection(HUBWORK_ACCOUNTS).doc();
  await docRef.set({
    email: params.email,
    encryptedRefreshToken: params.refreshToken ? encrypt(params.refreshToken) : null,
    accountSlug: uniqueSlug,
    defaultDomain: `${uniqueSlug}.gemihub.online`,
    customDomain: params.customDomain || "",
    rootFolderName: params.rootFolderName,
    rootFolderId: params.rootFolderId,
    spreadsheetId: params.spreadsheetId || null,
    plan: params.plan || "granted",
    billingStatus: "active",
    accountStatus: "enabled",
    domainStatus: params.customDomain ? "pending_dns" : "none",
    createdAt: FieldValue.serverTimestamp(),
  });
  return docRef.id;
}

/** Backwards-compatible conversion from Firestore doc to HubworkAccount */
function docToAccount(doc: FirebaseFirestore.DocumentSnapshot): HubworkAccount {
  const data = doc.data()!;
  // Migration: old docs have single `status` field instead of split statuses
  if (!data.billingStatus && data.status) {
    const s = data.status as string;
    if (s === "inactive") {
      data.billingStatus = "canceled";
    } else {
      data.billingStatus = "active";
    }
    if (s === "pending_dns" || s === "provisioning_cert") {
      data.domainStatus = s;
    } else if (s === "active" && data.customDomain) {
      data.domainStatus = "active";
    } else {
      data.domainStatus = "none";
    }
    data.accountStatus = s === "inactive" ? "disabled" : "enabled";
  }
  // Migration: old docs without slug/defaultDomain
  if (!data.accountSlug) {
    data.accountSlug = data.email ? deriveSlugFromEmail(data.email) : doc.id;
    data.defaultDomain = `${data.accountSlug}.gemihub.online`;
  }
  return { id: doc.id, plan: "granted", ...data } as HubworkAccount;
}

export async function getAccountById(
  accountId: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const doc = await db.collection(HUBWORK_ACCOUNTS).doc(accountId).get();
  if (!doc.exists) return null;
  return docToAccount(doc);
}

export async function getAccountByDomain(
  domain: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("customDomain", "==", domain)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return docToAccount(snapshot.docs[0]);
}

export async function getAccountByDefaultDomain(
  domain: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("defaultDomain", "==", domain)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return docToAccount(snapshot.docs[0]);
}

export async function getAccountBySlug(
  slug: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("accountSlug", "==", slug)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return docToAccount(snapshot.docs[0]);
}

export async function getAccountByRootFolderId(
  rootFolderId: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("rootFolderId", "==", rootFolderId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return docToAccount(snapshot.docs[0]);
}

export async function getAccountByEmail(
  email: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("email", "==", email.toLowerCase().trim())
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return docToAccount(snapshot.docs[0]);
}

export async function getAccountByStripeCustomerId(
  customerId: string
): Promise<HubworkAccount | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return docToAccount(snapshot.docs[0]);
}

export async function getAllActiveAccounts(): Promise<HubworkAccount[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .where("accountStatus", "==", "enabled")
    .get();
  return snapshot.docs
    .map((doc) => docToAccount(doc))
    .filter((a) => isHubworkFeatureAvailable(a));
}

export async function getAllAccounts(): Promise<HubworkAccount[]> {
  const db = getFirestore();
  const snapshot = await db.collection(HUBWORK_ACCOUNTS).get();
  return snapshot.docs.map((doc) => docToAccount(doc));
}

export async function updateAccount(
  accountId: string,
  data: Partial<
    Pick<
      HubworkAccount,
      | "email"
      | "accountSlug"
      | "defaultDomain"
      | "customDomain"
      | "rootFolderName"
      | "rootFolderId"
      | "spreadsheetId"
      | "billingStatus"
      | "accountStatus"
      | "domainStatus"
      | "plan"
      | "stripeCustomerId"
      | "stripeSubscriptionId"
      | "activeScheduleRevision"
      | "encryptedGeminiApiKey"
    >
  >
): Promise<void> {
  const db = getFirestore();
  await db.collection(HUBWORK_ACCOUNTS).doc(accountId).update(data);
}

export async function updateRefreshToken(
  accountId: string,
  refreshToken: string
): Promise<void> {
  const db = getFirestore();
  await db.collection(HUBWORK_ACCOUNTS).doc(accountId).update({
    encryptedRefreshToken: encrypt(refreshToken),
  });
  tokenCache.delete(accountId);
}

/** Remove the server-side encrypted Gemini API key from an account. */
export async function clearEncryptedGeminiApiKey(accountId: string): Promise<void> {
  const db = getFirestore();
  await db.collection(HUBWORK_ACCOUNTS).doc(accountId).update({
    encryptedGeminiApiKey: FieldValue.delete(),
  });
}

export async function deleteAccount(accountId: string): Promise<void> {
  const db = getFirestore();
  await db.collection(HUBWORK_ACCOUNTS).doc(accountId).delete();
  tokenCache.delete(accountId);
}

// --- Token management ---

export async function getTokensForAccount(
  account: HubworkAccount
): Promise<ResolvedAccountTokens> {
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiryTime > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return {
      accessToken: cached.accessToken,
      expiryTime: cached.expiryTime,
      rootFolderId: account.rootFolderId,
    };
  }

  // Deduplicate concurrent refresh requests for the same account
  const existing = refreshPromises.get(account.id);
  if (existing) return existing;

  const promise = (async (): Promise<ResolvedAccountTokens> => {
    if (!account.encryptedRefreshToken) {
      throw new Error(`Account ${account.id} has no refresh token. Owner must log in to GemiHub first.`);
    }
    const refreshToken = decrypt(account.encryptedRefreshToken);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error(`Failed to refresh access token for account ${account.id}`);
    }

    const result = {
      accessToken: credentials.access_token,
      expiryTime: credentials.expiry_date || Date.now() + 3600 * 1000,
    };
    tokenCache.set(account.id, result);

    return {
      ...result,
      rootFolderId: account.rootFolderId,
    };
  })();

  refreshPromises.set(account.id, promise);
  try {
    return await promise;
  } finally {
    refreshPromises.delete(account.id);
  }
}

// --- Schedule Index + Runtime (subcollections) ---

const SCHEDULE_INDEX_COLLECTION = "scheduleIndex";
const SCHEDULE_RUNTIME_COLLECTION = "scheduleRuntime";

export async function getSchedules(
  accountId: string
): Promise<(HubworkScheduleDoc & { id: string })[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .doc(accountId)
    .collection(SCHEDULE_INDEX_COLLECTION)
    .get();
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as HubworkScheduleDoc & { id: string }
  );
}

export async function getScheduleRuntimes(
  accountId: string
): Promise<Record<string, HubworkScheduleRuntime>> {
  const db = getFirestore();
  const snapshot = await db
    .collection(HUBWORK_ACCOUNTS)
    .doc(accountId)
    .collection(SCHEDULE_RUNTIME_COLLECTION)
    .get();
  const result: Record<string, HubworkScheduleRuntime> = {};
  for (const doc of snapshot.docs) {
    result[doc.id] = doc.data() as HubworkScheduleRuntime;
  }
  return result;
}

export async function updateScheduleRuntime(
  accountId: string,
  scheduleId: string,
  data: Record<string, unknown>
): Promise<void> {
  const db = getFirestore();
  await db
    .collection(HUBWORK_ACCOUNTS)
    .doc(accountId)
    .collection(SCHEDULE_RUNTIME_COLLECTION)
    .doc(scheduleId)
    .set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function tryAcquireScheduleLock(params: {
  accountId: string;
  scheduleId: string;
  timeoutSec: number;
  policy: "allow" | "forbid";
  now?: Date;
}): Promise<boolean> {
  if (params.policy === "allow") {
    return true;
  }

  const db = getFirestore();
  const now = params.now ?? new Date();
  const lockUntil = new Date(now.getTime() + params.timeoutSec * 1000);
  const docRef = db
    .collection(HUBWORK_ACCOUNTS)
    .doc(params.accountId)
    .collection(SCHEDULE_RUNTIME_COLLECTION)
    .doc(params.scheduleId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.exists ? (snap.data() as Partial<HubworkScheduleRuntime>) : {};
    const currentLock = data.lockedUntil instanceof Timestamp
      ? data.lockedUntil.toDate()
      : null;
    const isLocked = currentLock !== null && currentLock > now;

    if (params.policy === "forbid" && isLocked) {
      return false;
    }

    tx.set(docRef, {
      lockedUntil: Timestamp.fromDate(lockUntil),
      lastRunAt: Timestamp.fromDate(now),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

export async function setSchedule(
  accountId: string,
  scheduleId: string,
  data: HubworkScheduleDoc
): Promise<void> {
  const db = getFirestore();
  await db
    .collection(HUBWORK_ACCOUNTS)
    .doc(accountId)
    .collection(SCHEDULE_INDEX_COLLECTION)
    .doc(scheduleId)
    .set(data);
}

export async function deleteSchedule(
  accountId: string,
  scheduleId: string
): Promise<void> {
  const db = getFirestore();
  await db
    .collection(HUBWORK_ACCOUNTS)
    .doc(accountId)
    .collection(SCHEDULE_INDEX_COLLECTION)
    .doc(scheduleId)
    .delete();
}

/**
 * Rebuild the Firestore scheduleIndex using revision-based switching.
 * 1. Generate a new revision ID
 * 2. Write all new scheduleIndex entries with the new revision prefix
 * 3. Atomically switch the account's activeScheduleRevision
 * 4. Delete old revision entries asynchronously
 *
 * This avoids the "empty set" window that delete-all-then-write-all causes.
 */
export async function rebuildScheduleIndex(
  accountId: string,
  schedules: HubworkSchedule[]
): Promise<void> {
  const db = getFirestore();
  const accountRef = db.collection(HUBWORK_ACCOUNTS).doc(accountId);
  const colRef = accountRef.collection(SCHEDULE_INDEX_COLLECTION);

  // Read current active revision
  const accountDoc = await accountRef.get();
  const oldRevision = accountDoc.data()?.activeScheduleRevision as string | undefined;
  const newRevision = `rev_${Date.now().toString(36)}`;

  // Write new entries with revision-prefixed IDs
  const writeBatch = db.batch();
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i];
    const sourceVersion = crypto.createHash("md5").update(JSON.stringify(s)).digest("hex");
    const docRef = colRef.doc(`${newRevision}_s${i}`);
    writeBatch.set(docRef, {
      workflowPath: s.workflowPath,
      cron: s.cron,
      timezone: s.timezone || "UTC",
      enabled: s.enabled,
      variables: s.variables || {},
      retry: s.retry ?? 0,
      timeoutSec: s.timeoutSec ?? 300,
      concurrencyPolicy: s.concurrencyPolicy || "allow",
      missedRunPolicy: s.missedRunPolicy || "skip",
      updatedAt: FieldValue.serverTimestamp(),
      sourceVersion,
    });
  }
  await writeBatch.commit();

  // Atomically switch to new revision
  await accountRef.update({ activeScheduleRevision: newRevision });

  // Asynchronously delete old revision entries (best-effort)
  if (oldRevision) {
    deleteRevisionEntries(accountId, oldRevision).catch((e) => {
      console.warn(`[hubwork] Failed to clean up old schedule revision ${oldRevision}:`, e);
    });
  }
}

/** Delete scheduleIndex entries for a given revision prefix (best-effort cleanup) */
async function deleteRevisionEntries(accountId: string, revision: string): Promise<void> {
  const db = getFirestore();
  const colRef = db
    .collection(HUBWORK_ACCOUNTS)
    .doc(accountId)
    .collection(SCHEDULE_INDEX_COLLECTION);
  const snapshot = await colRef
    .where("__name__", ">=", `${revision}_`)
    .where("__name__", "<", `${revision}~`)
    .get();
  if (snapshot.empty) return;
  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
}

/**
 * Get active schedules for a given account (only from activeScheduleRevision).
 */
export async function getActiveSchedules(
  accountId: string
): Promise<(HubworkScheduleDoc & { id: string })[]> {
  const db = getFirestore();
  const accountRef = db.collection(HUBWORK_ACCOUNTS).doc(accountId);
  const accountDoc = await accountRef.get();
  const revision = accountDoc.data()?.activeScheduleRevision as string | undefined;
  if (!revision) return [];

  const colRef = accountRef.collection(SCHEDULE_INDEX_COLLECTION);
  // Query only entries with the active revision prefix
  const snapshot = await colRef
    .where("__name__", ">=", `${revision}_`)
    .where("__name__", "<", `${revision}~`)
    .get();
  return snapshot.docs.map(
    (doc) => ({ id: doc.id, ...doc.data() }) as HubworkScheduleDoc & { id: string }
  );
}
