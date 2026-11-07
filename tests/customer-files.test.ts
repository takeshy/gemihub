import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";
import { createHash } from "node:crypto";
import { checkedFileSizes, googleCustomerFiles, memoryCustomerFiles, readAttachment, reserveAttachments } from "../server/customer-files.ts";
import { customerFileInputSchema } from "../server/customers.ts";
import { Store, type Shop } from "../server/store.ts";

test("attachment reads reject same-size content changes and still allow renaming", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("checksum-owner@example.com"), files = memoryCustomerFiles(store);
  const original = Buffer.from("original"), changed = Buffer.from("modified");
  assert.equal(changed.length, original.length);
  const input = [{ name: "document.txt", mimeType: "text/plain", data: original.toString("base64") }];
  const [attachment] = await reserveAttachments(files, "", input, checkedFileSizes(input));
  assert.equal(attachment.sha256, createHash("sha256").update(original).digest("hex"));
  assert.equal(customerFileInputSchema.safeParse({ ...input[0], sha256: attachment.sha256 }).success, false, "clients cannot provide the stored checksum");
  await files.upload(shop, "", attachment.id, input[0]);
  assert.deepEqual(await readAttachment(files, shop, "", attachment), original);
  await files.rename(shop, "", attachment.id, "renamed.txt");
  assert.deepEqual(await readAttachment(files, shop, "", { ...attachment, name: "renamed.txt" }), original);
  await files.upload(shop, "", attachment.id, { ...input[0], data: changed.toString("base64") });
  await assert.rejects(() => readAttachment(files, shop, "", attachment), { status: 409 });
});

test("legacy attachment reads remain compatible with metadata without a checksum", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("legacy-files@example.com"), files = memoryCustomerFiles(store);
  const file = { name: "legacy.txt", mimeType: "text/plain", data: Buffer.from("legacy").toString("base64") };
  await files.upload(shop, "", "legacy-file", file);
  const attachment = { id: "legacy-file", name: file.name, mimeType: file.mimeType, size: 6 };
  assert.equal((await readAttachment(files, shop, "", attachment)).toString(), "legacy");
  await assert.rejects(() => readAttachment(files, shop, "", { ...attachment, size: 7 }), { status: 409 });
});

test("CRM files stay in the owner's Drive and repeated upload validates the reserved file identity", async t => {
  t.after(() => mock.restoreAll());
  const objects = new Map<string, { metadata: any; content: Buffer }>();
  const drive = { files: {
    async generateIds(input: any) { assert.deepEqual(input, { count: 1, space: "drive", type: "files" }); return { data: { ids: ["reserved-file"] } }; },
    async create(input: any) {
      if (objects.has(input.requestBody.id)) throw Object.assign(new Error("exists"), { response: { status: 409 } });
      const chunks: Buffer[] = [];
      for await (const chunk of input.media.body) chunks.push(Buffer.from(chunk));
      assert.deepEqual(input.requestBody.parents, ["private-owner-folder"]);
      assert.equal(input.requestBody.appProperties.crmShop, "shop");
      assert.equal("permissions" in input.requestBody, false);
      objects.set(input.requestBody.id, { metadata: input.requestBody, content: Buffer.concat(chunks) });
      return { data: { id: input.requestBody.id } };
    },
    async update(input: any) { objects.get(input.fileId)!.metadata.name = input.requestBody.name; return { data: { id: input.fileId } }; },
    async get(input: any, options?: any) {
      const object = objects.get(input.fileId)!;
      if (input.alt === "media") { assert.equal(options.responseType, "arraybuffer"); return { data: object.content }; }
      return { data: object.metadata };
    },
  } };
  mock.method(google, "drive", (() => drive) as any);
  const shop: Shop = { id: "shop", owner: "owner@example.com", slug: "shop", published: null, draft: null, revision: 0, history: [], google: { folderId: "private-owner-folder", specId: "spec", historyId: "history" } };
  const file = { name: "写真.txt", mimeType: "text/plain", data: Buffer.from("private bytes").toString("base64") };
  const { encrypt } = await import("../server/google.ts");
  const token = encrypt("test-token");
  assert.deepEqual(await googleCustomerFiles.reserve(1, token), ["reserved-file"]);
  await googleCustomerFiles.upload(shop, token, "reserved-file", file);
  await googleCustomerFiles.upload(shop, token, "reserved-file", file);
  assert.equal(objects.size, 1);
  await googleCustomerFiles.rename(shop, token, "reserved-file", "新しい名前.txt");
  assert.equal(objects.get("reserved-file")!.metadata.name, "新しい名前.txt");
  assert.equal((await googleCustomerFiles.read(shop, token, "reserved-file")).toString(), "private bytes");
  await assert.rejects(() => googleCustomerFiles.upload(shop, token, "reserved-file", { ...file, data: "bmV3" }), /exists/);
  await assert.rejects(() => googleCustomerFiles.upload({ ...shop, id: "another-shop" }, token, "reserved-file", file), /exists/);
});
