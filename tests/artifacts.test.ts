import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { artifacts, renderShop } from "../server/artifacts.ts";
import { Store } from "../server/store.ts";
import { encrypt, decrypt } from "../server/google.ts";
test("generated pages escape owner text; public artifacts do not contain operational data", () => {
  const c = structuredClone(sample);
  c.name = '<script>alert("x")</script>';
  c.menus[0].name = "<img src=x onerror=alert(1)>";
  const output = artifacts(c, '<title>old</title><div id="root"></div>');
  assert.match(output["web/index.html"], /&lt;script&gt;/);
  assert.doesNotMatch(output["web/index.html"], /<script>alert/);
  assert.doesNotMatch(output["web/index.html"], /<img src=x/);
  const mock = JSON.parse(output["web/mock.json"]);
  assert.deepEqual(mock.bookings, []);
  assert.deepEqual(mock.inquiries, []);
  assert.equal(mock.writes, "discarded");
  assert.ok("admin/index.html" in output);
  assert.match(output["admin/system.svg"], /お店の仕組み図/);
  assert.doesNotMatch(output["admin/system.svg"], /<script>/);
  assert.ok("schema.md" in output);
  assert.throws(() =>
    renderShop({ ...c, hours: { ...c.hours, start: "22:00" } }, ""),
  );
});
test("operational batch rollback discards outbox writes; refresh tokens reject tampering", async () => {
  const store = new Store(":memory:");
  await assert.rejects(() =>
    store.transaction(async () => {
      await store.put("job", "1", { type: "mail" });
      throw new Error("abort");
    }),
  );
  assert.equal(await store.get("job", "1"), undefined);
  void store.close();
  const token = encrypt("private-refresh-token");
  assert.ok(!token.includes("private-refresh-token"));
  assert.equal(decrypt(token), "private-refresh-token");
  const tampered = Buffer.from(token, "base64url");
  tampered[20] ^= 1;
  assert.throws(() => decrypt(tampered.toString("base64url")));
});
