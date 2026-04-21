/**
 * Cleanup orphaned Hubwork custom-domain resources in GCP Certificate Manager.
 *
 * Usage:
 *   npx tsx scripts/cleanup-hubwork-domains.ts            # dry run (default)
 *   npx tsx scripts/cleanup-hubwork-domains.ts --delete   # actually delete
 *
 * Required env:
 *   GCP_PROJECT_ID
 *   HUBWORK_CERT_MAP_NAME   (default: "gemihub-map")
 *   FIRESTORE_DATABASE_ID   (optional, if using a non-default database)
 *
 * Identifies:
 *   - `hw-entry-*` cert map entries whose hostname is not in any Firestore
 *     account's customDomain (includes orphans patched to a different accountId)
 *   - `hw-cert-*` certificates whose suffix does not match any Firestore
 *     account with customDomain set
 *   - `hw-auth-*` DNS authorizations whose suffix does not match any Firestore
 *     account with customDomain set
 */
import { google } from "googleapis";
import { getFirestore, HUBWORK_ACCOUNTS } from "../app/services/firestore.server";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "";
const CERT_MAP_NAME = process.env.HUBWORK_CERT_MAP_NAME || "gemihub-map";

if (!PROJECT_ID) {
  console.error("GCP_PROJECT_ID environment variable is required");
  process.exit(1);
}

const shouldDelete = process.argv.includes("--delete");

type CertManager = ReturnType<typeof google.certificatemanager>;

async function listAll<T>(
  fetchPage: (pageToken: string | undefined) => Promise<{ items: T[]; nextPageToken?: string }>
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const { items, nextPageToken } = await fetchPage(pageToken);
    out.push(...items);
    pageToken = nextPageToken;
  } while (pageToken);
  return out;
}

async function loadAccountState() {
  const db = getFirestore();
  const snapshot = await db.collection(HUBWORK_ACCOUNTS).get();
  const validSuffixes = new Set<string>();
  const activeDomains = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (typeof data.customDomain === "string" && data.customDomain.length > 0) {
      validSuffixes.add(doc.id.toLowerCase());
      activeDomains.add(data.customDomain);
    }
  }
  return { validSuffixes, activeDomains };
}

function resourceId(fullName: string): string {
  return fullName.split("/").pop() || "";
}

async function main() {
  const { validSuffixes, activeDomains } = await loadAccountState();

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const certManager: CertManager = google.certificatemanager({ version: "v1", auth });
  const parent = `projects/${PROJECT_ID}/locations/global`;
  const parentMap = `${parent}/certificateMaps/${CERT_MAP_NAME}`;

  const entries = await listAll<{ name: string; hostname?: string }>(async (pageToken) => {
    const resp = await certManager.projects.locations.certificateMaps.certificateMapEntries.list({
      parent: parentMap,
      pageToken,
    });
    return {
      items: (resp.data.certificateMapEntries || [])
        .filter((e) => e.name)
        .map((e) => ({ name: e.name as string, hostname: e.hostname || undefined })),
      nextPageToken: resp.data.nextPageToken || undefined,
    };
  });

  const certs = await listAll<{ name: string }>(async (pageToken) => {
    const resp = await certManager.projects.locations.certificates.list({ parent, pageToken });
    return {
      items: (resp.data.certificates || []).filter((c) => c.name).map((c) => ({ name: c.name as string })),
      nextPageToken: resp.data.nextPageToken || undefined,
    };
  });

  const auths = await listAll<{ name: string }>(async (pageToken) => {
    const resp = await certManager.projects.locations.dnsAuthorizations.list({ parent, pageToken });
    return {
      items: (resp.data.dnsAuthorizations || []).filter((a) => a.name).map((a) => ({ name: a.name as string })),
      nextPageToken: resp.data.nextPageToken || undefined,
    };
  });

  const orphanEntries = entries.filter((e) => {
    const id = resourceId(e.name);
    if (!id.startsWith("hw-entry-")) return false;
    return !e.hostname || !activeDomains.has(e.hostname);
  });
  const orphanCerts = certs.filter((c) => {
    const id = resourceId(c.name);
    if (!id.startsWith("hw-cert-")) return false;
    return !validSuffixes.has(id.slice("hw-cert-".length));
  });
  const orphanAuths = auths.filter((a) => {
    const id = resourceId(a.name);
    if (!id.startsWith("hw-auth-")) return false;
    return !validSuffixes.has(id.slice("hw-auth-".length));
  });

  console.log(`Mode: ${shouldDelete ? "DELETE" : "DRY-RUN (pass --delete to apply)"}`);
  console.log(`Active accounts with customDomain: ${activeDomains.size}`);
  console.log("");
  console.log(`Orphan cert map entries (${orphanEntries.length}/${entries.filter((e) => resourceId(e.name).startsWith("hw-entry-")).length} hw-entry-*):`);
  for (const e of orphanEntries) console.log(`  - ${resourceId(e.name)} (hostname=${e.hostname ?? "<none>"})`);
  console.log(`Orphan certificates (${orphanCerts.length}/${certs.filter((c) => resourceId(c.name).startsWith("hw-cert-")).length} hw-cert-*):`);
  for (const c of orphanCerts) console.log(`  - ${resourceId(c.name)}`);
  console.log(`Orphan DNS authorizations (${orphanAuths.length}/${auths.filter((a) => resourceId(a.name).startsWith("hw-auth-")).length} hw-auth-*):`);
  for (const a of orphanAuths) console.log(`  - ${resourceId(a.name)}`);

  if (!shouldDelete) return;

  // Delete in dependency order: entry → cert → auth.
  console.log("\nDeleting...");
  for (const e of orphanEntries) {
    try {
      await certManager.projects.locations.certificateMaps.certificateMapEntries.delete({ name: e.name });
      console.log(`  deleted entry ${resourceId(e.name)}`);
    } catch (err) {
      console.warn(`  FAILED entry ${resourceId(e.name)}:`, err instanceof Error ? err.message : err);
    }
  }
  for (const c of orphanCerts) {
    try {
      await certManager.projects.locations.certificates.delete({ name: c.name });
      console.log(`  deleted cert ${resourceId(c.name)}`);
    } catch (err) {
      console.warn(`  FAILED cert ${resourceId(c.name)}:`, err instanceof Error ? err.message : err);
    }
  }
  for (const a of orphanAuths) {
    try {
      await certManager.projects.locations.dnsAuthorizations.delete({ name: a.name });
      console.log(`  deleted auth ${resourceId(a.name)}`);
    } catch (err) {
      console.warn(`  FAILED auth ${resourceId(a.name)}:`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
