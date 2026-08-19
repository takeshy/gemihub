/**
 * Organization storage quota.
 *
 * The Business plan includes 100 GB of project storage per organization;
 * administrators can add capacity in 500 GB units ($30 / ¥5,000 per month,
 * one Stripe add-on subscription per purchase — see storageAddons on the
 * Organization document).
 *
 * Usage accounting: a lazily-recomputed Firestore counter
 * (`organizations/{orgId}/meta/storageUsage`) summed by paging every
 * project prefix, refreshed when older than USAGE_TTL_MS, plus an in-memory
 * optimistic bump per write so bursts inside the TTL can't blow far past
 * the quota. Overwrites are counted at their full new size until the next
 * recompute — deliberately conservative.
 *
 * Enforcement lives in gcs-storage.writeObject (the single choke point for
 * all project-mount writes). Transient accounting errors fail open — quota
 * is billing enforcement, not a security boundary.
 */

import type { Organization, ProjectAccessContext, TenantInfo } from "~/types/enterprise";
import { getFirestore, ORGANIZATIONS } from "./firestore.server";
import { getOrganization } from "./organizations.server";
import { listProjectsInOrg } from "./projects.server";

export const BUSINESS_INCLUDED_STORAGE_GB = 100;
export const STORAGE_ADDON_UNIT_GB = 500;
const GB = 1_000_000_000;
const USAGE_TTL_MS = 10 * 60 * 1000;
const LOCAL_CACHE_TTL_MS = 30 * 1000;

export class StorageQuotaExceededError extends Error {
  readonly status = 413;
  constructor(
    public readonly orgId: string,
    public readonly quotaGb: number,
    public readonly usedBytes: number,
  ) {
    super(
      `organization storage quota of ${quotaGb} GB is full ` +
      `(${(usedBytes / GB).toFixed(2)} GB used) — free up space or purchase additional storage`,
    );
    this.name = "StorageQuotaExceededError";
  }
}

export function storageAddonUnits(org: Organization): number {
  return Object.values(org.storageAddons ?? {}).reduce(
    (sum, units) => sum + (Number.isFinite(units) ? Number(units) : 0),
    0,
  );
}

export function storageQuotaGbForOrg(org: Organization): number {
  return BUSINESS_INCLUDED_STORAGE_GB + storageAddonUnits(org) * STORAGE_ADDON_UNIT_GB;
}

interface UsageDoc {
  bytes: number;
  computedAt: number;
}

function usageDocRef(orgId: string) {
  return getFirestore().collection(ORGANIZATIONS).doc(orgId).collection("meta").doc("storageUsage");
}

async function recomputeOrgStorageBytes(orgId: string, tenant: TenantInfo): Promise<number> {
  const { listObjects } = await import("./gcs-storage.server");
  const projects = await listProjectsInOrg(orgId);
  let total = 0;
  for (const project of projects) {
    const ctx: ProjectAccessContext = {
      uid: "storage-quota",
      role: "viewer",
      orgId,
      projectId: project.id,
      tenant,
      gcsPrefix: project.gcsPrefix,
      allowedModels: project.allowedModels,
    };
    let pageToken: string | undefined;
    do {
      const page = await listObjects(ctx, { pageToken, pageSize: 1000 });
      for (const object of page.objects) total += object.size || 0;
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  await usageDocRef(orgId).set({ bytes: total, computedAt: Date.now() } satisfies UsageDoc);
  return total;
}

// Per-instance cache: { bytes (with optimistic bumps), fetchedAt }
const localUsage = new Map<string, { bytes: number; fetchedAt: number }>();

export async function getOrgStorageUsageBytes(
  orgId: string,
  tenant: TenantInfo,
  options?: { forceRecompute?: boolean },
): Promise<number> {
  const cached = localUsage.get(orgId);
  if (!options?.forceRecompute && cached && Date.now() - cached.fetchedAt < LOCAL_CACHE_TTL_MS) {
    return cached.bytes;
  }
  let bytes: number;
  if (options?.forceRecompute) {
    bytes = await recomputeOrgStorageBytes(orgId, tenant);
  } else {
    const snap = await usageDocRef(orgId).get();
    const doc = snap.data() as UsageDoc | undefined;
    bytes = doc && Date.now() - doc.computedAt < USAGE_TTL_MS
      ? doc.bytes
      : await recomputeOrgStorageBytes(orgId, tenant);
  }
  localUsage.set(orgId, { bytes, fetchedAt: Date.now() });
  return bytes;
}

/**
 * Throws StorageQuotaExceededError when writing `incomingBytes` would push
 * the organization past its quota. Fails open on accounting errors.
 */
export async function assertStorageQuota(
  ctx: ProjectAccessContext,
  incomingBytes: number,
): Promise<void> {
  let quotaGb: number;
  let used: number;
  try {
    const org = await getOrganization(ctx.orgId);
    if (!org) return;
    quotaGb = storageQuotaGbForOrg(org);
    used = await getOrgStorageUsageBytes(ctx.orgId, ctx.tenant);
  } catch (err) {
    console.warn("[storage-quota] accounting unavailable, allowing write:", err);
    return;
  }
  if (used + incomingBytes > quotaGb * GB) {
    throw new StorageQuotaExceededError(ctx.orgId, quotaGb, used);
  }
  // Optimistic bump so a burst of writes inside the cache TTL still
  // converges on the limit.
  const cached = localUsage.get(ctx.orgId);
  if (cached) cached.bytes += incomingBytes;
}
