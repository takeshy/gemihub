/**
 * GET /api/storage/quota?mount=project:{id}
 *
 * Storage accounting for the mount, used by the sync stack to refuse a push or
 * pull before it starts rather than failing part-way through a write.
 *
 * The Drive mount has no organization quota, so it reports `exceeded: false`.
 */

import type { Route } from "./+types/api.storage.quota";
import { resolveMount } from "~/services/storage/resolve-mount.server";
import { errorResponse } from "~/services/storage-route-utils.server";
import {
  BUSINESS_INCLUDED_STORAGE_GB,
  getOrgStorageUsageBytes,
  storageAddonUnits,
  storageQuotaGbForOrg,
} from "~/services/storage-quota.server";
import { getOrganization } from "~/services/organizations.server";

const GB = 1_000_000_000;

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const mount = new URL(request.url).searchParams.get("mount") ?? "drive";
    const ctx = await resolveMount(request, mount, "viewer");
    if (ctx.kind !== "gcs-project" || !ctx.gcs) {
      return Response.json({ exceeded: false, usedBytes: null, quotaGb: null });
    }
    const org = await getOrganization(ctx.gcs.orgId);
    if (!org) return Response.json({ exceeded: false, usedBytes: null, quotaGb: null });

    const quotaGb = storageQuotaGbForOrg(org);
    // Accounting problems must not block sync — the write path enforces the
    // quota anyway, and failing closed here would strand a working project.
    const usedBytes = await getOrgStorageUsageBytes(ctx.gcs.orgId, ctx.gcs.tenant).catch(() => null);
    return Response.json({
      usedBytes,
      quotaGb,
      includedGb: BUSINESS_INCLUDED_STORAGE_GB,
      addonUnits: storageAddonUnits(org),
      exceeded: usedBytes != null && usedBytes >= quotaGb * GB,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
