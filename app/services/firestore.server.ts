import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Firestore } from "@google-cloud/firestore";

let _firestore: Firestore | null = null;
let _available: boolean | null = null;

/**
 * Whether Google Cloud Application Default Credentials are plausibly
 * available. On Cloud Run (`K_SERVICE`) credentials come from the metadata
 * server; elsewhere they require `GOOGLE_APPLICATION_CREDENTIALS` or a
 * gcloud ADC file. Without this guard, every Firestore call in a
 * credential-less environment (self-hosted / local dev) pays a failed
 * metadata-server lookup and surfaces a noisy NO_ADC_FOUND error, so
 * Hubwork features check this and disable themselves instead.
 */
export function isFirestoreAvailable(): boolean {
  if (_available === null) {
    const gcloudConfigDir =
      process.env.CLOUDSDK_CONFIG ??
      (process.env.APPDATA
        ? join(process.env.APPDATA, "gcloud")
        : join(homedir(), ".config", "gcloud"));
    // Only actual credential sources count. Config-only vars like
    // FIRESTORE_DATABASE_ID / GOOGLE_CLOUD_PROJECT must NOT enable this:
    // they are often present in a local .env copied from production while
    // the machine still has no credentials, and constructing Firestore then
    // crashes the process (background NO_ADC_FOUND).
    _available = Boolean(
      process.env.K_SERVICE || // Cloud Run (metadata-server credentials)
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        existsSync(join(gcloudConfigDir, "application_default_credentials.json")),
    );
  }
  return _available;
}

export function getFirestore(): Firestore {
  if (!_firestore) {
    if (!isFirestoreAvailable()) {
      throw new Error(
        "Firestore is not available: no Google Cloud credentials found (Hubwork features require Cloud Run or Application Default Credentials).",
      );
    }
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    _firestore = databaseId ? new Firestore({ databaseId }) : new Firestore();
  }
  return _firestore;
}

// Collection names
export const HUBWORK_ACCOUNTS = "hubwork-accounts";
export const HUBWORK_MAGIC_TOKENS = "hubwork-magic-tokens";
export const HUBWORK_FORM_SUBMISSIONS = "hubwork-form-submissions";
export const HUBWORK_PENDING_REGISTRATIONS = "hubwork-pending-registrations";
