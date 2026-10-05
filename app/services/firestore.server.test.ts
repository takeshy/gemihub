import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Firestore recognizes metadata credentials without enabling credential-less hosts", () => {
  const configDir = mkdtempSync(join(tmpdir(), "gemihub-firestore-test-"));
  const env = { ...process.env, CLOUDSDK_CONFIG: configDir };
  for (const key of [
    "K_SERVICE", "GCE_METADATA_HOST", "GCE_METADATA_IP",
    "GOOGLE_APPLICATION_CREDENTIALS", "GCP_PROJECT_ID",
    "GOOGLE_CLOUD_PROJECT", "FIRESTORE_DATABASE_ID",
  ]) {
    delete env[key];
  }
  const moduleUrl = new URL("./firestore.server.ts", import.meta.url).href;
  const cases: [Record<string, string>, boolean][] = [
    [{}, false],
    [{ GCP_PROJECT_ID: "test-project", GOOGLE_CLOUD_PROJECT: "test-project", FIRESTORE_DATABASE_ID: "test-db" }, false],
    [{ K_SERVICE: "gemihub" }, true],
    [{ GCE_METADATA_HOST: "172.28.1.1:8088" }, true],
    [{ GCE_METADATA_IP: "172.28.1.1:8088" }, true],
    [{ GOOGLE_APPLICATION_CREDENTIALS: "/configured/credentials.json" }, true],
  ];
  try {
    for (const [overrides, expected] of cases) {
      // Separate processes keep the cached credential check independent.
      const result = spawnSync(process.execPath, [
        "--import", "tsx", "--input-type=module", "-e",
        `import { isFirestoreAvailable } from ${JSON.stringify(moduleUrl)}; console.log(isFirestoreAvailable());`,
      ], { env: { ...env, ...overrides }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), String(expected), JSON.stringify(overrides));
    }
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
