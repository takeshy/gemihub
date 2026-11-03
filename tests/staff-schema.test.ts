import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, shopSchema } from "../server/domain.ts";
import { Store } from "../server/store.ts";
test("staff photos and menu references survive stored shop configuration updates", async () => {
  const store=new Store(":memory:");
  const shop=await store.createShop("owner@example.com");
  const config=shopSchema.parse(sample);config.staff[0].imageId="a".repeat(64);
  shop.published=config;await store.saveShop(shop);
  const loaded=(await store.shop(shop.id))!.published!;
  assert.equal(loaded.staff[0].imageId,"a".repeat(64));
  assert.deepEqual(loaded.staff[0].menuIds,sample.staff[0].menuIds);
  await store.close();
});
