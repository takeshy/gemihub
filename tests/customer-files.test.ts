import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";
import { googleCustomerFiles } from "../server/customer-files.ts";
import type { Shop } from "../server/store.ts";

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
