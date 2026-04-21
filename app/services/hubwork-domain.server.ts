import { promises as dns } from "node:dns";
import { google } from "googleapis";
import { updateAccount } from "./hubwork-accounts.server";
import type { HubworkDomainStatus } from "~/types/hubwork";

/**
 * GCP resource names. Set via environment variables in production.
 */
const PROJECT_ID = process.env.GCP_PROJECT_ID || "";
const CERT_MAP_NAME = process.env.HUBWORK_CERT_MAP_NAME || "gemihub-map";
const LB_IP = process.env.HUBWORK_LB_IP || "";

export interface DnsRecord {
  type: "A" | "CNAME";
  name: string;
  value: string;
}

export interface DnsACheck {
  expected: string;        // LB IP we need users to point to
  actual: string[];        // IPs returned by public DNS, if any
  matches: boolean;        // expected ∈ actual
  error?: string;          // NXDOMAIN / NODATA / ETIMEOUT etc.
}

function getAuthClient() {
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
}

// GCP resource IDs allow only lower-case letters, digits, and hyphens.
// Firestore auto-IDs are mixed-case, so normalize before embedding.
function resourceSuffix(accountId: string): string {
  return accountId.toLowerCase();
}

type CertManagerClient = ReturnType<typeof google.certificatemanager>;

async function findCertMapEntryByHostname(
  certManager: CertManagerClient,
  parentMap: string,
  hostname: string
) {
  let pageToken: string | undefined;
  do {
    const resp = await certManager.projects.locations.certificateMaps.certificateMapEntries.list({
      parent: parentMap,
      pageToken,
    });
    const match = resp.data.certificateMapEntries?.find((e) => e.hostname === hostname);
    if (match) return match;
    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);
  return undefined;
}

async function checkDnsARecord(domain: string): Promise<DnsACheck | undefined> {
  if (!LB_IP) return undefined;
  try {
    const actual = await dns.resolve4(domain);
    return { expected: LB_IP, actual, matches: actual.includes(LB_IP) };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code || "UNKNOWN";
    return { expected: LB_IP, actual: [], matches: false, error: code };
  }
}

/**
 * Provision a custom domain for a Hubwork account.
 * 1. Create a DNS authorization
 * 2. Create a Certificate Manager certificate
 * 3. Create a Certificate Map entry
 * 4. Update account status in Firestore
 */
export async function provisionDomain(
  accountId: string,
  domain: string
): Promise<{ domainStatus: HubworkDomainStatus; dnsRecords: DnsRecord[]; message?: string }> {
  if (!PROJECT_ID) {
    throw new Error("GCP_PROJECT_ID environment variable is required for domain provisioning");
  }

  const auth = getAuthClient();
  const certManager = google.certificatemanager({ version: "v1", auth });

  // 1. Create DNS authorization
  const suffix = resourceSuffix(accountId);
  const authId = `hw-auth-${suffix}`;
  try {
    await certManager.projects.locations.dnsAuthorizations.create({
      parent: `projects/${PROJECT_ID}/locations/global`,
      dnsAuthorizationId: authId,
      requestBody: {
        domain,
      },
    });
  } catch (e: unknown) {
    const status = (e as { code?: number })?.code;
    if (status !== 409) throw e; // 409 = already exists, ok
  }

  // 2. Create certificate
  const certId = `hw-cert-${suffix}`;
  try {
    await certManager.projects.locations.certificates.create({
      parent: `projects/${PROJECT_ID}/locations/global`,
      certificateId: certId,
      requestBody: {
        managed: {
          domains: [domain],
          dnsAuthorizations: [
            `projects/${PROJECT_ID}/locations/global/dnsAuthorizations/${authId}`,
          ],
        },
      },
    });
  } catch (e: unknown) {
    const status = (e as { code?: number })?.code;
    if (status !== 409) throw e;
  }

  // 3. Create or reuse certificate map entry
  // Hostnames are unique within a cert map, so a stale entry from a prior
  // account lifecycle (different entry ID but same hostname) would make
  // create return a non-409 error. Reuse it by patching its certificates.
  const entryId = `hw-entry-${suffix}`;
  const parentMap = `projects/${PROJECT_ID}/locations/global/certificateMaps/${CERT_MAP_NAME}`;
  const certRef = `projects/${PROJECT_ID}/locations/global/certificates/${certId}`;

  const existingEntry = await findCertMapEntryByHostname(certManager, parentMap, domain);
  if (existingEntry?.name) {
    await certManager.projects.locations.certificateMaps.certificateMapEntries.patch({
      name: existingEntry.name,
      updateMask: "certificates",
      requestBody: { certificates: [certRef] },
    });
  } else {
    try {
      await certManager.projects.locations.certificateMaps.certificateMapEntries.create({
        parent: parentMap,
        certificateMapEntryId: entryId,
        requestBody: {
          hostname: domain,
          certificates: [certRef],
        },
      });
    } catch (e: unknown) {
      const status = (e as { code?: number })?.code;
      if (status !== 409) throw e;
    }
  }

  // The URL map has `default_service` routing any Host header to the Cloud
  // Run backend. SNI-based cert selection happens in the HTTPS proxy's
  // certificate map, so no URL-map host rule is needed per domain.

  // 4. Update Firestore
  await updateAccount(accountId, {
    customDomain: domain,
    domainStatus: "pending_dns",
  });

  // Get DNS authorization record for the user
  const dnsAuth = await certManager.projects.locations.dnsAuthorizations.get({
    name: `projects/${PROJECT_ID}/locations/global/dnsAuthorizations/${authId}`,
  });

  const dnsRecord = dnsAuth.data.dnsResourceRecord;
  const dnsRecords: DnsRecord[] = [];
  if (LB_IP) {
    dnsRecords.push({ type: "A", name: domain, value: LB_IP });
  }
  if (dnsRecord?.name && dnsRecord?.data) {
    dnsRecords.push({ type: "CNAME", name: dnsRecord.name, value: dnsRecord.data });
  }

  const message = dnsRecords.length === 0
    ? "DNS authorization created. Check the Google Cloud Console for the required DNS record."
    : undefined;

  return { domainStatus: "pending_dns", dnsRecords, message };
}

