import assert from "node:assert/strict";
import test from "node:test";
import {
  getEncryptedFileDescription,
  getEncryptedFileMetadata,
  setEncryptedFileDescription,
  setEncryptedFileMetadata,
  unwrapEncryptedFile,
  wrapEncryptedFile,
} from "./crypto-core";

test("encrypted file descriptions round-trip without changing ciphertext", () => {
  const content = wrapEncryptedFile("ciphertext", "private-key", "salt", {
    description: "Production API \"token\"\nRotated monthly",
    publicMetadata: { email: "ops@example.com", url: "https://example.com/login" },
  });
  const parsed = unwrapEncryptedFile(content);

  assert.equal(parsed?.data, "ciphertext");
  assert.equal(parsed?.key, "private-key");
  assert.equal(parsed?.salt, "salt");
  assert.equal(parsed?.description, "Production API \"token\"\nRotated monthly");
  assert.deepEqual(parsed?.publicMetadata, {
    email: "ops@example.com",
    url: "https://example.com/login",
  });
});

test("setEncryptedFileDescription updates and removes only searchable metadata", () => {
  const original = wrapEncryptedFile("ciphertext", "private-key", "salt", {
    publicMetadata: { email: "ops@example.com" },
  });
  const described = setEncryptedFileDescription(original, "CI deploy key");
  assert.equal(getEncryptedFileDescription(described), "CI deploy key");
  assert.equal(unwrapEncryptedFile(described)?.data, "ciphertext");
  assert.deepEqual(getEncryptedFileMetadata(described).publicMetadata, { email: "ops@example.com" });

  const removed = setEncryptedFileDescription(described, "  ");
  assert.equal(getEncryptedFileDescription(removed), "");
  assert.equal(unwrapEncryptedFile(removed)?.data, "ciphertext");
});

test("setEncryptedFileMetadata replaces public fields without changing ciphertext", () => {
  const original = wrapEncryptedFile("ciphertext", "private-key", "salt", {
    description: "Login",
    publicMetadata: { email: "old@example.com" },
  });
  const updated = setEncryptedFileMetadata(original, {
    description: "Login",
    publicMetadata: { email: "new@example.com", tenant: "production" },
  });

  assert.deepEqual(getEncryptedFileMetadata(updated), {
    description: "Login",
    publicMetadata: { email: "new@example.com", tenant: "production" },
  });
  assert.equal(unwrapEncryptedFile(updated)?.data, "ciphertext");
});