/**
 * Check the provisioning status of a custom domain.
 * Returns both the SSL certificate state (from Certificate Manager) and
 * the DNS A record state (from a live DNS lookup), since the domain only
 * routes end-to-end when BOTH are correctly configured.
 */
export async function getDomainStatus(
  accountId: string,
  domain?: string
): Promise<{
  domainStatus: HubworkDomainStatus;
  certState?: string;
  dnsACheck?: DnsACheck;
  message?: string;
}> {
  if (!PROJECT_ID) {
    return { domainStatus: "active", message: "Domain provisioning not available (no GCP_PROJECT_ID)" };
  }

  const auth = getAuthClient();
  const certManager = google.certificatemanager({ version: "v1", auth });
  const certId = `hw-cert-${resourceSuffix(accountId)}`;
  const dnsACheck = domain ? await checkDnsARecord(domain) : undefined;

  try {
    const cert = await certManager.projects.locations.certificates.get({
      name: `projects/${PROJECT_ID}/locations/global/certificates/${certId}`,
    });

    const state = cert.data.managed?.state || "unknown";

    if (state === "ACTIVE") {
      await updateAccount(accountId, { domainStatus: "active" });
      return { domainStatus: "active", certState: state, dnsACheck };
    }

    if (state === "PROVISIONING") {
      await updateAccount(accountId, { domainStatus: "provisioning_cert" });
      return { domainStatus: "provisioning_cert", certState: state, dnsACheck, message: "Certificate is being provisioned. This may take a few minutes." };
    }

    if (state === "FAILED") {
      await updateAccount(accountId, { domainStatus: "failed" });
      return { domainStatus: "failed", certState: state, dnsACheck, message: "Certificate provisioning failed." };
    }

    return {
      domainStatus: "pending_dns",
      certState: state,
      dnsACheck,
      message: `Certificate state: ${state}. Please verify your DNS records are correct.`,
    };
  } catch (e: unknown) {
    const errCode = (e as { code?: number })?.code;
    if (errCode === 404) {
      return { domainStatus: "pending_dns", dnsACheck, message: "Certificate not found. Run domain provisioning first." };
    }
    throw e;
  }
}

/**
 * Remove a custom domain from a Hubwork account.
 *
 * Deletes both the standard resources (named by the account suffix) and any
 * cert map entry matching the hostname, since a previously "reused" orphan
 * may live under an entry ID that does not match this account's suffix.
 */
export async function removeDomain(accountId: string, domain?: string): Promise<void> {
  if (!PROJECT_ID) return;

  const auth = getAuthClient();
  const certManager = google.certificatemanager({ version: "v1", auth });

  const suffix = resourceSuffix(accountId);
  const entryId = `hw-entry-${suffix}`;
  const certId = `hw-cert-${suffix}`;
  const authId = `hw-auth-${suffix}`;
  const parentMap = `projects/${PROJECT_ID}/locations/global/certificateMaps/${CERT_MAP_NAME}`;

  // Remove in reverse order: entry → cert → auth
  try {
    await certManager.projects.locations.certificateMaps.certificateMapEntries.delete({
      name: `${parentMap}/certificateMapEntries/${entryId}`,
    });
  } catch { /* ignore */ }

  if (domain) {
    const orphan = await findCertMapEntryByHostname(certManager, parentMap, domain);
    if (orphan?.name && !orphan.name.endsWith(`/${entryId}`)) {
      try {
        await certManager.projects.locations.certificateMaps.certificateMapEntries.delete({
          name: orphan.name,
        });
      } catch { /* ignore */ }
    }
  }

  try {
    await certManager.projects.locations.certificates.delete({
      name: `projects/${PROJECT_ID}/locations/global/certificates/${certId}`,
    });
  } catch { /* ignore */ }

  try {
    await certManager.projects.locations.dnsAuthorizations.delete({
      name: `projects/${PROJECT_ID}/locations/global/dnsAuthorizations/${authId}`,
    });
  } catch { /* ignore */ }

  await updateAccount(accountId, { customDomain: "", domainStatus: "none" });
}
